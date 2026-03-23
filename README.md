# agentrein

The safety net for AI agents. Automatic rollback, approval gates, and intent verification.

[![npm version](https://badge.fury.io/js/agentrein.svg)](https://www.npmjs.com/package/agentrein)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install agentrein
```

## Quick Start

```typescript
// ESM
import { AgentRein } from 'agentrein'

// CJS
const { AgentRein } = require('agentrein')

// Initialize the client
const agentrein = new AgentRein({
  apiKey: process.env.AGENTREIN_API_KEY!,
})

// Create a session describing what your agent intends to do
const session = await agentrein.newSession({
  agentId: 'billing-agent',
  intent: 'Send Q4 invoices to all customers',
})

// Wrap any API call — AgentRein logs it and auto-rolls back on failure
await agentrein.call(
  stripe.invoices.create,
  session,
  { customer: 'cus_123', amount: 5000 }
)
// If stripe.invoices.create throws, AgentRein automatically triggers
// a server-side LIFO rollback of all actions in this session.
```

## Core Concepts

| Concept | Description |
|---|---|
| **Sessions** | One agent workflow. All actions are grouped under a single session so rollback can undo them as a unit. |
| **Actions** | Every `call()` is logged with the full payload and response, creating a complete audit trail. |
| **Rollback** | On any failure, AgentRein triggers a LIFO (last-in-first-out) undo of every action in the session. |
| **Approval Gate** | Flag high-risk actions with `requiresApproval: true` to block execution until a human approves from the dashboard. |
| **Fail-Open** | If the AgentRein server is unreachable, your agent continues normally by default — safety never blocks production. |

## API Reference

### `new AgentRein(options)`

Create a new AgentRein client instance.

| Option | Type | Default | Required | Description |
|---|---|---|---|---|
| `apiKey` | `string` | — | yes | Organization API key |
| `serverUrl` | `string` | `https://api.agentrein.com` | no | Custom server URL |
| `failureMode` | `'open' \| 'closed'` | `'open'` | no | Behavior when server is unreachable |

```typescript
const agentrein = new AgentRein({
  apiKey: 'ak_live_...',
  serverUrl: 'https://api.agentrein.com',
  failureMode: 'open',
})
```

---

### `agentrein.newSession(options?)`

Create a new agent session.

```typescript
// With full options (recommended)
const session = await agentrein.newSession({
  agentId: 'billing-agent',
  intent: 'Send Q4 invoices to all customers',
})

// String shorthand (agentId only)
const session = await agentrein.newSession('billing-agent')

// No args — auto-generated agentId
const session = await agentrein.newSession()
```

**Returns:** `Session` object with `id`, `organizationId`, `agentId`, `intent`, `status`, `startedAt`, `endedAt`.

---

### `agentrein.call(fn, session, ...args, options?)`

Execute a function under AgentRein's protection. The call is logged, and on failure the entire session is rolled back.

```typescript
// Basic usage
await agentrein.call(
  stripe.invoices.create,
  session,
  { customer: 'cus_123', amount: 5000 }
)

// With custom action name
await agentrein.call(
  stripe.invoices.create,
  session,
  { customer: 'cus_123', amount: 5000 },
  { actionName: 'stripe.invoices.create' }
)

// With approval gate
await agentrein.call(
  stripe.invoices.create,
  session,
  { customer: 'cus_123', amount: 500000 },
  {
    requiresApproval: true,
    pollIntervalMs: 2000,
    timeoutMs: 300000,
  }
)
```

#### `CallOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `actionName` | `string` | `fn.name` | Override the logged action name |
| `requiresApproval` | `boolean` | `false` | Block until a human approves from the dashboard |
| `pollIntervalMs` | `number` | `2000` | Approval polling interval in ms |
| `timeoutMs` | `number` | `300000` | Approval timeout in ms (5 min) |

---

### `agentrein.resumeSession(sessionId)` / `agentrein.getSession(sessionId)`

Both are aliases — returns the full session with all actions.

```typescript
const session = await agentrein.resumeSession('sess_abc123')
// or
const session = await agentrein.getSession('sess_abc123')
```

## Approval Gate

Flag any action with `requiresApproval: true` to require human sign-off before execution.

**Flow:**

1. `call()` logs the action as `PENDING_APPROVAL`
2. SDK polls `GET /approvals/:id` at the configured interval
3. A reviewer approves or rejects from the AgentRein dashboard
4. **Approved** → `fn()` executes → action updated to `SUCCESS`
5. **Rejected** → `ApprovalRejectedError` thrown → session rollback triggered

**Error handling:**

```typescript
import { AgentRein, ApprovalRejectedError } from 'agentrein'

try {
  await agentrein.call(fn, session, args, { requiresApproval: true })
} catch (err) {
  if (err instanceof ApprovalRejectedError) {
    console.log('Rejected:', err.reason)
    // rollback already triggered automatically
  }
}
```

## Error Reference

| Error | When Thrown |
|---|---|
| `AgentReinUnavailableError` | Server unreachable during `newSession()` or token fetch. In fail-closed mode, also thrown from `call()`. |
| `ApprovalRejectedError` | Reviewer rejected the action. Has a `.reason` property. |
| `ApprovalTimeoutError` | Approval not received within `timeoutMs`. |

## Fail Modes

| Mode | Behavior | When to Use |
|---|---|---|
| `'open'` (default) | If server is down, `call()` executes unprotected | Most use cases |
| `'closed'` | If server is down, `call()` throws `AgentReinUnavailableError` | Finance, healthcare |

## Supported Connectors

Built-in undo strategies for popular services:

| Connector | Actions | Undo Strategy |
|---|---|---|
| **Stripe** | `stripe.invoices.create`, `stripe.customers.create` | Direct delete |
| **Slack** | `slack.chat.postMessage` | Correction message in thread |
| **GitHub** | `github.issues.create` | Close issue |
| **HubSpot** | `hubspot.contacts.create/update`, `hubspot.deals.create/update` | Delete / restore `beforeState` |
| **Salesforce** | `salesforce.contacts.create/update`, `salesforce.opportunities.create/update` | Delete / restore `beforeState` |
| **Notion** | `notion.pages.create/update`, `notion.database_items.create`, `notion.blocks.append` | Archive / restore / delete blocks |
| **Gmail** | `gmail.messages.send/trash`, `gmail.drafts.create`, `gmail.labels.modify` | Correction reply / untrash / delete / reverse labels |
| **Google Drive** | `gdrive.files.create/update/move/trash` | Delete / restore / reverse move / untrash |
| **Google Sheets** | `gsheets.values.append/update`, `gsheets.spreadsheets.create`, `gsheets.sheets.add` | Clear / restore / delete |

## Links

- [Documentation](https://agentrein.com/docs)
- [Dashboard](https://app.agentrein.com)
- [GitHub](https://github.com/agentrein/sdk)
