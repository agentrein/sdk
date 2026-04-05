import { WebClient } from '@slack/web-api';
import type {
    ChatPostMessageArguments,
    ChatPostMessageResponse,
    ChatUpdateArguments,
    ChatUpdateResponse,
    ChatDeleteArguments,
    ChatDeleteResponse,
} from '@slack/web-api';
import type { ConnectorAction } from '../agentreinClient';
type ResourceUrlResolver = any;

// ─── Client (lazy singleton) ────────────────────────────

let _client: WebClient | null = null;

function client(): WebClient {
    if (!_client) {
        if (!process.env.SLACK_TOKEN) throw new Error('SLACK_TOKEN not set');
        _client = new WebClient(process.env.SLACK_TOKEN);
    }
    return _client;
}

// ─── Resource URL Resolvers ─────────────────────────────

const SLACK_API = 'https://slack.com/api';

const messageUrlResolver: ResourceUrlResolver = (_apiName: string, payload: any) => {
    const channel = payload.channel as string | undefined;
    const ts = payload.ts as string | undefined;
    if (!channel || !ts) return null;
    // Slack doesn't have a single GET-by-ts endpoint, but
    // conversations.history with latest=ts&limit=1 works.
    return `${SLACK_API}/conversations.history?channel=${channel}&latest=${ts}&inclusive=true&limit=1`;
};

// ─── Typed Actions ──────────────────────────────────────

const chatPostMessage: ConnectorAction<
    ChatPostMessageArguments,
    ChatPostMessageResponse
> = {
    apiName: 'slack.chat.postMessage',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: messageUrlResolver,
    execute: (args) => client().chat.postMessage(args),
};

const chatUpdate: ConnectorAction<
    ChatUpdateArguments,
    ChatUpdateResponse
> = {
    apiName: 'slack.chat.update',
    operationType: 'UPDATE',
    // @ts-ignore
    resourceUrlResolver: messageUrlResolver,
    getState: async (args: ChatUpdateArguments) => {
        const res = await client().conversations.history({
            channel: args.channel as string,
            latest: args.ts as string,
            inclusive: true,
            limit: 1,
        });
        return res.messages?.[0] ?? null;
    },
    execute: (args) => client().chat.update(args),
};

const chatDelete: ConnectorAction<
    ChatDeleteArguments,
    ChatDeleteResponse
> = {
    apiName: 'slack.chat.delete',
    operationType: 'DELETE',
    // @ts-ignore
    resourceUrlResolver: messageUrlResolver,
    execute: (args) => client().chat.delete(args),
};

// ─── Export ─────────────────────────────────────────────

export const slack = {
    chat: {
        postMessage: chatPostMessage,
        update: chatUpdate,
        delete: chatDelete,
    },
} as const;
