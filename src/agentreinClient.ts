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

export interface WrapOptions {
    connector: string;
    requiresApproval?: string[];
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
    private tokenExpiresAt: number = 0;

    constructor(options: AgentReinOptions) {
        this.serverUrl = options.serverUrl || 'https://api.agentrein.com';
        this.apiKey = options.apiKey;
        this.failureMode = options.failureMode ?? 'open';
    }

    // ── Authentication ──────────────────────────────────

    private async getToken(): Promise<string> {
        const BUFFER_MS = 5 * 60 * 1000;
        if (this.token && Date.now() < this.tokenExpiresAt - BUFFER_MS) {
            return this.token;
        }
        try {
            const res = await axios.post(`${this.serverUrl}/auth/token`, {
                apiKey: this.apiKey,
            });
            this.token = res.data.data.token;
            this.tokenExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
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

    // ── logAction (private) ──────────────────────────────

    private logAction(
        sessionId: string,
        apiName: string,
        operationType: 'CREATE' | 'UPDATE' | 'DELETE',
        payload: unknown,
        response: unknown,
        status: 'SUCCESS' | 'FAILED' | 'PENDING_APPROVAL',
        extra?: { timeoutMs?: number },
    ): void {
        // Always fire-and-forget, but with a guaranteed fallback
        this.authHeaders().then(headers =>
            axios.post(
                `${this.serverUrl}/sessions/${sessionId}/actions`,
                {
                    apiName,
                    operationType,
                    payload: payload ?? {},
                    response: response ?? {},
                    status,
                    ...(extra?.timeoutMs != null && { timeoutMs: extra.timeoutMs }),
                },
                { headers },
            )
        ).catch(() => {
            // Fallback only for FAILED: fire rollback directly if logging fails
            if (status === 'FAILED') {
                this.authHeaders().then(h =>
                    axios.post(
                        `${this.serverUrl}/sessions/${sessionId}/rollback`,
                        {},
                        { headers: h },
                    )
                ).catch(() => {});
            }
        });
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
                if (approval.status === 'APPROVED') return 'APPROVED';
                if (approval.status === 'REJECTED') {
                    return { status: 'REJECTED', reason: approval.reason ?? 'Rejected by reviewer' };
                }
            } catch {
                // backend unreachable — continue polling
            }
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }
        throw new Error('Approval timeout exceeded');
    }

    // ── wrap ─────────────────────────────────────────────────

    wrap<T extends object>(client: T, session: Session, options: WrapOptions): T {
        const self = this;
        const pollIntervalMs = options.pollIntervalMs ?? 2000;
        const timeoutMs = options.timeoutMs ?? 86_400_000;

        const OP_MAP: Record<string, 'CREATE' | 'UPDATE' | 'DELETE'> = {
            create: 'CREATE', send: 'CREATE', post: 'CREATE',
            append: 'CREATE', add: 'CREATE',
            update: 'UPDATE', patch: 'UPDATE', modify: 'UPDATE',
            move: 'UPDATE', trash: 'UPDATE', upsert: 'UPDATE',
            delete: 'DELETE', del: 'DELETE', remove: 'DELETE', destroy: 'DELETE',
        };

        function makeProxy<V>(target: V, path: string[]): V {
            if (typeof target !== 'function' && (typeof target !== 'object' || target === null)) {
                return target;
            }

            return new Proxy(target as object, {
                get(innerTarget: any, prop: string | symbol) {
                    if (typeof prop !== 'string') return innerTarget[prop];
                    return makeProxy(innerTarget[prop], [...path, prop]);
                },

                apply(innerTarget: any, thisArg: any, args: any[]) {
                    const apiName = `${options.connector}.${path.join('.')}`;
                    const lastSeg = path[path.length - 1]?.toLowerCase() ?? '';
                    const operationType = OP_MAP[lastSeg] ?? 'CREATE';
                    const methodPath = path.join('.');

                    // ── Approval gate path ──────────────────────────────────
                    const needsApproval = options.requiresApproval?.some(
                        p => methodPath === p || apiName === p
                    ) ?? false;

                    if (needsApproval) {
                        return (async () => {
                            const headers = await self.authHeaders();

                            // 1. Log as PENDING_APPROVAL — await this, not fire-and-forget
                            const actionRes = await axios.post(
                                `${self.serverUrl}/sessions/${session.id}/actions`,
                                {
                                    apiName,
                                    operationType,
                                    payload: args[0] ?? {},
                                    response: {},
                                    status: 'PENDING_APPROVAL',
                                    timeoutMs,
                                },
                                { headers },
                            );
                            const action = actionRes.data.data ?? actionRes.data;
                            const actionId: string = action.id;
                            const approvalId: string = 
                                action.approvalRequest?.id ?? 
                                action.approval?.id ?? 
                                action.id;

                            // 2. Poll for decision
                            let decision: 'APPROVED' | { status: 'REJECTED'; reason: string };
                            try {
                                decision = await self.pollApproval(approvalId, pollIntervalMs, timeoutMs);
                            } catch (timeoutErr) {
                                // Timeout — log FAILED (triggers server auto-rollback)
                                self.logAction(session.id, apiName, operationType, args[0], null, 'FAILED');
                                throw timeoutErr;
                            }

                            // 3. Rejected — log FAILED (triggers server auto-rollback)
                            if (decision !== 'APPROVED') {
                                self.logAction(session.id, apiName, operationType, args[0], null, 'FAILED');
                                throw new ApprovalRejectedError(
                                    (decision as { status: 'REJECTED'; reason: string }).reason
                                );
                            }

                            // 4. Approved — execute the function
                            let result: any;
                            try {
                                result = await innerTarget.apply(thisArg, args);
                            } catch (execErr) {
                                self.logAction(session.id, apiName, operationType, args[0], 
                                    execErr instanceof Error ? execErr.message : String(execErr), 
                                    'FAILED');
                                throw execErr;
                            }

                            // 5. PATCH existing action to SUCCESS (fire-and-forget)
                            self.authHeaders().then(h =>
                                axios.patch(
                                    `${self.serverUrl}/sessions/${session.id}/actions/${actionId}`,
                                    { status: 'SUCCESS', response: result },
                                    { headers: h },
                                )
                            ).catch(() => {});

                            return result;
                        })();
                    }

                    // ── Standard execution path ─────────────────────────────
                    const execution = innerTarget.apply(thisArg, args);

                    if (execution && typeof execution.then === 'function') {
                        return execution.then((result: any) => {
                            // Log SUCCESS — fire-and-forget
                            self.logAction(session.id, apiName, operationType, args[0], result, 'SUCCESS');
                            return result;
                        }).catch((err: any) => {
                            // Log FAILED — this is what triggers server-side auto-rollback
                            // logAction() has a built-in fallback to POST /rollback if logging fails
                            self.logAction(
                                session.id, apiName, operationType, args[0],
                                err instanceof Error ? err.message : String(err),
                                'FAILED'
                            );
                            throw err;
                        });
                    }

                    // Sync function
                    self.logAction(session.id, apiName, operationType, args[0], execution, 'SUCCESS');
                    return execution;
                },
            }) as V;
        }

        return new Proxy(client as object, {
            get(target: any, prop: string | symbol) {
                if (typeof prop !== 'string') return target[prop];
                return makeProxy(target[prop], [prop]);
            },
        }) as T;
    }
}

export default AgentRein;
