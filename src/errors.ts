/**
 * Custom errors for the Agentame SDK.
 */

export class AgentameUnavailableError extends Error {
    constructor(message?: string) {
        super(message ?? 'Agentame safety layer is unavailable');
        this.name = 'AgentameUnavailableError';
    }
}

export class ApprovalRejectedError extends Error {
    constructor(apiName: string, reason?: string) {
        super(
            `Action "${apiName}" was rejected by a human reviewer${reason ? `: ${reason}` : ''}`,
        );
        this.name = 'ApprovalRejectedError';
    }
}

export class ApprovalTimeoutError extends Error {
    constructor(apiName: string, timeoutMinutes: number) {
        super(
            `Action "${apiName}" was not approved within ${timeoutMinutes} minutes — auto-rejected`,
        );
        this.name = 'ApprovalTimeoutError';
    }
}
