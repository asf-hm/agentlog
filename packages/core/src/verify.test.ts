import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { verifyFile } from './verify.js';
import { hashEvent, GENESIS } from './crypto.js';
import { createRun } from './run.js';
import type { AuditEvent, AuditEventType } from './event.js';

function makeEvent(
  runId: string,
  seq: number,
  prevHash: string,
  type: AuditEventType,
  payload: Record<string, unknown> = {}
): AuditEvent {
  const partial: Omit<AuditEvent, 'hash'> = {
    id: randomUUID(),
    runId,
    type,
    ts: 1_000_000_000_000 + seq * 100,
    payload,
    seq,
    prevHash,
  };
  return { ...partial, hash: hashEvent(partial) };
}

function buildChain(types: AuditEventType[]): AuditEvent[] {
  const runId = randomUUID();
  let prevHash = GENESIS;
  return types.map((type, seq) => {
    const event = makeEvent(runId, seq, prevHash, type);
    prevHash = event.hash;
    return event;
  });
}

function writeTmp(events: AuditEvent[]): string {
  const dir = join(tmpdir(), randomUUID());
  mkdirSync(dir);
  const path = join(dir, `${events[0]?.runId ?? randomUUID()}.jsonl`);
  writeFileSync(path, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  return path;
}

function writeTmpWithHead(events: AuditEvent[]): string {
  const path = writeTmp(events);
  const last = events[events.length - 1];
  writeFileSync(
    path.replace(/\.jsonl$/, '.head.json'),
    JSON.stringify({ runId: last.runId, seq: last.seq, hash: last.hash, endedAt: Date.now() })
  );
  return path;
}

const savedAgentlogDir = process.env.AGENTLOG_DIR;
afterEach(() => {
  if (savedAgentlogDir === undefined) delete process.env.AGENTLOG_DIR;
  else process.env.AGENTLOG_DIR = savedAgentlogDir;
});

describe('verifyFile', () => {
  it('valid chain passes', async () => {
    const path = writeTmp(buildChain(['run_start', 'prompt', 'response', 'run_end']));
    const result = await verifyFile(path);
    expect(result.valid).toBe(true);
    expect(result.eventsChecked).toBe(4);
  });

  it('edited payload fails', async () => {
    const path = writeTmp(buildChain(['run_start', 'prompt', 'response', 'run_end']));
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const tampered = JSON.parse(lines[1]) as AuditEvent;
    tampered.payload.injected = 'evil';
    lines[1] = JSON.stringify(tampered);
    writeFileSync(path, lines.join('\n') + '\n');

    const result = await verifyFile(path);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/hash mismatch/i);
    expect(result.details?.code).toBe('HASH_MISMATCH');
    expect(result.details?.lastValidSeq).toBe(0);
  });

  it('deleted event fails', async () => {
    const path = writeTmp(buildChain(['run_start', 'prompt', 'response', 'run_end']));
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    lines.splice(2, 1);
    writeFileSync(path, lines.join('\n') + '\n');

    const result = await verifyFile(path);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/sequence gap|hash chain broken/i);
    expect(result.details?.code).toBe('SEQ_GAP');
    expect(result.details?.lastValidSeq).toBe(1);
  });

  it('edited redacted event payload fails', async () => {
    const path = writeTmp(buildChain(['run_start', 'prompt', 'redacted', 'run_end']));
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const tampered = JSON.parse(lines[2]) as AuditEvent;
    tampered.payload.targetEventId = 'forged-id';
    lines[2] = JSON.stringify(tampered);
    writeFileSync(path, lines.join('\n') + '\n');

    const result = await verifyFile(path);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/hash mismatch/i);
    expect(result.details?.code).toBe('HASH_MISMATCH');
    expect(result.details?.lastValidSeq).toBe(1);
  });

  it('runId must match filename', async () => {
    const events = buildChain(['run_start', 'prompt', 'response', 'run_end']);
    const dir = join(tmpdir(), randomUUID());
    mkdirSync(dir);
    const path = join(dir, `${randomUUID()}.jsonl`);
    writeFileSync(path, events.map(e => JSON.stringify(e)).join('\n') + '\n');

    const result = await verifyFile(path);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/run id mismatch/i);
    expect(result.details?.code).toBe('RUN_ID_MISMATCH');
    expect(result.details?.lastValidSeq).toBe(-1);
  });

  it('invalid JSON reports BAD_JSON', async () => {
    const events = buildChain(['run_start', 'prompt']);
    const path = writeTmp(events);
    writeFileSync(path, `${JSON.stringify(events[0])}\nnot-json\n`);

    const result = await verifyFile(path);
    expect(result.valid).toBe(false);
    expect(result.details?.code).toBe('BAD_JSON');
    expect(result.details?.lineNo).toBe(2);
    expect(result.details?.lastValidSeq).toBe(0);
  });

  it('timestamp regression reports TS_REGRESSION', async () => {
    const path = writeTmp(buildChain(['run_start', 'prompt', 'response']));
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const regressed = JSON.parse(lines[1]) as AuditEvent;
    regressed.ts = 1;
    lines[1] = JSON.stringify(regressed);
    writeFileSync(path, lines.join('\n') + '\n');

    const result = await verifyFile(path);
    expect(result.valid).toBe(false);
    expect(result.details?.code).toBe('TS_REGRESSION');
    expect(result.details?.seq).toBe(1);
    expect(result.details?.lastValidSeq).toBe(0);
  });

  it('changed prevHash reports CHAIN_BROKEN', async () => {
    const path = writeTmp(buildChain(['run_start', 'prompt', 'response']));
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const broken = JSON.parse(lines[1]) as AuditEvent;
    broken.prevHash = 'not-the-previous-hash';
    lines[1] = JSON.stringify(broken);
    writeFileSync(path, lines.join('\n') + '\n');

    const result = await verifyFile(path);
    expect(result.valid).toBe(false);
    expect(result.details?.code).toBe('CHAIN_BROKEN');
    expect(result.details?.seq).toBe(1);
    expect(result.details?.lastValidSeq).toBe(0);
  });

  it('empty file reports EMPTY_FILE', async () => {
    const dir = join(tmpdir(), randomUUID());
    mkdirSync(dir);
    const path = join(dir, `${randomUUID()}.jsonl`);
    writeFileSync(path, '');

    const result = await verifyFile(path);
    expect(result.valid).toBe(false);
    expect(result.eventsChecked).toBe(0);
    expect(result.details?.code).toBe('EMPTY_FILE');
    expect(result.details?.lastValidSeq).toBe(-1);
  });

  it('missing file reports FILE_ERROR', async () => {
    const path = join(tmpdir(), randomUUID(), `${randomUUID()}.jsonl`);

    const result = await verifyFile(path);
    expect(result.valid).toBe(false);
    expect(result.eventsChecked).toBe(0);
    expect(result.details?.code).toBe('FILE_ERROR');
    expect(result.details?.lastValidSeq).toBe(-1);
  });

  it('valid chain with matching head file passes', async () => {
    const path = writeTmpWithHead(buildChain(['run_start', 'prompt', 'response', 'run_end']));
    const result = await verifyFile(path);
    expect(result.valid).toBe(true);
  });

  it('tail-truncated file with head file fails', async () => {
    const events = buildChain(['run_start', 'prompt', 'response', 'run_end']);
    const path = writeTmpWithHead(events);
    // remove last event (run_end) — sidecar still points to it
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    lines.pop();
    writeFileSync(path, lines.join('\n') + '\n');

    const result = await verifyFile(path);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Tail anchor mismatch');
    expect(result.details?.code).toBe('TAIL_ANCHOR_MISMATCH');
    expect(result.details?.lastValidSeq).toBe(2);
  });

  it('unreadable head file reports TAIL_ANCHOR_UNREADABLE', async () => {
    const events = buildChain(['run_start', 'prompt', 'response', 'run_end']);
    const path = writeTmp(events);
    writeFileSync(path.replace(/\.jsonl$/, '.head.json'), 'not-json');

    const result = await verifyFile(path);
    expect(result.valid).toBe(false);
    expect(result.details?.code).toBe('TAIL_ANCHOR_UNREADABLE');
    expect(result.details?.lastValidSeq).toBe(3);
  });

  it('run.end() writes head file with correct seq and hash', async () => {
    const dir = join(tmpdir(), randomUUID());
    mkdirSync(dir, { recursive: true });
    process.env.AGENTLOG_DIR = dir;

    const run = createRun({ agentName: 'test' });
    run.append('prompt', { model: 'test' });
    const endEvt = run.end('success');

    const headPath = join(dir, 'runs', `${run.runId}.head.json`);
    expect(existsSync(headPath)).toBe(true);

    const head = JSON.parse(readFileSync(headPath, 'utf8'));
    expect(head.runId).toBe(run.runId);
    expect(head.seq).toBe(endEvt.seq);
    expect(head.hash).toBe(endEvt.hash);
  });
});
