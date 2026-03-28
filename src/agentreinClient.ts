import axios from 'axios';
import { AgentReinUnavailableError, ApprovalRejectedError } from './errors';

// ─── Types ───────────────────────────────────────────────

export interface AgentReinOptions {
    apiKey: string;
    serverUrl?: string;
    failureMode?: 'open' | 'closed';
}

export interface SessionOptions {
    agentId?: string;
    intent?: string;
}

export interface UndoConfig {
    __isUndoConfig: true;
    type?: 'slack-correction' | 'http-delete' | 'none' | string;
    url?: string;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    action?: string;
    rollback?: (response: any) => Promise<void>;
}

export function createUndoConfig(config: Omit<UndoConfig, '__isUndoConfig'>): UndoConfig {
    return { __isUndoConfig: true, ...config };
}

export interface CallOptions {
    actionName?: string;
    requiresApproval?: boolean;
    pollIntervalMs?: number;
    timeoutMs?: number;
}

export interface Session {
    id: string;
    organizationId: string;
    agentId: string;
    intent: string | null;
    status: string;
    startedAt: string;
    endedAt: string | null;
}

// Re-export errors for consumer convenience
export { AgentReinUnavailableError, ApprovalRejectedError };

// ─── AgentRein Client ─────────────────────────────────────

export class AgentRein {
    private readonly serverUrl: string;
    private readonly apiKey: string;
    private readonly failureMode: 'open' | 'closed';
    private token: string | null = null;

    constructor(options: AgentReinOptions) {
        this.serverUrl = options.serverUrl || 'https://api.agentrein.com';
        this.apiKey = options.apiKey;
        this.failureMode = options.failureMode ?? 'open';
    }

    // ── Authentication ──────────────────────────────────

