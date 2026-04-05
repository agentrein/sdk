import axios from 'axios';
import { ConnectorAction } from '../agentreinClient';

export interface NotionPage {
    id: string;
    properties: Record<string, unknown>;
    parent: Record<string, unknown>;
    url: string;
}

export interface NotionBlock {
    id: string;
    type: string;
    [key: string]: unknown;
}

export interface NotionPageCreateArgs {
    parent: Record<string, unknown>;
    properties: Record<string, unknown>;
    children?: Record<string, unknown>[];
}

export interface NotionPageUpdateArgs {
    id: string;
    properties: Record<string, unknown>;
}

export interface NotionDatabaseItemCreateArgs {
    databaseId: string;
    properties: Record<string, unknown>;
}

export interface NotionBlockAppendArgs {
    blockId: string;
    children: Record<string, unknown>[];
}

export interface NotionBlockAppendResult {
    results: NotionBlock[];
}

export function getNotionHeaders(): Record<string, string> {
    return {
        Authorization: `Bearer ${process.env.NOTION_API_KEY ?? ''}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
    };
}

export const notionPagesCreate: ConnectorAction<NotionPageCreateArgs, NotionPage> = {
    apiName: 'notion.pages.create',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    execute: async (args) => {
        const res = await axios.post(
            'https://api.notion.com/v1/pages',
            { parent: args.parent, properties: args.properties, children: args.children ?? [] },
            { headers: getNotionHeaders() }
        );
        return res.data as NotionPage;
    }
};

export const notionPagesUpdate: ConnectorAction<NotionPageUpdateArgs, NotionPage> = {
    apiName: 'notion.pages.update',
    operationType: 'UPDATE',
    // @ts-ignore
    resourceUrlResolver: (apiName: string, payload: any) => `https://api.notion.com/v1/pages/${payload.id}`,
    getState: async (args: NotionPageUpdateArgs) => {
        const res = await axios.get(
            `https://api.notion.com/v1/pages/${args.id}`,
            { headers: getNotionHeaders() }
        );
        return res.data;
    },
    execute: async (args) => {
        const res = await axios.patch(
            `https://api.notion.com/v1/pages/${args.id}`,
            { properties: args.properties },
            { headers: getNotionHeaders() }
        );
        return res.data as NotionPage;
    }
};

export const notionDatabaseItemsCreate: ConnectorAction<NotionDatabaseItemCreateArgs, NotionPage> = {
    apiName: 'notion.database_items.create',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    execute: async (args) => {
        const res = await axios.post(
            'https://api.notion.com/v1/pages',
            { parent: { database_id: args.databaseId }, properties: args.properties },
            { headers: getNotionHeaders() }
        );
        return res.data as NotionPage;
    }
};

export const notionBlocksAppend: ConnectorAction<NotionBlockAppendArgs, NotionBlockAppendResult> = {
    apiName: 'notion.blocks.append',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    execute: async (args) => {
        const res = await axios.patch(
            `https://api.notion.com/v1/blocks/${args.blockId}/children`,
            { children: args.children },
            { headers: getNotionHeaders() }
        );
        return res.data as NotionBlockAppendResult;
    }
};
