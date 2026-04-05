import { Octokit } from '@octokit/rest';
import type { ConnectorAction } from '../agentreinClient';
type ResourceUrlResolver = any;

// ─── Client (lazy singleton) ────────────────────────────

let _client: Octokit | null = null;

function client(): Octokit {
    if (!_client) {
        if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN not set');
        _client = new Octokit({ auth: process.env.GITHUB_TOKEN });
    }
    return _client;
}

// ─── Types ──────────────────────────────────────────────

interface IssueCreateParams {
    owner: string;
    repo: string;
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
    [key: string]: unknown;
}

interface IssueUpdateParams {
    owner: string;
    repo: string;
    issue_number: number;
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    labels?: string[];
    assignees?: string[];
    [key: string]: unknown;
}

interface RepoDeleteParams {
    owner: string;
    repo: string;
    [key: string]: unknown;
}

// ─── Resource URL Resolvers ─────────────────────────────

const GITHUB_API = 'https://api.github.com';

const issueUrlResolver: ResourceUrlResolver = (_apiName: string, payload: any) => {
    const owner = payload.owner as string | undefined;
    const repo = payload.repo as string | undefined;
    const issueNumber = payload.issue_number as number | undefined;
    if (!owner || !repo || !issueNumber) return null;
    return `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}`;
};

const repoUrlResolver: ResourceUrlResolver = (_apiName: string, payload: any) => {
    const owner = payload.owner as string | undefined;
    const repo = payload.repo as string | undefined;
    if (!owner || !repo) return null;
    return `${GITHUB_API}/repos/${owner}/${repo}`;
};

// ─── Typed Actions ──────────────────────────────────────

const issuesCreate: ConnectorAction<IssueCreateParams, unknown> = {
    apiName: 'github.issues.create',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: issueUrlResolver,
    execute: (args) => client().issues.create(args),
};

const issuesUpdate: ConnectorAction<IssueUpdateParams, unknown> = {
    apiName: 'github.issues.update',
    operationType: 'UPDATE',
    // @ts-ignore
    resourceUrlResolver: issueUrlResolver,
    getState: async (args: IssueUpdateParams) => {
        const res = await client().issues.get({
            owner: args.owner,
            repo: args.repo,
            issue_number: args.issue_number,
        });
        return res.data;
    },
    execute: (args) => client().issues.update(args),
};

const reposDelete: ConnectorAction<RepoDeleteParams, unknown> = {
    apiName: 'github.repos.delete',
    operationType: 'DELETE',
    // @ts-ignore
    resourceUrlResolver: repoUrlResolver,
    execute: (args) => client().repos.delete(args),
};

// ─── Export ─────────────────────────────────────────────

export const github = {
    issues: {
        create: issuesCreate,
        update: issuesUpdate,
    },
    repos: {
        delete: reposDelete,
    },
} as const;
