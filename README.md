# agentlog

Tamper-evident audit logging for TypeScript AI agents.

Every prompt, tool call, and response is written to a local JSONL file with a SHA-256 hash chain. You can prove after the fact that the log was not modified.

---

## Packages

| Package | Description |
|---|---|
| `@asafhm/agentlog-core` | Core logger — create runs, append events, verify files |
| `@asafhm/agentlog-vercel-ai` | Vercel AI SDK adapter for `generateText` |
| `agentlog` | CLI — `verify` and `view` commands |

---

## Install

```bash
npm install @asafhm/agentlog-core
```

With Vercel AI SDK:

```bash
npm install @asafhm/agentlog-core @asafhm/agentlog-vercel-ai
```

CLI (global):

```bash
npm install -g agentlog
```

---

## Quick start

### Core

```ts
import { createRun, verifyFile } from '@asafhm/agentlog-core';

const run = createRun({ agentName: 'my-agent' });

run.append('prompt', { model: 'gpt-4o' });
run.append('response', { usage: { promptTokens: 5, completionTokens: 2 } });
run.end('success');

const result = await verifyFile(`.agentlog/runs/${run.runId}.jsonl`);
console.log(result); // { valid: true, eventsChecked: 5 }
```

### Vercel AI SDK

```ts
import { generateText, tool, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { createAgentLogger } from '@asafhm/agentlog-vercel-ai';

const { telemetry, runId, onError } = createAgentLogger({ agentName: 'support-agent' });

let result;
try {
  result = await generateText({
    model: openai('gpt-4o-mini'),
    prompt: 'What is the weather in Tel Aviv?',
    experimental_telemetry: telemetry,
    tools: {
      getWeather: tool({
        description: 'Get weather for a city',
        inputSchema: z.object({ city: z.string() }),
        execute: async ({ city }) => ({ city, temp: 28, condition: 'sunny' }),
      }),
    },
    stopWhen: stepCountIs(3),
  });
} catch (error) {
  onError(error);
  throw error;
}

console.log(result.text);
// Log file: .agentlog/runs/<runId>.jsonl
```

### streamText

`onError` plugs in directly — no try/catch wrapper needed:

```ts
import { streamText, tool, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { createAgentLogger } from '@asafhm/agentlog-vercel-ai';

const { telemetry, runId, onError } = createAgentLogger({ agentName: 'stream-agent' });

const result = streamText({
  model: openai('gpt-4o-mini'),
  prompt: 'What is the weather in Tel Aviv?',
  experimental_telemetry: telemetry,
  onError,
  tools: {
    getWeather: tool({
      description: 'Get weather for a city',
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ city, temp: 28, condition: 'sunny' }),
    }),
  },
  stopWhen: stepCountIs(3),
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
// Log file: .agentlog/runs/<runId>.jsonl
```

---

## Tail anchor

When a run completes, agentlog writes a sidecar file alongside the log:

```
.agentlog/runs/<runId>.head.json  →  { runId, seq, hash, endedAt }
```

`verifyFile` checks this file if present. If the log was truncated after the run completed, verification fails with `Tail anchor mismatch`. Logs without a head file (in-progress or pre-v0.2) are verified as before — the head file is optional.

---

## CLI

```bash
# Verify a run log (exits 1 if tampered)
agentlog verify .agentlog/runs/<runId>.jsonl

# View a run log as a human-readable timeline
agentlog view .agentlog/runs/<runId>.jsonl

# Open local browser studio for existing JSONL runs
agentlog studio
```

Studio serves a local UI at `http://127.0.0.1:3001`, reads
`.agentlog/runs/*.jsonl`, verifies each run, and lets you inspect the event
timeline. Set `AGENTLOG_STUDIO_PORT` to choose a different port.

Example `view` output:

```
[0] 2026-04-26 15:39:22Z  run_start
      schemaVersion: "1"
      framework: "agentlog"
[1] 2026-04-26 15:39:22Z  prompt
      model: {"provider":"openai","modelId":"gpt-4o-mini"}
[2] 2026-04-26 15:39:25Z  tool_call
      tool: "getWeather"
[3] 2026-04-26 15:39:25Z  tool_result
      tool: "getWeather"
      success: true
[4] 2026-04-26 15:39:26Z  response
      usage: {"inputTokens":89,"outputTokens":18}
[5] 2026-04-26 15:39:26Z  run_end
      status: "success"
```

---

## How it works

Each event is hashed with SHA-256 over its own fields plus the previous event's hash, forming a chain. `verifyFile` recomputes every hash and checks:

- Sequence numbers are contiguous starting from 0 (no gaps, no duplicates)
- Each `prevHash` matches the previous event's `hash`
- Each stored `hash` matches the recomputed hash

The chain detects modifications, insertions, and deletion of events within the
recorded chain. Completed runs also write a `.head.json` tail anchor — if present,
`verifyFile` will detect tail truncation. Runs without a head file (crashed or
pre-v0.2) verify chain integrity only.

On failure, `verifyFile` preserves the human-readable `error` string and also
returns structured details for tooling:

```ts
result.details?.code         // e.g. "HASH_MISMATCH"
result.details?.lastValidSeq // last sequence number known to be valid
```

Logs are stored in `.agentlog/runs/` relative to your project root. Set `AGENTLOG_DIR` to change the location.

---

## Event types

| Event | When |
|---|---|
| `run_start` | Created automatically by `createRun()` |
| `prompt` | Before an LLM call (request metadata) |
| `response` | After an LLM call (usage metadata) |
| `tool_call` | When a tool is invoked |
| `tool_result` | When a tool returns |
| `error` | On caught errors |
| `redacted` | Redaction marker — full Art. 17 tombstone semantics (actor, legal basis) in v0.2 |
| `run_end` | Created by `run.end(status)` |

---

## License

MIT
