// Fake Visp: hosts tratt in an iframe the way Visp does (?workspace=visp), with an
// in-memory EMU annotation websocket server and audio server fed from tratt export zips.
//   node scripts/visp-sim/server.mjs [a.zip b.zip ...]   -> http://localhost:4000
//   env: PORT=4000 TRATT=http://localhost:5321 LEVEL=Standardnivå ZIPS=a.zip:b.zip
// Needs tratt's dev server to proxy /annotation-ws and /file to this server
// (apps/tratt/proxy.visp-sim.json, wired into `serve:development`) and
// "visp": {"serverUrl": "/annotation-ws", "transcriptionLevel": "Standardnivå"} in appconfig.json.
// Saves are kept in memory (lost on restart) and logged in the page.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 4000);
const TRATT = process.env.TRATT ?? 'http://localhost:5321';
const LEVEL = process.env.LEVEL ?? 'Standardnivå';
const PROJECT = 'sim';
const DL = join(homedir(), 'Downloads');
const zips = process.argv.length > 2 ? process.argv.slice(2)
  : process.env.ZIPS ? process.env.ZIPS.split(':')
  : [join(DL, 'tratt_1_20261117@1208.zip'), join(DL, 'tratt_5_20261117@1215.zip')];

// `session/name` -> { session, name, annotation, audio, type, finishedEditing, comment }
const bundles = new Map();
zips.forEach((zip, i) => {
  const session = `zip${i + 1}`;
  const files = unzipSync(new Uint8Array(readFileSync(zip)));
  for (const [path, data] of Object.entries(files)) {
    const m = /^bundles\/([^/]+)\/(.+)_annot\.json$/.exec(path);
    if (!m) continue;
    const [, name] = m;
    const audioPath = Object.keys(files).find((p) => p.startsWith(`bundles/${name}/`) && /\.(opus|wav|ogg|mp3|m4a)$/.test(p));
    if (!audioPath) continue;
    const annotation = JSON.parse(strFromU8(data));
    annotation.name = name; // EMU keys saves by the annotation's name
    bundles.set(`${session}/${name}`, {
      session, name, annotation, audio: Buffer.from(files[audioPath]),
      type: audioPath.endsWith('.wav') ? 'audio/wav' : 'audio/ogg',
      finishedEditing: false, comment: '',
    });
  }
  console.log(`loaded ${zip}`);
});
console.log(`${bundles.size} bundles`);

const dbConfig = {
  levelDefinitions: [{ name: LEVEL, type: 'SEGMENT', attributeDefinitions: [{ name: LEVEL, type: 'STRING' }] }],
  linkDefinitions: [],
};

const version = (b) => createHash('sha1').update(JSON.stringify(b.annotation)).digest('hex');

const events = []; // lines for the host page's log
const note = (s) => { console.log(s); events.push(s); };

const http = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(hostPage());
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(events.splice(0)));
  }
  const m = /^\/file\/([^/]+)\/(.+)$/.exec(url.pathname);
  const b = m && bundles.get(`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`);
  if (!b) return res.writeHead(404).end();
  const r = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  const h = { 'Content-Type': b.type, 'Accept-Ranges': 'bytes' };
  if (r) {
    const start = r[1] ? Number(r[1]) : 0;
    const end = r[2] ? Math.min(Number(r[2]), b.audio.length - 1) : b.audio.length - 1;
    res.writeHead(206, { ...h, 'Content-Range': `bytes ${start}-${end}/${b.audio.length}`, 'Content-Length': end - start + 1 });
    return res.end(b.audio.subarray(start, end + 1));
  }
  res.writeHead(200, { ...h, 'Content-Length': b.audio.length });
  res.end(b.audio);
}).listen(PORT, () => console.log(`visp-sim: http://localhost:${PORT}  (tratt at ${TRATT}, level ${LEVEL})`));

new WebSocketServer({ server: http, path: '/annotation-ws' }).on('connection', (ws) => {
  note('ws connected');
  ws.on('message', (raw) => {
    const req = JSON.parse(String(raw));
    const ok = (data) => ws.send(JSON.stringify({ callbackID: req.callbackID, data, status: { type: 'SUCCESS', message: '' } }));
    const fail = (message) => ws.send(JSON.stringify({ callbackID: req.callbackID, status: { type: 'ERROR', message } }));
    const key = `${req.session ?? req.data?.session}/${req.name ?? req.data?.annotation?.name}`;
    switch (req.type) {
      case 'GETGLOBALDBCONFIG': return ok(dbConfig);
      case 'WHOAMI': return ok({ username: 'sim' });
      case 'GETBUNDLELIST':
        return ok([...bundles.values()].map(({ session, name, finishedEditing, comment }) => ({ session, name, finishedEditing, comment })));
      case 'GETBUNDLE': {
        const b = bundles.get(key);
        if (!b) return fail('Error reading annotation file.');
        return ok({
          annotation: b.annotation,
          mediaFile: { encoding: 'GETURL', data: `${TRATT}/file/${encodeURIComponent(b.session)}/${encodeURIComponent(b.name)}` },
          ssffFiles: [],
          ...(req.withVersion === true ? { annotationVersion: version(b) } : {}),
        });
      }
      case 'SAVEBUNDLE': {
        const b = bundles.get(key);
        if (!b) return fail('Bundle not found.');
        if (req.data.baseVersion !== undefined && req.data.baseVersion !== version(b)) return fail('STALE: the bundle was changed in Visp since it was opened.');
        b.annotation = req.data.annotation;
        b.finishedEditing = !!req.data.finishedEditing;
        b.comment = req.data.comment ?? '';
        const n = b.annotation.levels.find((l) => l.name === LEVEL)?.items.length;
        note(`SAVEBUNDLE ${key}: ${n} segments, finished=${b.finishedEditing}`);
        return ok({ annotationVersion: version(b) });
      }
      default: return fail('Unknown command');
    }
  });
});

function hostPage() {
  const src = `${TRATT}/?workspace=visp&projectId=${PROJECT}&level=${encodeURIComponent(LEVEL)}&embedded=1`;
  return `<!doctype html><meta charset=utf-8><title>Visp simulator</title>
<style>
body{margin:0;font:14px system-ui;display:flex;flex-direction:column;height:100vh}
header{background:#1d1d1f;color:#fff;display:flex;align-items:center;gap:16px;padding:0 16px;height:40px;flex:none}
header b{font-size:18px} header span{opacity:.7} header .sp{flex:1}
iframe{flex:1;border:0;width:100%} #log{height:90px;margin:0;overflow:auto;background:#111;color:#9f9;font:12px monospace;padding:4px 8px;flex:none}
</style>
<header><b>Visp</b><span>‹ Dashboard</span><span class=sp></span><span>Visp simulator · project ${PROJECT} · ${bundles.size} bundles</span></header>
<iframe allow="autoplay; clipboard-write; microphone" src="${src}"></iframe>
<pre id=log></pre>
<script>
document.cookie='projectId=${PROJECT}; path=/; SameSite=Lax';
const log=document.getElementById('log');
setInterval(async()=>{for(const l of await (await fetch('/events')).json())log.textContent+=new Date().toISOString().slice(11,23)+' '+l+'\\n';log.scrollTop=1e9},1000);
</script>`;
}
