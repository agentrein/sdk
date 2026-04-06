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
    actionName: string;
    operationType?: 'CREATE' | 'UPDATE' | 'DELETE';
    rollback?: (result: any) => Promise<void>;
    requiresApproval?: boolean;
    pollIntervalMs?: number;
    timeoutMs?: number;
}

export interface WrapOptions {
    connector: string;
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
    private tokenExpiresAt: number = 0;

    constructor(options: AgentReinOptions) {
        this.serverUrl = options.serverUrl || 'https://api.agentrein.com';
        this.apiKey = options.apiKey;
        this.failureMode = options.failureMode ?? 'open';
    }

    // ── Authentication ──────────────────────────────────

    private async getToken(): Promise<string> {
        const BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry
        if (this.token && Date.now() < this.tokenExpiresAt - BUFFER_MS) {
            return this.token;
        }
        try {
            const res = await axios.post(`${this.serverUrl}/auth/token`, {
                apiKey: this.apiKey,
            });
            this.token = res.data.data.token;
            this.tokenExpiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h matches backend JWT expiry
            return this.token!;
        } catch (err) {
            throw new AgentReinUnavailableError(
                `Failed to authenticate: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    }

    private async authHeaders(): Promise<Record<string, string>> {
        const token = await this.getToken();
        return { Authorization: `Bearer ${token}` };
    }

    // ── newSession ───────────────────────────────────────

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

    async resumeSession(sessionId: string): Promise<Session> {
        const headers = await this.authHeaders();
        const res = await axios.get(
            `${this.serverUrl}/sessions/${sessionId}`,
            { headers },
        );
        return res.data.data;
    }

    async getSession(sessionId: string): Promise<Session> {
        return this.resumeSession(sessionId);
    }

    async completeSession(session: Session | string): Promise<Session> {
        const sessionId = typeof session === 'string' ? session : session.id;
        const headers = await this.authHeaders();
        try {
            const res = await axios.patch(
                `${this.serverUrl}/sessions/${sessionId}`,
                { status: 'COMPLETED' },
                { headers }
            );
            return res.data.data;
        } catch (err) {
            if (this.failureMode === 'closed') {
                throw new AgentReinUnavailableError(
                    `Failed to complete session: ${err instanceof Error ? err.message : String(err)}`
                );
            }
            return typeof session === 'string' ? { id: session } as Session : session;
        }
    }

    // ── pollApproval (private) ────────────────────────────

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

    async call<T>(
        fn: (...args: any[]) => Promise<T>,
        session: Session,
        options: CallOptions & { args?: any[] }
    ): Promise<T> {
        let result: T;
        const apiName = options.actionName;
        const operationType = options.operationType ?? 'CREATE';

        // ── Approval gate path ──────────────────────────
        if (options.requiresApproval) {
            const pollIntervalMs = options.pollIntervalMs ?? 2000;
            const timeoutMs = options.timeoutMs ?? 86_400_000; // 24 hours
            const headers = await this.authHeaders();

            try {
                // 1. Log action with PENDING_APPROVAL status
                const actionRes = await axios.post(
                    `${this.serverUrl}/sessions/${session.id}/actions`,
                    {
                        apiName,
                        operationType,
                        payload: options.args?.[0] ?? {},
                        response: {},
                        status: 'PENDING_APPROVAL',
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
                result = await fn(...(options.args ?? []));

                // 4. Update existing action to SUCCESS (fire-and-forget)
                axios.patch(
                    `${this.serverUrl}/sessions/${session.id}/actions/${actionId}`,
                    { status: 'SUCCESS', response: result },
                    { headers },
                ).catch(() => { });

                return result;
            } catch (error) {
                if (options.rollback) {
                    try {
                        await options.rollback(result!);
                    } catch (e) {}

                    axios.post(
                        `${this.serverUrl}/sessions/${session.id}/actions`,
                        {
                            apiName,
                            operationType,
                            payload: options.args?.[0] ?? {},
                            response: error instanceof Error ? error.message : String(error),
                            status: 'FAILED',
                        },
                        { headers }
                    ).catch(() => {});
                } else {
                    axios.post(
                        `${this.serverUrl}/sessions/${session.id}/rollback`,
                        {},
                        { headers },
                    ).catch(() => { });
                }

                throw error;
            }
        }

        // ── Standard path (no approval) ─────────────────
        try {
            result = await fn(...(options.args ?? []));

            // Log action to server (fire-and-forget)
            this.authHeaders().then((headers) => 
                axios.post(
                    `${this.serverUrl}/sessions/${session.id}/actions`,
                    {
                        apiName,
                        operationType,
                        payload: options.args?.[0] ?? {},
                        response: result,
                        status: 'SUCCESS',
                    },
                    { headers },
                )
            ).catch(() => { });

            return result;
        } catch (error) {
            if (options.rollback) {
                try {
                    await options.rollback(result!);
                } catch (e) {}

                this.authHeaders().then((headers) =>
                    axios.post(
                        `${this.serverUrl}/sessions/${session.id}/actions`,
                        {
                            apiName,
                            operationType,
                            payload: options.args?.[0] ?? {},
                            response: error instanceof Error ? error.message : String(error),
                            status: 'FAILED',
                        },
                        { headers }
                    )
                ).catch(() => {});
            } else {
                // Trigger server LIFO rollback
                this.authHeaders().then((headers) => 
                    axios.post(
                        `${this.serverUrl}/sessions/${session.id}/rollback`,
                        {},
                        { headers },
                    )
                ).catch(() => { });
            }

            throw error;
        }
    }

    // ── wrap ─────────────────────────────────────────────────

    wrap<T extends object>(client: T, session: Session, options: { connector: string }): T {
        const self = this; // capture AgentRein instance

        function makeProxy<V>(target: V, path: string[]): V {
            if (typeof target !== 'function' && (typeof target !== 'object' || target === null)) {
                return target; // primitive — pass through
            }

            return new Proxy(target as object, {
                get(innerTarget: any, prop: string | symbol) {
                    if (typeof prop !== 'string') return innerTarget[prop];
                    const next = innerTarget[prop];
                    return makeProxy(next, [...path, prop]);
                },

                apply(innerTarget: any, thisArg: any, args: any[]) {
                    const apiName = `${options.connector}.${path.join('.')}`;
                    const lastSeg = path[path.length - 1]?.toLowerCase() ?? '';
                    const OP_MAP: Record<string, 'CREATE' | 'UPDATE' | 'DELETE'> = {
                        create: 'CREATE', send: 'CREATE', post: 'CREATE',
                        append: 'CREATE', add: 'CREATE',
                        update: 'UPDATE', patch: 'UPDATE', modify: 'UPDATE',
                        move: 'UPDATE', trash: 'UPDATE', upsert: 'UPDATE',
                        delete: 'DELETE', del: 'DELETE', remove: 'DELETE', destroy: 'DELETE',
                    };
                    const operationType = OP_MAP[lastSeg] ?? 'CREATE';

                    const execution = innerTarget.apply(thisArg, args);

                    // Handle both sync and async functions
                    if (execution && typeof execution.then === 'function') {
                        return execution.then((result: any) => {
                            self.authHeaders().then(headers =>
                                axios.post(
                                    `${self.serverUrl}/sessions/${session.id}/actions`,
                                    { apiName, operationType, payload: args[0] ?? {}, response: result, status: 'SUCCESS' },
                                    { headers }
                                )
                            ).catch(() => {});
                            return result;
                        }).catch((err: any) => {
                            self.authHeaders().then(headers =>
                                axios.post(`${self.serverUrl}/sessions/${session.id}/rollback`, {}, { headers })
                            ).catch(() => {});
                            throw err;
                        });
                    }

                    // Sync function — log fire-and-forget
                    self.authHeaders().then(headers =>
                        axios.post(
                            `${self.serverUrl}/sessions/${session.id}/actions`,
                            { apiName, operationType, payload: args[0] ?? {}, response: execution, status: 'SUCCESS' },
                            { headers }
                        )
                    ).catch(() => {});
                    return execution;
                },
            }) as V;
        }

        // Root proxy: each top-level property access starts a fresh path
        return new Proxy(client as object, {
            get(target: any, prop: string | symbol) {
                if (typeof prop !== 'string') return target[prop];
                return makeProxy(target[prop], [prop]);
            },
        }) as T;
    }
}

export default AgentRein;
