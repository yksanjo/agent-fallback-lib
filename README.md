# Agent Fallback Library

Multi-layer fallback system for agent deployments in Node.js.

## Features

- **Multi-Layer Fallback**: Primary → Secondary → Tertiary → Human escalation
- **Retry with Backoff**: Exponential backoff with jitter
- **Circuit Breaker**: Automatic failure protection
- **Error Classification**: Classify errors and determine retryability
- **Quality Gates**: Response validation

## Installation

```bash
npm install agent-fallback-lib
```

## Usage

```typescript
import { AgentFallbackSystem } from 'agent-fallback-lib';

const system = new AgentFallbackSystem([
  { name: 'gpt-4', provider: 'openai', priority: 1 },
  { name: 'claude-3', provider: 'anthropic', priority: 2 },
], { maxRetries: 3 });

system.registerAdapter('gpt-4', async (req) => {
  // Your implementation
  return { success: true, content: 'response', agentName: 'gpt-4', metadata: { latency: 100, timestamp: Date.now(), retries: 0 } };
});

const result = await system.execute('Your prompt');
```

## License

MIT
