import axios from 'axios';

export interface RetryOptions {
    maxAttempts: number;      // default: 3
    baseDelayMs: number;      // default: 500
    maxDelayMs: number;       // default: 8000
    retryOn?: (error: unknown) => boolean;  // default: retry on network errors and 5xx only
}

export function defaultRetryOn(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        // Network errors (no status) or HTTP 5xx responses
        if (status === undefined || status >= 500) {
            return true;
        }
        return false;
    }
    if (error instanceof Error) {
        const errMsg = error.message.toLowerCase();
        if (
            errMsg.includes('refused') ||
            errMsg.includes('timeout') ||
            errMsg.includes('failed to fetch') ||
            errMsg.includes('network')
        ) {
            return true;
        }
    }
    return false;
}

export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {}
): Promise<T> {
    const maxAttempts = options.maxAttempts ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 500;
    const maxDelayMs = options.maxDelayMs ?? 8000;
    const retryOn = options.retryOn ?? defaultRetryOn;

    let attempt = 0;
    while (true) {
        attempt++;
        try {
            return await fn();
        } catch (error) {
            if (attempt >= maxAttempts || !retryOn(error)) {
                throw error;
            }
            const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}
