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
  public readonly approvalId: string;
  public readonly reason: string | undefined;
  constructor(approvalId: string, reason?: string) {
    super(`Approval ${approvalId} was rejected${reason ? ': ' + reason : ''}`);
    this.name = 'ApprovalRejectedError';
    this.approvalId = approvalId;
    this.reason = reason;
    Object.setPrototypeOf(this, ApprovalRejectedError.prototype);
  }
}

export class ApprovalTimeoutError extends Error {
  public readonly approvalId: string;
  public readonly timeoutMs: number;
  constructor(approvalId: string, timeoutMs: number) {
    super(`Approval ${approvalId} timed out after ${timeoutMs}ms`);
    this.name = 'ApprovalTimeoutError';
    this.approvalId = approvalId;
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, ApprovalTimeoutError.prototype);
  }
}

export class ConfigValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigValidationError';
        Object.setPrototypeOf(this, ConfigValidationError.prototype);
    }
}

export class WrapOptionsValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WrapOptionsValidationError';
        Object.setPrototypeOf(this, WrapOptionsValidationError.prototype);
    }
}


