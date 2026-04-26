import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename } from 'node:path';
import { hashEvent, GENESIS } from './crypto.js';
import type { AuditEvent } from './event.js';

export type VerifyErrorCode =
  | 'BAD_JSON'
  | 'SEQ_GAP'
  | 'RUN_ID_MISMATCH'
  | 'CHAIN_BROKEN'
  | 'TS_REGRESSION'
  | 'HASH_MISMATCH'
  | 'TAIL_ANCHOR_MISMATCH'
  | 'TAIL_ANCHOR_UNREADABLE'
  | 'EMPTY_FILE'
  | 'FILE_ERROR';

export type VerifyError = {
  code: VerifyErrorCode;
  message: string;
  seq?: number;
  lineNo?: number;
  lastValidSeq: number;
};

export type VerifyResult = {
  valid: boolean;
  eventsChecked: number;
  error?: string;
  details?: VerifyError;
};

export async function verifyFile(filePath: string): Promise<VerifyResult> {
  let rl: ReturnType<typeof createInterface> | undefined;
  let expectedSeq = 0;
  let eventsChecked = 0;

  function fail(
    code: VerifyErrorCode,
    message: string,
    ctx: Omit<Partial<VerifyError>, 'code' | 'message' | 'lastValidSeq'> = {}
  ): VerifyResult {
    return {
      valid: false,
      eventsChecked,
      error: message,
      details: {
        code,
        message,
        lastValidSeq: expectedSeq - 1,
        ...ctx,
      },
    };
  }

  try {
    const expectedRunId = basename(filePath, '.jsonl');

    rl = createInterface({
      input: createReadStream(filePath),
      crlfDelay: Infinity,
    });

    let prevHash = GENESIS;
    let prevTs: number | undefined;
    let lineNo = 0;

    for await (const line of rl) {
      lineNo++;
      if (!line.trim()) continue;

      let event: AuditEvent;
      try {
        event = JSON.parse(line);
      } catch {
        return fail('BAD_JSON', `Invalid JSON at line ${lineNo}`, { lineNo });
      }

      if (event.seq !== expectedSeq) {
        return fail('SEQ_GAP', `Sequence gap at seq ${event.seq}, expected ${expectedSeq}`, { seq: event.seq });
      }

      if (event.runId !== expectedRunId) {
        return fail('RUN_ID_MISMATCH', `Run ID mismatch at seq ${event.seq}`, { seq: event.seq });
      }

      if (event.prevHash !== prevHash) {
        return fail('CHAIN_BROKEN', `Hash chain broken at seq ${event.seq}`, { seq: event.seq });
      }

      if (prevTs !== undefined && event.ts < prevTs) {
        return fail('TS_REGRESSION', `Timestamp regression at seq ${event.seq}`, { seq: event.seq });
      }

      const { hash, ...rest } = event;
      const recomputed = hashEvent(rest);
      if (recomputed !== hash) {
        return fail('HASH_MISMATCH', `Hash mismatch at seq ${event.seq}`, { seq: event.seq });
      }

      prevHash = event.hash;
      prevTs = event.ts;
      expectedSeq++;
      eventsChecked++;
    }

    if (eventsChecked === 0) {
      return fail('EMPTY_FILE', 'File contains no events');
    }

    const headPath = filePath.replace(/\.jsonl$/, '.head.json');
    if (existsSync(headPath)) {
      try {
        const head = JSON.parse(readFileSync(headPath, 'utf8')) as {
          runId?: string;
          seq: number;
          hash: string;
        };
        const lastSeq = expectedSeq - 1;
        if (head.runId !== expectedRunId || head.seq !== lastSeq || head.hash !== prevHash) {
          return fail('TAIL_ANCHOR_MISMATCH', 'Tail anchor mismatch');
        }
      } catch {
        return fail('TAIL_ANCHOR_UNREADABLE', 'Tail anchor unreadable');
      }
    }

    return { valid: true, eventsChecked };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail('FILE_ERROR', `File error: ${message}`);
  } finally {
    rl?.close();
  }
}
