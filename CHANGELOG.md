# Changelog

## 0.2.3-alpha.0

**Breaking:** runs written before this version will fail `verifyFile` — hash canonicalization now includes `agentName` and `durationMs` (schema v2). Legacy runs without `schemaVersion` in their `run_start` payload are verified with the old schema automatically.

- `end()` is now terminal — `append()` throws after `run_end` (except `late_error`)
- `onError` after `onFinish` now appends a `late_error` event instead of silently losing the error
- `.head.json` written atomically via temp file + rename
- `gitignore` defaults to `true` (opt-out) — protects sensitive prompt/response data by default
- Studio rejects cross-origin requests via `Origin` header check
- `AGENTLOG_STUDIO_PORT` validated; retry loop capped correctly
- Tolerant JSONL parsing — bad lines skipped instead of crashing `view` and `readEvents`
- Structured error serialization (`message`, `name`, `stack`) replaces `String(error)`
- `ensureGitignore()` resolves path from project root (`.git` walk); uses line-anchored match
- Schema versioning: `hashEvent()` accepts `schemaVersion` param; `verifyFile()` is version-aware; unknown versions fail with `UNSUPPORTED_SCHEMA_VERSION`

## 0.2.1-alpha.0

- Added `streamText` support for the Vercel AI SDK adapter.
- Added `agentlog studio`, a local browser UI for inspecting existing JSONL runs.
- Added completed-run tail anchors with `<runId>.head.json`.
- Added runId/filename binding in `verifyFile` to prevent run-file substitution.
- Added structured verifier errors via `VerifyResult.details`.
- Added `examples/vercel-stream-text`.

## 0.2.0

- Added `streamText` support.
- Added completed-run tail anchors.
- Added structured verifier errors.
- Added first-pass JSONL studio.

## 0.1.1

- Aligned event schema with the roadmap (`type`, `ts`, `payload`, versioned genesis).
- Fixed metadata-only capture behavior.
- Fixed tool result logging.
- Added error lifecycle handling for failed runs.
- Added package publish hygiene.

## 0.1.0

- Initial local-first JSONL audit logger.
- Added core run creation, hash chaining, and verification.
- Added Vercel AI SDK `generateText` adapter.
- Added CLI `verify` and `view`.
