import { google } from 'googleapis';
import { ConnectorAction } from '../agentreinClient';

export interface GmailMessage {
    id: string;
    threadId: string;
    labelIds?: string[];
    snippet?: string;
}

export interface GmailDraft {
    id: string;
    message: GmailMessage;
}

export interface GmailSendArgs {
    to: string;
    subject: string;
    body: string;
    from?: string;
}

export interface GmailTrashArgs {
    messageId: string;
}

export interface GmailDraftCreateArgs {
    to: string;
    subject: string;
    body: string;
}

export interface GmailLabelModifyArgs {
    messageId: string;
    addLabelIds: string[];
    removeLabelIds: string[];
}

export function getGmailClient() {
    const auth = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
    );
    auth.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    });
    return google.gmail({ version: 'v1', auth });
}

function encodeEmail(to: string, subject: string, body: string, from?: string): string {
    const email = [
        `To: ${to}`,
        from ? `From: ${from}` : '',
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        body,
    ]
        .filter(Boolean)
        .join('\r\n');
    return Buffer.from(email).toString('base64url');
}

export const gmailMessagesSend: ConnectorAction<GmailSendArgs, GmailMessage> = {
    apiName: 'gmail.messages.send',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    execute: async (args) => {
        const res = await getGmailClient().users.messages.send({ 
            userId: 'me', 
            requestBody: { raw: encodeEmail(args.to, args.subject, args.body, args.from) } 
        });
        return res.data as GmailMessage;
    }
};

export const gmailMessagesTrash: ConnectorAction<GmailTrashArgs, GmailMessage> = {
    apiName: 'gmail.messages.trash',
    operationType: 'UPDATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    execute: async (args) => {
        const res = await getGmailClient().users.messages.trash({ 
            userId: 'me', 
            id: args.messageId 
        });
        return res.data as GmailMessage;
    }
};

export const gmailDraftsCreate: ConnectorAction<GmailDraftCreateArgs, GmailDraft> = {
    apiName: 'gmail.drafts.create',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    execute: async (args) => {
        const res = await getGmailClient().users.drafts.create({ 
            userId: 'me', 
            requestBody: { message: { raw: encodeEmail(args.to, args.subject, args.body) } } 
        });
        return res.data as GmailDraft;
    }
};

export const gmailLabelsModify: ConnectorAction<GmailLabelModifyArgs, GmailMessage> = {
    apiName: 'gmail.labels.modify',
    operationType: 'UPDATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    getState: async (args: GmailLabelModifyArgs) => {
        const res = await getGmailClient().users.messages.get({
            userId: 'me',
            id: args.messageId,
        });
        return res.data;
    },
    execute: async (args) => {
        const res = await getGmailClient().users.messages.modify({ 
            userId: 'me', 
            id: args.messageId, 
            requestBody: { addLabelIds: args.addLabelIds, removeLabelIds: args.removeLabelIds } 
        });
        return res.data as GmailMessage;
    }
};
