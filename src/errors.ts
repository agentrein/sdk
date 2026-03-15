/**
 * Custom errors for the Agentrein SDK.
 */

export class AgentreinUnavailableError extends Error {
    constructor(message?: string) {
        super(message ?? 'Agentrein safety layer is unavailable');
        this.name = 'AgentreinUnavailableError';
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
