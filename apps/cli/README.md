# agentlog

Local-first audit logs for AI agents.

agentlog records prompts, tool calls, responses, and errors as tamper-evident JSONL files on disk. Use it to debug what happened, inspect runs locally, and verify that a run log was not edited after the fact.

- Local files, no cloud service
- Hash-chained events for tamper evidence
- Vercel AI SDK integration
- CLI verification and timeline view
- Local Studio UI for browsing runs

Runs are written to `.agentlog/runs/*.jsonl` and gitignored by default.

---

## Packages

| Package | Description |
|---|---|
| `@asafhm/agentlog-core` | Core logger — create runs, append events, verify files |
| `@asafhm/agentlog-vercel-ai` | Vercel AI SDK adapter for `generateText` and `streamText` |
| `@asafhm/agentlog` | CLI — `verify`, `view`, and `studio` commands |

---

## Install

```bash
npm install @asafhm/agentlog-core@alpha @asafhm/agentlog-vercel-ai@alpha
npm install -g @asafhm/agentlog@alpha  # CLI
```

---

## Vercel AI SDK

### generateText

```ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createAgentLogger } from '@asafhm/agentlog-vercel-ai';

const { telemetry, onError } = createAgentLogger({ agentName: 'my-agent' });

try {
  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    prompt: 'Explain SQL joins',
    experimental_telemetry: telemetry,
  });
  console.log(text);
} catch (err) {
  onError(err);
  throw err;
}
// → .agentlog/runs/<runId>.jsonl
```

### streamText

`onError` plugs in directly — no try/catch needed:

```ts
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createAgentLogger } from '@asafhm/agentlog-vercel-ai';

const { telemetry, onError } = createAgentLogger({ agentName: 'stream-agent' });

const result = streamText({
  model: openai('gpt-4o-mini'),
  prompt: 'Explain SQL joins',
  experimental_telemetry: telemetry,
  onError,
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
// → .agentlog/runs/<runId>.jsonl
```

By default, agentlog records metadata only: timestamps, event types, durations, and tool names. No prompt content is captured unless you opt in — see [Capture modes](#capture-modes).

---

## Core API

For use outside the Vercel AI SDK:

```ts
import { createRun, verifyFile } from '@asafhm/agentlog-core';

const run = createRun({ agentName: 'my-agent' });
run.append('prompt', { model: 'gpt-4o' });
run.append('response', { usage: { promptTokens: 5, completionTokens: 20 } });
run.end('success');

const result = await verifyFile(`.agentlog/runs/${run.runId}.jsonl`);
console.log(result); // { valid: true, eventsChecked: 4 }
```

---

## Inspect a run

```bash
agentlog view .agentlog/runs/<runId>.jsonl
```

```
[0] 2026-04-28 12:00:00Z  run_start
[1] 2026-04-28 12:00:01Z  prompt
      model: {"provider":"openai","modelId":"gpt-4o-mini"}
[2] 2026-04-28 12:00:02Z  tool_call
      tool: "lookupOrder"
[3] 2026-04-28 12:00:02Z  tool_result
      tool: "lookupOrder"
      success: true
[4] 2026-04-28 12:00:03Z  response  (1821ms)
      usage: {"inputTokens":89,"outputTokens":18}
[5] 2026-04-28 12:00:03Z  run_end
      status: "success"
```

---

## Verify integrity

```bash
agentlog verify .agentlog/runs/<runId>.jsonl
```

```
✓ Valid — 6 events verified
```

Tamper with any line and re-run:

```
✗ Invalid — Hash mismatch at seq 2
```

---

## Studio

```bash
agentlog studio
```

Opens `http://127.0.0.1:3001` — a local UI showing all runs, event timelines, and verification status.

**Run list** — every run with its verify status at a glance:

![agentlog studio run list](docs/studio-runs.png)

**Event timeline** — what the agent actually did, step by step:

![agentlog studio timeline](docs/studio-timeline.png)

---

## Capture modes

| Mode | What is recorded |
|---|---|
| `metadata` (default) | Timestamps, event types, durations, tool names |
| `full` | Everything above plus prompts, responses, tool inputs/outputs |

```ts
const { telemetry, onError } = createAgentLogger({
  agentName: 'my-agent',
  captureMode: 'full',
});
```

`full` mode keeps all data local but may capture sensitive content. Review what your prompts and tool outputs contain before enabling it in production.

---

## How it works

Each event is hashed with SHA-256 over its fields plus the previous event's hash, forming a chain. `verifyFile` recomputes every hash and checks:

- Sequence numbers are contiguous from 0
- Each `prevHash` matches the previous event's hash
- Each stored hash matches the recomputed hash

Any modification, insertion, or deletion breaks every subsequent hash. Completed runs also write a `.head.json` sidecar — if present, tail truncation is detected too.

`verifyFile` returns structured details on failure:

```ts
result.details?.code          // e.g. "HASH_MISMATCH"
result.details?.lastValidSeq  // last sequence number known good
```

---

## Auditability

agentlog is not a compliance product by itself, but it is designed for teams that need trustworthy records of AI system behavior. Its append-only, hash-chained logs can support audit, debugging, incident review, and regulated AI workflows.

---

## CLI reference

```bash
agentlog verify <run.jsonl>   # verify integrity — exits 1 if invalid
agentlog view <run.jsonl>     # human-readable event timeline
agentlog studio               # local browser UI at http://127.0.0.1:3001
```

`AGENTLOG_DIR` — storage location (default: `.agentlog`)
`AGENTLOG_STUDIO_PORT` — studio port (default: `3001`)

---

## Event types

| Event | When |
|---|---|
| `run_start` | Created automatically by `createRun()` |
| `prompt` | Before an LLM call |
| `tool_call` | When a tool is invoked |
| `tool_result` | When a tool returns |
| `response` | After an LLM call |
| `late_error` | Error after run completed |
| `error` | On caught errors |
| `run_end` | Created by `run.end(status)` |

---

## Status

Alpha. Core API is stable; expect changes before 1.0.

---

## License

MIT
