import { randomUUID } from 'crypto';

// ─── Types ───────────────────────────────────────────────

export interface ConnectorRetryResult<T> {
    result: T;
    retryCount: number;       // number of retries that occurred (0 = succeeded on first attempt)
    idempotencyKey: string;   // the single key used across all attempts of this operation
}

// ─── Error Classification ────────────────────────────────

/**
 * Attempts to extract an HTTP-like status code from a heterogeneous set of
 * third-party connector SDK error shapes. Returns undefined if no status
 * code can be found (treated as a network-level error, not a business error).
 */
function extractStatusCode(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const err = error as Record<string, unknown>;

    // Stripe SDK: error.statusCode, or error.raw?.statusCode
    if (typeof err.statusCode === 'number') return err.statusCode;
    const raw = err.raw as Record<string, unknown> | undefined;
    if (raw && typeof raw.statusCode === 'number') return raw.statusCode;

    // Octokit: error.status
    if (typeof err.status === 'number') return err.status;

    // axios-style (in case a connector uses axios internally): error.response?.status
    const response = err.response as Record<string, unknown> | undefined;
    if (response && typeof response.status === 'number') return response.status;

    return undefined;
}

const NETWORK_ERROR_KEYWORDS = ['timeout', 'econnrefused', 'econnreset', 'network', 'etimedout', 'enotfound', 'failed to fetch'];

/**
 * Determines whether an error thrown by a connector SDK call (Stripe, Octokit,
 * Slack WebClient, HubSpot client, jsforce, Notion client, googleapis, etc.)
 * represents a transient/technical failure that is safe to retry, as opposed
 * to a business/validation failure that would fail identically on retry.
 *
 * - 5xx-equivalent status codes, or no status code at all (pure network error) → retryable
 * - 4xx-equivalent status codes → NOT retryable (business failure, retrying won't help)
 */
export function isTransientConnectorError(error: unknown): boolean {
    const status = extractStatusCode(error);

    if (status !== undefined) {
        return status >= 500;
    }

    // No status code found — likely a network-level failure, inspect the message
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        return NETWORK_ERROR_KEYWORDS.some((keyword) => msg.includes(keyword));
    }

    return false;
}

// ─── Retry Executor ──────────────────────────────────────

const MAX_ATTEMPTS = 3;
const DELAYS_MS = [500, 1000, 2000]; // delay BEFORE attempt 2, 3, and after attempt 3 respectively — see loop logic

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a connector SDK call with retry-on-transient-failure semantics.
 *
 * - Generates ONE idempotency key before the first attempt, reused across
 *   all retry attempts of this same logical operation (NOT regenerated per attempt).
 * - `fn` receives that idempotency key so callers can forward it to connectors
 *   that support idempotency (e.g. Stripe's `Idempotency-Key`), if the connector
 *   call site chooses to use it.
 * - Retries up to MAX_ATTEMPTS (3) total attempts, with delays of 500ms, 1000ms,
 *   2000ms between attempts, ONLY if `isTransientConnectorError(error)` returns true.
 * - On a non-transient (business/validation) error, fails immediately with zero retries.
 * - On exhausting all retries, throws the LAST error encountered (not a wrapped/generic one)
 *   so callers see the original connector SDK error shape.
 */
export async function retryConnectorCall<T>(
    fn: (idempotencyKey: string) => Promise<T>,
): Promise<ConnectorRetryResult<T>> {
    const idempotencyKey = randomUUID();
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const result = await fn(idempotencyKey);
            return { result, retryCount: attempt - 1, idempotencyKey };
        } catch (error) {
            lastError = error;

            const isLastAttempt = attempt === MAX_ATTEMPTS;
            if (isLastAttempt || !isTransientConnectorError(error)) {
                throw error;
            }

            const delay = DELAYS_MS[attempt - 1];
            await sleep(delay);
        }
    }

    // Unreachable, but satisfies TypeScript's control-flow analysis
    throw lastError;
}
