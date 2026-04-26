# agentlog Roadmap

## One-liner

**Local-first audit logs for TypeScript AI agents, starting with Vercel AI SDK.**

## README first lines (locked)

```
agentlog is a local, tamper-evident audit logger for TypeScript AI agents.

v0.1 supports Vercel AI SDK generateText. streamText support ships in v0.2.

Boring enough to ship. Solid enough to build on.
```

## Value proposition

- Developer hook: "I deployed an agent and have no idea what it actually ran."
- Second line: Tamper-evident audit logs for production AI agents.
- Enterprise hook (later): compliance export.

---

## Current status — 2026-04-27

### Published package names

```
@asafhm/agentlog-core
@asafhm/agentlog-vercel-ai
@asafhm/agentlog
```

The CLI package still exposes the `agentlog` binary.

### Shipped

- `generateText` support
- `streamText` support
- JSONL writer under `${AGENTLOG_DIR || ".agentlog"}/runs/<runId>.jsonl`
- completed-run tail anchors via `<runId>.head.json`
- runId/filename binding in `verifyFile`
- structured `VerifyResult.details.code`
- metadata-only capture by default, full capture opt-in
- examples for generateText and streamText
- CLI `verify`, `view`, and first-pass `studio`

### Current milestone

**v0.2.0-alpha → polish agentlog studio over existing JSONL files.**

Goal: make the logs visible before making them enterprise-ready.

Scope:

- `agentlog studio`
- local browser UI
- reads existing `.agentlog/runs/*.jsonl`
- verifies each run using `verifyFile`
- shows run list, validity, event count, and failure code
- click a run to inspect the event timeline
- no SQLite requirement

---

## Forward roadmap

### v0.2.0-alpha

```
README + roadmap cleanup
tag v0.2.0-alpha
start agentlog studio over JSONL files
```

### v0.2.0

```
agentlog studio over JSONL files
generateText + streamText examples
tail-anchor verification for completed runs
structured verify errors
```

### v0.2.1 or v0.3

```
SQLite storage adapter
run list/query performance improvements
```

### v0.3

```
Article 12 / DSAR export
redaction audit trail with actor + legal basis
retention/pruning (--max-age)
verifyFileDetailed
```

### v0.4

```
Annex IV stub
captureStack: true opt-in for ErrorPayload
```

### v0.5

```
LangChain adapter
Mastra adapter
```

### v0.6

```
OTel bridge
```

### Later

```
MCP
Hosted dashboard
Turborepo
```

---

## Historical v0.1 spec

## v0.1 — Locked spec

### Packages

```
@agentlog/core
@agentlog/vercel-ai
agentlog (CLI)
```

### Tooling (locked)

```
Package manager:  pnpm
Monorepo:         pnpm workspaces (no Turborepo yet)
Build tool:       tsup
Runtime target:   Node >= 18
Module format:    ESM only
Types:            generated .d.ts via tsup
```

### Scaffold (locked)

```
agentlog/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json

  packages/
    core/
      package.json       { "type": "module", "main": "./dist/index.js", "types": "./dist/index.d.ts" }
      tsconfig.json
      tsup.config.ts     entry: ['src/index.ts'], format: ['esm'], dts: true
      src/
        types.ts
        crypto.ts
        logger.ts
        verify.ts
        index.ts

    vercel-ai/
      package.json       { "type": "module", dependencies: { "@agentlog/core": "workspace:*" } }
      tsconfig.json
      tsup.config.ts
      src/
        index.ts

  apps/
    cli/
      package.json       { "bin": { "agentlog": "./dist/index.js" } }
      tsconfig.json
      tsup.config.ts     banner: { js: '#!/usr/bin/env node' }
      src/
        index.ts

  examples/
    vercel-generate-text/
```

### Build order (locked)

```
1.  Create scaffold + package.json files
2.  Confirm imports compile (empty scaffold commit)
3.  @agentlog/core — types + crypto
4.  @agentlog/core — createRun / appendEvent / JSONL writer
5.  @agentlog/core — .gitignore protection on createRun
6.  @agentlog/core — verify
7.  @agentlog/vercel-ai — generateText wrapper
8.  CLI — verify command
9.  CLI — view / view --run <id>
10. Working example (definition of done)
```

### Event schema (locked)

