import axios from 'axios';
import { z } from 'zod';
import { AgentReinUnavailableError, ApprovalRejectedError, ApprovalTimeoutError, ConfigValidationError, WrapOptionsValidationError } from './errors';
import { retryWithBackoff } from './retry';
import { createSimulatedResponse } from './simulate-response';

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
    isSandbox: boolean;
    createdAt: string;
    updatedAt: string;
}

// Re-export errors for consumer convenience
export { AgentReinUnavailableError, ApprovalRejectedError, ApprovalTimeoutError, ConfigValidationError, WrapOptionsValidationError };

const WrapOptionsSchema = z.object({
    connector: z.string().min(1),
    pollIntervalMs: z.number().int().min(1000, 'pollIntervalMs must be >= 1000ms').optional(),
    timeoutMs: z.number().int().min(5000, 'timeoutMs must be >= 5000ms').optional(),
    failureMode: z.enum(['open', 'closed']).optional(),
    requiresApproval: z.array(z.string()).optional(),
});

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

    async completeSession(session: Session): Promise<void> {
        const headers = await this.authHeaders();
        try {
            await axios.patch(
                `${this.serverUrl}/sessions/${session.id}`,
                { status: 'COMPLETED' },
                { headers }
            );
        } catch (err) {
            if (this.failureMode === 'closed') {
                throw new AgentReinUnavailableError(
                    `Failed to complete session: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }
    }

    async rollbackSession(session: Session): Promise<void> {
        const headers = await this.authHeaders();
        try {
            await axios.post(
                `${this.serverUrl}/sessions/${session.id}/rollback`,
                {},
                { headers }
            );
        } catch (err) {
            if (this.failureMode === 'closed') {
                throw new AgentReinUnavailableError(
                    `Failed to rollback session: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }
    }

    async validateConfig(connectors: string[]): Promise<{
        valid: boolean;
        configured: string[];
        missing: string[];
        suggestions: string[];
    }> {
        const headers = await this.authHeaders();
        try {
            const res = await axios.get(
                `${this.serverUrl}/settings/credentials/validate`,
                {
                    params: { connectors: connectors.join(',') },
                    headers,
                }
            );
            return res.data.data;
        } catch (err) {
            throw new ConfigValidationError(
                `Configuration validation failed: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    }



    // ── logAction (private) ──────────────────────────────

    private async logAction(
        sessionId: string,
        apiName: string,
        operationType: 'CREATE' | 'UPDATE' | 'DELETE',
        payload: unknown,
        response: unknown,
        status: 'SUCCESS' | 'FAILED' | 'PENDING_APPROVAL',
        extra?: { timeoutMs?: number },
    ): Promise<void> {
        try {
            const headers = await this.authHeaders();
            await retryWithBackoff(async () => {
                await axios.post(
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
                );
            });
        } catch (err) {
            // Fallback: if logging fails and action was FAILED, fire rollback directly
            if (status === 'FAILED') {
                try {
                    const h = await this.authHeaders();
                    await axios.post(
                        `${this.serverUrl}/sessions/${sessionId}/rollback`,
                        {},
                        { headers: h },
                    );
                } catch {
                    // swallow silently
                }
            }

            if (this.failureMode === 'closed') {
                throw err;
            } else {
                console.warn(`Failed to log action: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    // ── pollApproval (private) ────────────────────────────

    private async pollApproval(
        approvalId: string,
        pollIntervalMs: number,
        timeoutMs: number,
    ): Promise<'APPROVED'> {
        const headers = await this.authHeaders();
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            let approval: any;
            try {
                const res = await axios.get(
                    `${this.serverUrl}/approvals/${approvalId}`,
                    { headers },
                );
                approval = res.data.data ?? res.data;
            } catch {
                // backend unreachable — continue polling
            }

            if (approval) {
                if (approval.status === 'APPROVED') return 'APPROVED';
                if (approval.status === 'REJECTED') {
                    throw new ApprovalRejectedError(approvalId, approval.reason);
                }
            }
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }
        throw new ApprovalTimeoutError(approvalId, timeoutMs);
    }

    // ── wrap ─────────────────────────────────────────────────

    wrap<T extends object>(client: T, session: Session, options: WrapOptions): T {
        const parsed = WrapOptionsSchema.safeParse(options);
        if (!parsed.success) {
            throw new WrapOptionsValidationError(parsed.error.issues.map(e => e.message).join(', '));
        }

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
                            let actionRes: any;
                            try {
                                actionRes = await retryWithBackoff(async () => {
                                    return await axios.post(
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
                                });
                            } catch (err) {
                                if (self.failureMode === 'closed') {
                                    throw err;
                                } else {
                                    console.warn(`Failed to log action: ${err instanceof Error ? err.message : String(err)}`);
                                }
                            }

                            if (!actionRes) {
                                // Execute action directly without approval gate since failureMode is open
                                let result: any;
                                try {
                                    result = await innerTarget.apply(thisArg, args);
                                } catch (execErr) {
                                    await self.logAction(session.id, apiName, operationType, args[0], 
                                        execErr instanceof Error ? execErr.message : String(execErr), 
                                        'FAILED');
                                    throw execErr;
                                }
                                self.logAction(session.id, apiName, operationType, args[0], result, 'SUCCESS');
                                return result;
                            }

                            const action = actionRes.data.data ?? actionRes.data;
                            if (action && action.simulated === true) {
                                return createSimulatedResponse();
                            }
                            const actionId: string = action.id;
                            const approvalId: string = 
                                action.approvalRequest?.id ?? 
                                action.approval?.id ?? 
                                action.id;

                            // 2. Poll for decision
                            try {
                                await self.pollApproval(approvalId, pollIntervalMs, timeoutMs);
                            } catch (err) {
                                // Timeout or Rejected — log FAILED (triggers server auto-rollback)
                                await self.logAction(session.id, apiName, operationType, args[0], null, 'FAILED');
                                throw err;
                            }

                            // 4. Approved — execute the function
                            let result: any;
                            try {
                                result = await innerTarget.apply(thisArg, args);
                            } catch (execErr) {
                                await self.logAction(session.id, apiName, operationType, args[0], 
                                    execErr instanceof Error ? execErr.message : String(execErr), 
                                    'FAILED');
                                throw execErr;
                            }

                            // 5. PATCH existing action to SUCCESS (fire-and-forget)
                            self.authHeaders().then(h =>
                                retryWithBackoff(async () => {
                                    await axios.patch(
                                        `${self.serverUrl}/sessions/${session.id}/actions/${actionId}`,
                                        { status: 'SUCCESS', response: result },
                                        { headers: h },
                                    );
                                })
                            ).catch((err) => {
                                if (self.failureMode === 'closed') {
                                    throw err;
                                } else {
                                    console.warn(`Failed to update action to SUCCESS: ${err instanceof Error ? err.message : String(err)}`);
                                }
                            });

                            return result;
                        })();
                    }

                    // ── Standard execution path ─────────────────────────────
                    const isSessionSandbox = session.isSandbox === true;

                    if (isSessionSandbox) {
                        return (async () => {
                            let actionRes: any;
                            try {
                                const headers = await self.authHeaders();
                                actionRes = await retryWithBackoff(async () => {
                                    return await axios.post(
                                        `${self.serverUrl}/sessions/${session.id}/actions`,
                                        {
                                            apiName,
                                            operationType,
                                            payload: args[0] ?? {},
                                            response: {},
                                            status: 'SUCCESS',
                                        },
                                        { headers },
                                    );
                                });
                            } catch (err) {
                                if (self.failureMode === 'closed') {
                                    throw err;
                                } else {
                                    console.warn(`Failed to log action: ${err instanceof Error ? err.message : String(err)}`);
                                }
                            }

                            const action = actionRes?.data?.data ?? actionRes?.data;
                            if (action && action.simulated === true) {
                                return createSimulatedResponse();
                            }

                            const result = await innerTarget.apply(thisArg, args);
                            return result;
                        })();
                    }

                    const execution = innerTarget.apply(thisArg, args);

                    if (execution && typeof execution.then === 'function') {
                        return execution.then((result: any) => {
                            // Log SUCCESS — fire-and-forget
                            self.logAction(session.id, apiName, operationType, args[0], result, 'SUCCESS');
                            return result;
                        }).catch(async (err: any) => {
                            // Log FAILED — this is what triggers server-side auto-rollback
                            // logAction() has a built-in fallback to POST /rollback if logging fails
                            await self.logAction(
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
