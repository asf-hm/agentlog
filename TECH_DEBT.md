# agentlog — Technical Debt

All items deferred from current release. Organized by target version and category.

---

## v0.2.x

### Core — Verify

- **`errors: VerifyError[]` with `stopOnFirst` option** in `VerifyResult`
  Why: Single `error: string` collapses on first failure. Forensic use needs all violations.

- **`eventsChecked` preserved on stream failure**
  Why: Outer catch returns `eventsChecked: 0` even if the stream fails mid-file after events were validated. Loses partial progress info.

- **`verifyFileDetailed`** — extended `VerifyResult` for compliance use
  Why: Annex IV evidentiary use requires `firstTimestamp`, `lastTimestamp`, `terminalHash`, `verifierVersion`.
  ```ts
  type VerifyResultDetailed = VerifyResult & {
    firstTimestamp?: number
    lastTimestamp?: number
    terminalHash?: string
    verifierVersion: string
  }
  ```

- **Schema validation on parse** — validate event shape with zod/valibot in `verifyFile`
  Why: A malicious file with `ts: undefined` or `seq: "0"` passes chain checks but produces incorrect state silently.

---

### Core — Public API Surface

- **`./internal` subpath export** for `hashEvent` and `GENESIS`
  Why: Both are implementation details leaking as public API. Hiding them reduces the pinned contract surface. Evaluate when first external consumer appears.

- **`verifyEvents(events: AuditEvent[])`** — in-memory verify alongside `verifyFile`
  Why: Vercel AI SDK adapter may want to verify in-memory before flushing to disk.

- **Subpath split for `verify.ts`** — move to `./verify` subpath export
  Why: `verify.ts` depends on Node `fs` and is not portable to browser/edge. Split when a non-Node consumer appears.

- **`HASHING.md` spec doc** — canonical JSON form, field set, algorithm, version
  Why: Needed for GDPR DPIA and EU AI Act Article 12 compliance defensibility.

---

### Core — Crypto & Hashing

- **Web Crypto API** (`crypto.subtle`) instead of `node:crypto`
  Why: `node:crypto` blocks Vercel Edge and Cloudflare Workers compatibility.

- **`toHashable()` projection** — explicit `HashableEvent` type instead of `Omit<AuditEvent, 'hash'>`
  Why: `agentName` and `durationMs` are silently excluded from the hash. A typed projection makes the authenticated vs display-only field boundary explicit.

- **`hashAlg` field on every event**
  Why: When SHA-3 or BLAKE3 lands, files written under SHA-256 have no in-band signal. A `hashAlg` field bound into the canonical hash enables algorithm agility without breaking old files.

- **`hashVersion` field for schema evolution**
  Why: Future schema changes need a versioned hash scheme so old files don't silently fail or pass incorrectly.

---

### Core — Schema & Event Types

- **`BaseEvent<T, P>` discriminated union** — replace `payload: Record<string, unknown>` with typed payloads per event type
  Why: `payload: unknown` loses all type safety at the package boundary. Deferred because generics complexity wasn't worth it before real consumers existed.

- **`captureStack: true` opt-in** for `ErrorPayload`
  Why: Stack traces expose server directory structure. Currently excluded entirely.

---

### Core — Storage

- **`EventSource` abstraction** — decouple verifier from JSONL transport
  Why: v0.3 SQLite adapter needs the same verification logic without duplicating it.
  ```ts
  interface EventSource {
    events(): AsyncIterable<string>
  }
  ```

- **SQLite storage adapter**
  Why: JSONL is hard to query. SQLite enables run list, filtering, and DSAR exports.

---

### Vercel AI Adapter

- **Middleware pattern** instead of wrapper
  Why: One-line setup at model instantiation is better DX than finding every `generateText`/`streamText` call.

---

### CLI

- **Browser UI** (`agentlog studio`)
  Why: Terminal-only view is functional but not the "wow" moment for adoption. A local `localhost:3001` timeline is.

- **`--max-age` pruning command**
  Why: JSONL files that live forever are a GDPR liability under Art. 5(1)(e) (storage limitation). Deleting whole run files is GDPR-clean; line-level deletion is not.

- **`RETENTION.md` template**
  Why: Operators need a starting point for documenting their retention policy for GDPR Art. 30 records of processing.

---

## v0.3 — Compliance track

- **Redaction audit trail** on the redacted event payload
  Why: GDPR Art. 17 erasure requires knowing who redacted, when, and under what legal basis. Current `redacted` event only closes the hash chain hole — it carries no actor, legal basis, or timestamp.

- **`verifyAndFilter(filePath, predicate)`** — DSAR export hook
  Why: GDPR Art. 15/20 right of access and portability. Returns matching events with verification proof for the full chain.

- **DPA-facing verification report**
  Why: `VerifyResult.details.code` is structured, but regulator-facing reports still need timestamps, terminal hash, file hash, and package/verifier version.

- **`AbortSignal` on `verifyFile`**
  Why: Large historical archives will pin the process with no cancellation path.

- **Path validation** — reject symlinks, non-regular files, paths outside `.agentlog/runs/`
  Why: Needed if `verifyFile` is ever exposed via CLI flags accepting untrusted paths or wrapped in a server.

---

## Open decisions

1. **`eventsChecked` on stream failure** — return actual count or `0` as "stream-level failure" signal?
2. **`agentName`/`durationMs` outside hash** — intentional per ROADMAP spec, but undocumented. Either add to hash or document explicitly as display-only metadata.
3. **Tail anchor on crashed runs** — `.head.json` only written on `run.end()`. Crashed/dangling runs have no anchor. Address in v0.2.x with a periodic flush or a run manifest approach.

---

## Completed

- **Tail anchor for completed runs**
  Done: `run.end()` writes `<runId>.head.json`, and `verifyFile` checks it when present.

- **`runId` filename binding**
  Done: `verifyFile` asserts each event's `runId` matches `<runId>.jsonl`, closing chain substitution attacks.

- **Structured `VerifyResult.details`**
  Done: `verifyFile` preserves `error` for compatibility and adds `details.code`, `details.message`, `seq`, `lineNo`, and `lastValidSeq` for machine consumers.