```ts
export type BaseEvent<T extends string, P> = {
  id: string        // nanoid
  runId: string
  seq: number       // monotonic, no gaps
  type: T
  ts: number        // unix ms, forward-only
  payload: P
  prevHash: string  // sha256("agentlog-genesis-v1") for first event
  hash: string      // sha256(prevHash + JSON.stringify({id,runId,seq,type,ts,payload}))
}

type RedactionReason = "gdpr_erasure" | "user_request" | "legal_hold"

type RunStartPayload  = { schemaVersion: "1"; agentName?: string; framework: "vercel-ai"; model?: string; captureMode: "metadata" | "full"; startedAt: number }
type RunEndPayload    = { status: "success" | "error"; totalEvents: number; durationMs: number; errorMessage?: string }
type MetadataPayload  = { model?: string; latencyMs?: number; tokenCount?: { prompt?: number; completion?: number; total?: number }; finishReason?: string }
type FullPayload      = MetadataPayload & { prompt?: string; response?: string }
type ToolPayload      = { toolName: string; input?: unknown; output?: unknown; latencyMs?: number }
type ErrorPayload     = { message: string; name?: string }
type RedactedPayload  = { targetEventId: string; reason: RedactionReason }

type Event =
  | BaseEvent<"run_start",    RunStartPayload>
  | BaseEvent<"prompt",       MetadataPayload | FullPayload>
  | BaseEvent<"response",     MetadataPayload | FullPayload>
  | BaseEvent<"tool_call",    ToolPayload>
  | BaseEvent<"tool_result",  ToolPayload>
  | BaseEvent<"error",        ErrorPayload>
  | BaseEvent<"redacted",     RedactedPayload>
  | BaseEvent<"run_end",      RunEndPayload>
```

### Privacy decisions (locked)

```
Default capture mode:   metadata only (no prompt/response content)
Full capture:           opt-in via { capture: "full" }
Stack traces:           excluded in v0.1, opt-in later via captureStack: true
```

### Crypto (locked)

```
Algorithm:    SHA-256 via Web Crypto API (crypto.subtle.digest)
              — compatible with Node 18+, Vercel Edge, Cloudflare Workers
Genesis:      sha256("agentlog-genesis-v1") — versioned, not "genesis"
Utility:      bufferToHex(ArrayBuffer) → hex string  (lives in crypto.ts)
```

### Verify checks (locked)

```
1. Hash chain is valid
2. seq is monotonic — no gaps, no duplicates
3. ts never goes backward

Error format:
  ✗ run abc123 failed
  ✗ event seq=7 hash mismatch
  ✗ timestamp: 2026-04-26T10:12:33Z
```

### Storage (locked)

```
Path:     ${AGENTLOG_DIR || ".agentlog"}/runs/<runId>.jsonl
Config:   AGENTLOG_DIR env var
gitignore: auto-add .agentlog/ on createRun
          create .gitignore if missing
          warn if .agentlog/ is already tracked
```

### CLI commands (locked)

```
agentlog verify              — verify hash chain for all runs
agentlog view                — list all runs
agentlog view --run <id>     — full run detail (terminal, v0.1)
agentlog studio              — reserved for browser UI (v0.2+)
```

### @agentlog/vercel-ai (locked)

```
Wrapper for generateText only
streamText:  documented as v0.2, not a bug
Capture:     metadata by default, full opt-in
```

### View — run list format

```
abc123  support-agent  success  6 events  1.3s
```

---

## Differentiators

1. Local-first / zero egress
2. Hash-chain audit log — tamper-evident, not just logged
3. Vercel AI SDK first — largest TS AI developer surface
4. Metadata-only default — privacy-safe out of the box
5. Edge-compatible crypto — Node, Vercel Edge, Cloudflare Workers
6. CLI verify — proves value without a dashboard
7. Self-describing JSONL — schemaVersion + captureMode on line one

---

## What is not in v0.1

```
streamText           → v0.2 shipped
SQLite               → v0.2.1 or v0.3
browser UI           → v0.2
Article 12 export    → v0.3
Annex IV stub        → v0.4
stack traces         → v0.4
LangChain / Mastra   → v0.5
OTel bridge          → v0.6
MCP                  → later
Turborepo            → later
```

---

## Notes

- Lead with developer pain, not compliance. Compliance is the enterprise upsell.
- Competing with `console.log` in v0.1, not Langsmith or Honeycomb.
- consumers must read `run_start` event to know captureMode before interpreting prompt/response payloads.
- Example in `examples/vercel-generate-text/` is part of the v0.1 definition of done.
