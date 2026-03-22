/**
 * Custom errors for the AgentRein SDK.
 */

export class AgentReinUnavailableError extends Error {
    constructor(message?: string) {
        super(message ?? 'AgentRein safety layer is unavailable');
        this.name = 'AgentReinUnavailableError';
    }
}

export class ApprovalRejectedError extends Error {
    constructor(public reason: string) {
        super(`Action rejected by reviewer: ${reason}`);
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
