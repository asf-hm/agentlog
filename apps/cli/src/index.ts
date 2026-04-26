import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { createInterface } from 'node:readline';
import { basename, join, resolve } from 'node:path';
import { verifyFile } from '@asafhm/agentlog-core';
import type { AuditEvent, VerifyResult } from '@asafhm/agentlog-core';

const [, , command, filePath] = process.argv;

function usage(): void {
  console.error('Usage: agentlog <verify|view|studio> [path-to-run.jsonl]');
}

function getRunsDir(): string {
  return resolve(process.env.AGENTLOG_DIR ?? '.agentlog', 'runs');
}

async function readEvents(path: string): Promise<AuditEvent[]> {
  const text = await readFile(path, 'utf8');
  return text
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as AuditEvent);
}

function formatTs(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

async function listRunFiles(): Promise<string[]> {
  const runsDir = getRunsDir();
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => join(runsDir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

type RunSummary = {
  runId: string;
  fileName: string;
  valid: boolean;
  eventsChecked: number;
  error?: string;
  errorCode?: string;
  agentName?: string;
  status?: string;
  startedAt?: number;
  endedAt?: number;
  eventCount: number;
};

async function summarizeRun(path: string): Promise<RunSummary> {
  const verify = await verifyFile(path);
  let events: AuditEvent[] = [];
  try {
    events = await readEvents(path);
  } catch {
    // keep summary usable even for malformed files; verify carries the failure reason
  }
  const first = events[0];
  const last = events[events.length - 1];
  const runEnd = [...events].reverse().find(event => event.type === 'run_end');
  return {
    runId: first?.runId ?? basename(path, '.jsonl'),
    fileName: basename(path),
    valid: verify.valid,
    eventsChecked: verify.eventsChecked,
    error: verify.error,
    errorCode: verify.details?.code,
    agentName: first?.agentName,
    status: typeof runEnd?.payload.status === 'string' ? runEnd.payload.status : undefined,
    startedAt: first?.ts,
    endedAt: last?.ts,
    eventCount: events.length,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(html);
}

function findRunPath(runId: string): string {
  return join(getRunsDir(), `${runId}.jsonl`);
}

async function handleApiRuns(res: ServerResponse): Promise<void> {
  const files = await listRunFiles();
  const runs = await Promise.all(files.map(summarizeRun));
  runs.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  sendJson(res, 200, { runsDir: getRunsDir(), runs });
}

async function handleApiRun(res: ServerResponse, runId: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
    sendJson(res, 400, { error: 'Invalid run id' });
    return;
  }
  const path = findRunPath(runId);
  const verify = await verifyFile(path);
  let events: AuditEvent[] = [];
  try {
    events = await readEvents(path);
  } catch {
    // malformed files are still represented through verify details
  }
  sendJson(res, 200, {
    run: await summarizeRun(path),
    verify,
    events,
  });
}

function studioHtml(): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>agentlog studio</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --text: #17181c;
      --muted: #646b7a;
      --line: #dfe3eb;
      --good: #13795b;
      --bad: #b42318;
      --accent: #2457c5;
      --soft: #eef2f8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0;
    }
    button {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      height: 34px;
      padding: 0 12px;
      border-radius: 6px;
      cursor: pointer;
      font: inherit;
    }
    button:hover { border-color: var(--accent); }
    main {
      display: grid;
      grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
      min-height: calc(100vh - 56px);
    }
    aside {
      border-right: 1px solid var(--line);
      background: var(--panel);
      min-width: 0;
    }
    .runs-meta {
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .run-list {
      display: grid;
      gap: 0;
    }
    .run-row {
      width: 100%;
      height: auto;
      min-height: 72px;
      border: 0;
      border-bottom: 1px solid var(--line);
      border-radius: 0;
      text-align: left;
      padding: 12px 16px;
      display: grid;
      gap: 6px;
      background: var(--panel);
    }
    .run-row.active { background: var(--soft); }
    .run-title {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .run-id {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      height: 22px;
      padding: 0 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
    }
    .badge.good { color: var(--good); background: #e7f5ef; }
    .badge.bad { color: var(--bad); background: #fdecec; }
    .run-sub {
      color: var(--muted);
      font-size: 12px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    section {
      min-width: 0;
      padding: 22px;
    }
    .empty {
      color: var(--muted);
      padding: 28px;
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .detail-head {
      display: grid;
      gap: 8px;
      margin-bottom: 18px;
    }
    .detail-title {
      display: flex;
      gap: 10px;
      align-items: center;
      min-width: 0;
    }
    h2 {
      margin: 0;
      font-size: 20px;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }
    .detail-meta {
      color: var(--muted);
      font-size: 13px;
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .event-list {
      display: grid;
      gap: 10px;
    }
    .event {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    .event-head {
      min-height: 42px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      background: #fbfcfe;
    }
    .event-type {
      font-weight: 700;
      font-size: 14px;
    }
    .event-ts {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    pre {
      margin: 0;
      padding: 12px;
      overflow: auto;
      font-size: 12px;
      line-height: 1.5;
      background: var(--panel);
    }
    @media (max-width: 780px) {
      main { grid-template-columns: 1fr; }
      aside { border-right: 0; border-bottom: 1px solid var(--line); }
      section { padding: 16px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>agentlog studio</h1>
    <button id="refresh" type="button">Refresh</button>
  </header>
  <main>
    <aside>
      <div class="runs-meta" id="runs-meta">Loading runs...</div>
      <div class="run-list" id="run-list"></div>
    </aside>
    <section id="detail">
      <div class="empty">Select a run to inspect its timeline.</div>
    </section>
  </main>
  <script>
    const listEl = document.querySelector('#run-list');
    const metaEl = document.querySelector('#runs-meta');
    const detailEl = document.querySelector('#detail');
    const refreshEl = document.querySelector('#refresh');
    let selectedRunId = '';

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[ch]));
    }

    function fmt(ts) {
      if (!ts) return 'unknown time';
      return new Date(ts).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
    }

    function badge(valid) {
      return '<span class="badge ' + (valid ? 'good' : 'bad') + '">' + (valid ? 'valid' : 'invalid') + '</span>';
    }

    async function loadRuns() {
      const res = await fetch('/api/runs');
      const data = await res.json();
      metaEl.textContent = data.runs.length + ' run' + (data.runs.length === 1 ? '' : 's') + ' in ' + data.runsDir;
      if (!data.runs.length) {
        listEl.innerHTML = '<div class="runs-meta">No JSONL runs found.</div>';
        detailEl.innerHTML = '<div class="empty">Create a run, then refresh studio.</div>';
        return;
      }
      listEl.innerHTML = data.runs.map(run => {
        const active = run.runId === selectedRunId ? ' active' : '';
        const status = run.status ? 'status: ' + esc(run.status) : (run.errorCode ? esc(run.errorCode) : 'no run_end');
        return '<button class="run-row' + active + '" type="button" data-run-id="' + esc(run.runId) + '">' +
          '<div class="run-title">' + badge(run.valid) + '<span class="run-id">' + esc(run.runId) + '</span></div>' +
          '<div class="run-sub"><span>' + esc(run.eventCount) + ' events</span><span>' + status + '</span><span>' + esc(fmt(run.startedAt)) + '</span></div>' +
        '</button>';
      }).join('');
      listEl.querySelectorAll('[data-run-id]').forEach(button => {
        button.addEventListener('click', () => loadRun(button.dataset.runId));
      });
      if (!selectedRunId) loadRun(data.runs[0].runId);
    }

    async function loadRun(runId) {
      selectedRunId = runId;
      const res = await fetch('/api/runs/' + encodeURIComponent(runId));
      const data = await res.json();
      const run = data.run;
      const verify = data.verify;
      const events = data.events ?? [];
      detailEl.innerHTML =
        '<div class="detail-head">' +
          '<div class="detail-title"><h2>' + esc(run.runId) + '</h2>' + badge(run.valid) + '</div>' +
          '<div class="detail-meta">' +
            '<span>' + esc(events.length) + ' events</span>' +
            '<span>' + esc(fmt(run.startedAt)) + '</span>' +
            (run.errorCode ? '<span>' + esc(run.errorCode) + '</span>' : '') +
            (verify.error ? '<span>' + esc(verify.error) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="event-list">' + events.map(event => (
          '<article class="event">' +
            '<div class="event-head">' +
              '<span class="event-type">#' + esc(event.seq) + ' ' + esc(event.type) + '</span>' +
              '<span class="event-ts">' + esc(fmt(event.ts)) + '</span>' +
            '</div>' +
            '<pre>' + esc(JSON.stringify(event.payload, null, 2)) + '</pre>' +
          '</article>'
        )).join('') + '</div>';
      document.querySelectorAll('.run-row').forEach(row => {
        row.classList.toggle('active', row.dataset.runId === selectedRunId);
      });
    }

    refreshEl.addEventListener('click', loadRuns);
    loadRuns().catch(error => {
      metaEl.textContent = 'Failed to load runs';
      detailEl.innerHTML = '<div class="empty">' + esc(error.message || error) + '</div>';
    });
  </script>
</body>
</html>`;
}

async function startStudio(): Promise<void> {
  let port = Number(process.env.AGENTLOG_STUDIO_PORT ?? 3001);

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/') {
        sendHtml(res, studioHtml());
        return;
      }
      if (url.pathname === '/api/runs') {
        await handleApiRuns(res);
        return;
      }
      const match = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (match) {
        await handleApiRun(res, decodeURIComponent(match[1]));
        return;
      }
      sendJson(res, 404, { error: 'Not found' });
    })().catch(error => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const tryListen = () => {
      server.once('error', error => {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EADDRINUSE' && port < 3010) {
          port++;
          tryListen();
          return;
        }
        rejectListen(error);
      });
      server.listen(port, '127.0.0.1', resolveListen);
    };
    tryListen();
  });

  console.log(`agentlog studio listening at http://127.0.0.1:${port}`);
  console.log(`Reading runs from ${getRunsDir()}`);
}

if (!command) {
  usage();
  process.exit(1);
}

if (command === 'studio') {
  await startStudio();
} else {
  if (!filePath) {
    usage();
    process.exit(1);
  }

  const absPath = resolve(filePath);

  if (command === 'verify') {
    const result = await verifyFile(absPath);
    if (result.valid) {
      console.log(`✓ Valid — ${result.eventsChecked} events verified`);
    } else {
      console.error(`✗ Invalid — ${result.error}`);
      process.exit(1);
    }

  } else if (command === 'view') {
    const rl = createInterface({ input: createReadStream(absPath), crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      const event: AuditEvent = JSON.parse(line);
      const dur = event.durationMs != null ? ` (${event.durationMs}ms)` : '';
      console.log(`[${event.seq}] ${formatTs(event.ts)}  ${event.type}${dur}`);
      if (Object.keys(event.payload).length) {
        for (const [k, v] of Object.entries(event.payload)) {
          console.log(`      ${k}: ${JSON.stringify(v)}`);
        }
      }
    }

  } else {
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
  }
}
