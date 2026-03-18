# AgentRein SDK - Node.js Client

**AgentRein** is an AI Agent Reliability Platform that provides automatic rollback, approval gates, and intent verification for AI workflows. This SDK allows you to easily integrate AgentRein into your Node.js applications.

---

## 📦 Install

```bash
npm install agentrein
```

## 🚀 Quick Start

```typescript
import { AgentRein } from 'agentrein'

const agentrein = new AgentRein({
  apiKey: process.env.AGENTREIN_API_KEY, // Your Organization API Key
  intentVerification: true,              // Enable LLM intent check
})

async function runAgent() {
  // 1. Create a session with a clear intent
  const session = await agentrein.newSession({
    agentId: 'support-agent-01',
    intent: 'Refund customer cus_123 for order ord_456'
  })

  try {
    // 2. Wrap your external API calls
    const result = await agentrein.call(
      stripe.refunds.create, // The function to execute
      session,               // The current session
      { 
        type: 'http-delete', 
        url: 'https://api.stripe.com/v1/refunds/re_123' 
      },                     // Undo configuration (if rollback is needed)
      { charge: 'ch_789' }   // Original function arguments
    )

    console.log('Action executed safely:', result)
  } catch (error) {
    // 3. AgentRein automatically triggers rollback on failure
    console.error('Action failed, rolling back previous steps...', error)
  }
}
```

## 🧠 Key Concepts

### Sessions
A `Session` groups multiple actions together. If any action in the session fails, AgentRein will attempt to roll back all previous successful actions in that session in reverse order.

### Intent Verification
By providing an `intent` when creating a session, AgentRein uses an LLM to verify that each subsequent action aligns with the user's original goal. If "drift" is detected, the action can be flagged or blocked.

### Approval Gates
You can configure rules in the [AgentRein Dashboard](https://agentrein.com/sessions) to require human approval for high-risk actions before they are executed.

## 🛠️ Configuration

| Option | Type | Description |
| :--- | :--- | :--- |
| `apiKey` | `string` | **Required**. Your organization's API key. |
| `baseUrl` | `string` | Optional. Defaults to `https://api.agentrein.com`. |
| `intentVerification` | `boolean` | Optional. Enable/disable LLM drift detection. |

## 📄 License

MIT
