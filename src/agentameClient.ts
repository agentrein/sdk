import axios from 'axios';
import { AgentameUnavailableError } from './errors';

// ─── Types ───────────────────────────────────────────────

export interface AgentameOptions {
    apiKey: string;
    serverUrl?: string;
    failureMode?: 'open' | 'closed';
}

export interface SessionOptions {
    agentId?: string;
    intent?: string;
}

export interface UndoConfig {
    type: 'slack-correction' | 'http-delete' | 'none';
    url?: string;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
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
export { AgentameUnavailableError };

// ─── Agentame Client ─────────────────────────────────────

export class Agentame {
    private readonly serverUrl: string;
    private readonly apiKey: string;
    private readonly failureMode: 'open' | 'closed';
    private token: string | null = null;

    constructor(options: AgentameOptions) {
        this.serverUrl = options.serverUrl || 'https://agentame.up.railway.app';
        this.apiKey = options.apiKey;
        this.failureMode = options.failureMode ?? 'open';
    }

    // ── Authentication ──────────────────────────────────

    /**
     * Obtain a JWT token from the Agentame server using the API key.
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
            throw new AgentameUnavailableError(
                `Failed to authenticate with Agentame server: ${err instanceof Error ? err.message : String(err)}`,
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
     * Create a new agent session on the Agentame server.
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

    // ── call ─────────────────────────────────────────────

    /**
     * Execute an API call under Agentame's protection.
     *
     * 1. Calls fn(...args)
     * 2. Logs the action to the Agentame server (async, non-blocking)
     * 3. On failure, triggers server-side rollback
     *
     * @param fn      - The function to execute
     * @param session - The active Agentame session
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
            'type' in args[0] &&
            ['slack-correction', 'http-delete', 'none'].includes(args[0].type)
        ) {
            undoConfig = args[0] as UndoConfig;
            callArgs = args.slice(1);
        }

        const headers = await this.authHeaders();

        try {
            const result = await fn(...callArgs);

            // Log action to server (fire-and-forget)
            axios.post(
                `${this.serverUrl}/sessions/${session.id}/actions`,
                {
                    apiName: fn.name || 'anonymous',
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
