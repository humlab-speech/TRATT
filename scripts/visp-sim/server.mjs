// Fake Visp host: serves audio + annot.json over HTTP and embeds tratt in an iframe
// (URL mode), logging every postMessage the app sends back.
//   node scripts/visp-sim/server.mjs            -> http://localhost:4000
//   env: PORT=4000 TRATT=http://localhost:5321
// Own files: drop <name>.wav / <name>_annot.json in scripts/visp-sim/fixtures/ (override built-ins).
// Fault injection on any media URL: ?delay=<ms> ?status=<code> ?norange=1
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, createReadStream, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 4000);
const TRATT = process.env.TRATT ?? 'http://localhost:5321';
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const RATE = 16000;

// 6 s mono 16-bit WAV: 440 Hz tone bursts, 1 s on / 0.5 s off
function makeWav() {
  const n = RATE * 6;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const on = (i / RATE) % 1.5 < 1;
    buf.writeInt16LE(on ? Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / RATE)) : 0, 44 + i * 2);
  }
  return buf;
}

function makeAnnot(audioName) {
  const words = ['first', 'second', 'third', 'fourth'];
  return JSON.stringify({
    name: audioName.replace(/\.[^.]+$/, ''),
    annotates: audioName,
    sampleRate: RATE,
    levels: [{
      name: 'Orthographic', type: 'SEGMENT',
      items: words.map((w, i) => ({
        id: i + 1, sampleStart: i * 24000, sampleDur: 16000,
        labels: [{ name: 'Orthographic', value: w }],
      })),
    }],
    links: [],
  }, null, 2);
}

const MIME = { '.wav': 'audio/wav', '.json': 'application/json', '.txt': 'text/plain' };
const ext = (p) => (p.match(/\.[^.]+$/) ?? [''])[0];

// name -> { size, read(range?) }
function resolve(name) {
  const f = join(FIXTURES, basename(name));
  if (existsSync(f)) return { size: statSync(f).size, stream: (o) => createReadStream(f, o), type: MIME[ext(f)] };
  let data;
  if (name === 'sample.wav') data = makeWav();
  else if (name === 'sample_annot.json') data = Buffer.from(makeAnnot('sample.wav'));
  else return null;
  return { size: data.length, stream: (o) => ({ pipe: (res) => res.end(data.subarray(o?.start ?? 0, (o?.end ?? data.length - 1) + 1)) }), type: MIME[ext(name)] };
}

function listMedia() {
  const names = new Set(['sample.wav', 'sample_annot.json']);
  if (existsSync(FIXTURES)) readdirSync(FIXTURES).forEach((f) => names.add(f));
  return [...names];
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const log = (code) => console.log(`${req.method} ${url.pathname}${url.search} ${req.headers.range ?? ''} -> ${code}`);

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(hostPage()), log(200);
  }
  if (!url.pathname.startsWith('/media/')) return res.writeHead(404).end(), log(404);
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end(), log(204);

  const delay = Number(url.searchParams.get('delay') ?? 0);
  if (delay) await new Promise((r) => setTimeout(r, delay));
  const forced = Number(url.searchParams.get('status') ?? 0);
  if (forced) return res.writeHead(forced, CORS).end(`forced ${forced}`), log(forced);

  const file = resolve(decodeURIComponent(url.pathname.slice(7)));
  if (!file) return res.writeHead(404, CORS).end('not found'), log(404);

  const headers = { ...CORS, 'Content-Type': file.type ?? 'application/octet-stream' };
  const m = !url.searchParams.get('norange') && /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (!url.searchParams.get('norange')) headers['Accept-Ranges'] = 'bytes';
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), file.size - 1) : file.size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${file.size}`, 'Content-Length': end - start + 1 });
    file.stream({ start, end }).pipe(res);
    return log(206);
  }
  res.writeHead(200, { ...headers, 'Content-Length': file.size });
  file.stream().pipe(res);
  log(200);
}).listen(PORT, () => console.log(`visp-sim: http://localhost:${PORT}  (tratt at ${TRATT})`));

function hostPage() {
  const media = listMedia();
  const opt = (arr, blank) => (blank ? '<option value="">(none)</option>' : '') + arr.map((n) => `<option>${n}</option>`).join('');
  return `<!doctype html><meta charset=utf-8><title>Visp simulator</title>
<style>
body{font:14px system-ui;margin:0;display:grid;grid-template-columns:320px 1fr;grid-template-rows:1fr 220px;height:100vh}
form{grid-row:1/3;padding:12px;overflow:auto;background:#f3f3f3;display:flex;flex-direction:column;gap:6px}
label{display:flex;flex-direction:column;font-size:12px} label.c{flex-direction:row;gap:6px;align-items:center}
iframe{width:100%;height:100%;border:0} #log{overflow:auto;margin:0;padding:8px;background:#111;color:#9f9;font:12px monospace}
</style>
<form id=f>
<label>Tratt base URL<input name=tratt value="${TRATT}"></label>
<label>Audio<select name=audio>${opt(media.filter((n) => !n.endsWith('.json')))}</select></label>
<label>Transcript (annot.json)<select name=transcript>${opt(media.filter((n) => n.endsWith('.json')), true)}</select></label>
<label>aType (export format, blank=AnnotJSON)<input name=aType></label>
<label class=c><input type=checkbox name=embedded checked>embedded=1</label>
<label class=c><input type=checkbox name=readonly>readonly=1</label>
<label class=c><input type=checkbox name=bottomNav>bottomNav=1</label>
<label class=c><input type=checkbox name=auto_playback>auto_playback=1</label>
<b>Fault injection (media URLs)</b>
<label>delay ms<input name=delay type=number></label>
<label>status (forced HTTP error)<input name=status type=number></label>
<label class=c><input type=checkbox name=norange>no Range support</label>
<button>Load in iframe</button>
<button type=button id=clr>Clear log</button>
<code id=u style="word-break:break-all;font-size:11px"></code>
</form>
<iframe id=fr allow="autoplay; clipboard-write; microphone"></iframe>
<pre id=log></pre>
<script>
const f=document.getElementById('f'),log=document.getElementById('log');
const say=(...a)=>{log.textContent+=new Date().toISOString().slice(11,23)+' '+a.join(' ')+'\\n';log.scrollTop=1e9};
f.onsubmit=(e)=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));
 const fault=new URLSearchParams();for(const k of ['delay','status','norange'])if(d[k])fault.set(k,d[k]==='on'?'1':d[k]);
 const q=fault.toString()?'?'+fault:'';
 const media=(n)=>encodeURIComponent(location.origin+'/media/'+n+q);
 const p=[];p.push('audio_url='+media(d.audio));
 if(d.transcript)p.push('transcript='+media(d.transcript));
 if(d.aType)p.push('aType='+encodeURIComponent(d.aType));
 for(const k of ['embedded','readonly','bottomNav','auto_playback'])if(d[k])p.push(k+'=1');
 const u=d.tratt.replace(/\\/$/,'')+'/?'+p.join('&');
 document.getElementById('u').textContent=u;say('LOAD',u);document.getElementById('fr').src=u};
document.getElementById('clr').onclick=()=>log.textContent='';
addEventListener('message',(e)=>{const m=e.data,a=m?.data?.annotation;
 say('MSG from',e.origin,'status='+m?.status,a?'annotation='+a.name+' ('+a.content.length+' bytes)':JSON.stringify(m));
 if(a)say(a.content)});
</script>`;
}