    /**
     * Obtain a JWT token from the AgentRein server using the API key.
     * Caches the token for subsequent requests.
     */
    private async getToken(): Promise<string> {
        if (this.token) return this.token;

        try {
            const res = await axios.post(`${this.serverUrl}/auth/token`, {
                apiKey: this.apiKey,
            });
            this.token = res.data.data.token;
            return this.token!;
        } catch (err) {
            throw new AgentReinUnavailableError(
                `Failed to authenticate with AgentRein server: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /**
     * Build authorization headers for server requests.
     */
    private async authHeaders(): Promise<Record<string, string>> {
        const token = await this.getToken();
        return { Authorization: `Bearer ${token}` };
    }

    // ── newSession ───────────────────────────────────────

    /**
     * Create a new agent session on the AgentRein server.
     *
     * @param options - Session options (agentId + optional intent).
     *                  Can also pass a plain string for backward compat (agentId).
     *                  If omitted, a random agentId is generated.
     */
    async newSession(options?: SessionOptions | string): Promise<Session> {
        const resolved = typeof options === 'string'
            ? { agentId: options, intent: undefined }
            : options ?? {};

        const agentId = resolved.agentId ?? crypto.randomUUID();
        const intent = resolved.intent;

        const headers = await this.authHeaders();
        const res = await axios.post(
            `${this.serverUrl}/sessions`,
            { agentId, intent },
            { headers },
        );

        return res.data.data;
    }

    // ── resumeSession & getSession ────────────────────────

    /**
     * Resume an existing session by ID.
     */
    async resumeSession(sessionId: string): Promise<Session> {
        const headers = await this.authHeaders();
        const res = await axios.get(
            `${this.serverUrl}/sessions/${sessionId}`,
            { headers },
        );
        return res.data.data;
    }

    /**
     * Get a session by ID — alias for resumeSession.
     */
    async getSession(sessionId: string): Promise<Session> {
        return this.resumeSession(sessionId);
    }

    /**
     * Completes an active session.
     */
    async completeSession(session: Session): Promise<Session> {
        const headers = await this.authHeaders();
        try {
            const res = await axios.patch(
                `${this.serverUrl}/sessions/${session.id}`,
                { status: 'COMPLETED' },
                { headers },
            );
            return res.data.data;
        } catch (err) {
            if (this.failureMode === 'closed') {
                throw new AgentReinUnavailableError(
                    `Failed to complete session: ${err instanceof Error ? err.message : String(err)}`
                );
            }
            return session;
        }
    }

    // ── pollApproval (private) ────────────────────────────

    /**
     * Poll the approval endpoint until approved, rejected, or timeout.
     *
     * @returns 'APPROVED' or { status: 'REJECTED', reason: string }
     */
    private async pollApproval(
        approvalId: string,
        pollIntervalMs: number,
        timeoutMs: number,
    ): Promise<'APPROVED' | { status: 'REJECTED'; reason: string }> {
        const headers = await this.authHeaders();
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            try {
                const res = await axios.get(
                    `${this.serverUrl}/approvals/${approvalId}`,
                    { headers },
                );

                const approval = res.data.data ?? res.data;

                if (approval.status === 'APPROVED') {
                    return 'APPROVED';
                }

                if (approval.status === 'REJECTED') {
                    return { status: 'REJECTED', reason: approval.reason ?? 'Rejected by reviewer' };
                }
            } catch {
                // Backend unreachable — continue polling (fail-open)
            }

            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }

        throw new Error('Approval timeout exceeded');
    }

    // ── call ─────────────────────────────────────────────

    /**
     * Execute an API call under AgentRein's protection.
     *
     * 1. Calls fn(...args)
     * 2. Logs the action to the AgentRein server (async, non-blocking)
     * 3. On failure, triggers server-side rollback
     *
     * When options.requiresApproval is true:
     * 1. Logs the action with status PENDING_APPROVAL before executing
     * 2. Polls until a human approves or rejects
     * 3. If approved → executes fn, logs success
     * 4. If rejected → throws ApprovalRejectedError → triggers rollback
     *
     * @param fn      - The function to execute
     * @param session - The active AgentRein session
     * @param args    - Arguments forwarded to fn
     */
    async call<T>(
        fn: Function,
        session: Session,
        ...args: any[]
    ): Promise<T>;
    async call<T>(
        fn: Function,
        session: Session,
        undoConfig: UndoConfig,
        ...args: any[]
    ): Promise<T>;
    async call<T>(fn: Function, session: Session, ...args: any[]): Promise<T> {
        // Detect if first extra arg is an UndoConfig object
        let undoConfig: UndoConfig | undefined;
        let callArgs = args;
        if (
            args.length > 0 &&
            args[0] &&
            typeof args[0] === 'object' &&
            '__isUndoConfig' in args[0]
        ) {
            undoConfig = args[0] as UndoConfig;
            callArgs = args.slice(1);
        }

        // Detect CallOptions as last arg
        let apiName: string;
        let options: CallOptions | undefined;
        if (
            callArgs.length > 0 &&
            callArgs[callArgs.length - 1] &&
            typeof callArgs[callArgs.length - 1] === 'object' &&
            ('actionName' in callArgs[callArgs.length - 1] ||
                'requiresApproval' in callArgs[callArgs.length - 1])
        ) {
            options = callArgs[callArgs.length - 1] as CallOptions;
            callArgs = callArgs.slice(0, -1);
            apiName = options.actionName || fn.name || 'anonymous';
        } else {
            apiName = fn.name || 'anonymous';
        }

        const headers = await this.authHeaders();

        // ── Approval gate path ──────────────────────────
        if (options?.requiresApproval) {
            const pollIntervalMs = options.pollIntervalMs ?? 2000;
            const timeoutMs = options.timeoutMs ?? 86_400_000; // 24 hours

            try {
                // 1. Log action with PENDING_APPROVAL status
                const actionRes = await axios.post(
                    `${this.serverUrl}/sessions/${session.id}/actions`,
                    {
                        apiName,
                        operationType: 'CREATE',
                        payload: callArgs[0] ?? {},
                        response: {},
                        status: 'PENDING_APPROVAL',
                        undoConfig,
                        timeoutMs,
                    },
                    { headers },
                );

                const action = actionRes.data.data ?? actionRes.data;
                const actionId: string = action.id;
                const approvalId: string = action.approvalRequest?.id ?? action.approval?.id ?? action.id;

                // 2. Poll for approval decision
                const decision = await this.pollApproval(approvalId, pollIntervalMs, timeoutMs);

                if (decision !== 'APPROVED') {
                    throw new ApprovalRejectedError(decision.reason);
                }

                // 3. Approved — execute the function
                const result = await fn(...callArgs);

                // 4. Update existing action to SUCCESS (fire-and-forget)
                axios.patch(
                    `${this.serverUrl}/sessions/${session.id}/actions/${actionId}`,
                    { status: 'SUCCESS', response: result },
                    { headers },
                ).catch(() => { });

                return result;
            } catch (error) {
                // Trigger server-side rollback
                await axios.post(
                    `${this.serverUrl}/sessions/${session.id}/rollback`,
                    {},
                    { headers },
                ).catch(() => { });

                throw error;
            }
        }

        // ── Standard path (no approval) ─────────────────
        try {
            const result = await fn(...callArgs);

            // Log action to server (fire-and-forget)
            axios.post(
                `${this.serverUrl}/sessions/${session.id}/actions`,
                {
                    apiName,
                    operationType: 'CREATE',
                    payload: callArgs[0] ?? {},
                    response: result,
                    status: 'SUCCESS',
                    undoConfig,
                },
                { headers },
            ).catch(() => { });

            return result;
        } catch (error) {
            // Trigger server-side rollback
            await axios.post(
                `${this.serverUrl}/sessions/${session.id}/rollback`,
                {},
                { headers },
            ).catch(() => { });

            throw error;
        }
    }
}

export default AgentRein;
