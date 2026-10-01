// RUBICON PROTOCOL — 區網伺服器（網頁服務 + 房間登記 + WebSocket 中繼 + 控制台）
'use strict';
const http = require('http'),
  fs = require('fs'),
  path = require('path'),
  os = require('os'),
  crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const qrcode = require('qrcode-generator');

const BASE = process.pkg ? path.dirname(process.execPath) : __dirname;
const CFG_PATH = path.join(BASE, 'rubicon-server.json');
// 遊戲頁：打包成 exe 時讀同資料夾的 rubicon-protocol.html；開發時讀 npm run build 的產物
const WEB_DIR = process.pkg ? BASE : path.join(__dirname, 'dist');
const CONTROL_PORT = 8090;
const VERSION = '1.0';
let cfg = { port: 80, autoStart: true };
try {
  cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')));
} catch (e) {}
function saveCfg() {
  try {
    fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {}
}

const logs = [];
function log(s) {
  const line = new Date().toLocaleTimeString('zh-TW', { hour12: false }) + '  ' + s;
  logs.push(line);
  if (logs.length > 300) logs.shift();
  console.log(line);
}
function localIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const k in ifs)
    for (const a of ifs[k]) if (a.family === 'IPv4' && !a.internal) out.push({ name: k, ip: a.address });
  return out;
}
// 模型庫（選用）：與遊戲頁放在同一個資料夾
function libraryHtml() {
  const p = path.join(WEB_DIR, 'model-library.html');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}
function gameHtml() {
  const p = path.join(WEB_DIR, 'rubicon-protocol.html');
  if (!fs.existsSync(p)) return null;
  let h = fs.readFileSync(p, 'utf8');
  h = h.replace('<head>', '<head><script>window.RUBICON_SERVER=' + JSON.stringify(VERSION) + ';</script>');
  return h;
}

// ===================== 遊戲伺服器（可啟停） =====================
let game = null; // {server, wss, peers:Map, rooms:Map, startedAt, port}
function newId() {
  return crypto.randomBytes(6).toString('hex');
}
function startGame(port) {
  return new Promise((res, rej) => {
    if (game) return rej(new Error('已在執行'));
    if (!gameHtml())
      return rej(
        new Error(
          process.pkg
            ? '找不到 rubicon-protocol.html（請放在與執行檔相同的資料夾）'
            : '找不到 dist/rubicon-protocol.html（請先執行 npm run build）',
        ),
      );
    const peers = new Map(),
      rooms = new Map();
    const server = http.createServer((req, resp) => {
      const u = req.url.split('?')[0];
      if (u === '/' || u === '/index.html' || u === '/rubicon-protocol.html') {
        const h = gameHtml();
        resp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        resp.end(h);
      } else if (u === '/models' || u === '/models/' || u === '/model-library.html') {
        const h = libraryHtml();
        resp.writeHead(h ? 200 : 404, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        resp.end(h || '找不到 model-library.html（請放在與遊戲頁相同的資料夾）');
      } else if (u === '/health') {
        resp.writeHead(200, { 'Content-Type': 'application/json' });
        resp.end(JSON.stringify({ ok: true, version: VERSION, peers: peers.size, rooms: rooms.size }));
      } else {
        resp.writeHead(404);
        resp.end('not found');
      }
    });
    const wss = new WebSocketServer({ server, path: '/ws' });
    const send = (p, o) => {
      if (p && p.ws.readyState === WebSocket.OPEN) {
        try {
          p.ws.send(JSON.stringify(o));
        } catch (e) {}
      }
    };
    wss.on('connection', (ws, req) => {
      const id = newId();
      const p = {
        id,
        ws,
        links: new Set(),
        nick: '',
        spectator: false,
        ip: (req.socket.remoteAddress || '').replace('::ffff:', ''),
        t: Date.now(),
      };
      peers.set(id, p);
      send(p, { t: 'hello', id, version: VERSION });
      log(`連線 ${p.ip} → ${id}`);
      ws.on('message', (buf) => {
        let m;
        try {
          m = JSON.parse(buf.toString());
        } catch (e) {
          return;
        }
        const to = m.to ? peers.get(m.to) : null;
        switch (m.t) {
          case 'reg':
            rooms.set(id, Object.assign({ hostId: id, ip: p.ip, createdAt: Date.now() }, m.room || {}));
            log(`建房「${(m.room && m.room.room) || ''}」by ${(m.room && m.room.host) || id}`);
            break;
          case 'roominfo':
            if (rooms.has(id)) Object.assign(rooms.get(id), m.room || {});
            break;
          case 'unreg':
            if (rooms.delete(id)) log(`關房 ${id}`);
            break;
          case 'list':
            send(p, {
              t: 'rooms',
              list: [...rooms.values()].map((r) => ({
                peerId: r.hostId,
                room: r.room,
                host: r.host,
                n: r.n || 1,
                level: r.level || 1,
                full: !!r.full,
                state: r.state || 'lobby',
                spectators: r.spectators || 0,
              })),
            });
            break;
          case 'conn':
            if (!to) {
              send(p, { t: 'noroute', to: m.to });
              break;
            }
            p.nick = (m.meta && m.meta.nick) || p.nick;
            p.spectator = !!(m.meta && m.meta.spectator);
            send(to, { t: 'conn', from: id, meta: m.meta || {} });
            break;
          case 'accept':
            if (to) {
              p.links.add(m.to);
              to.links.add(id);
              send(to, { t: 'accept', from: id });
            }
            break;
          case 'to':
            if (to) send(to, { t: 'from', from: id, d: m.d });
            break;
          case 'bye':
            if (to) {
              p.links.delete(m.to);
              to.links.delete(id);
              send(to, { t: 'close', from: id });
            }
            break;
          case 'ping':
            send(p, { t: 'pong', n: m.n });
            break;
        }
      });
      ws.on('close', () => {
        peers.delete(id);
        for (const lid of p.links) {
          const q = peers.get(lid);
          if (q) {
            q.links.delete(id);
            send(q, { t: 'close', from: id });
          }
        }
        if (rooms.delete(id)) log(`房主離線，房間移除 ${id}`);
        log(`離線 ${id}`);
      });
    });
    server.on('error', (e) => {
      rej(
        new Error(
          e.code === 'EADDRINUSE'
            ? `port ${port} 已被其他程式佔用`
            : e.code === 'EACCES'
              ? `沒有權限使用 port ${port}`
              : e.message,
        ),
      );
    });
    server.listen(port, '0.0.0.0', () => {
      game = { server, wss, peers, rooms, startedAt: Date.now(), port };
      log(`遊戲伺服器啟動：port ${port}`);
      res();
    });
  });
}
function stopGame() {
  return new Promise((res) => {
    if (!game) return res();
    const g = game;
    game = null;
    for (const p of g.peers.values()) {
      try {
        p.ws.send(JSON.stringify({ t: 'shutdown' }));
        p.ws.close();
      } catch (e) {}
    }
    g.wss.close();
    g.server.close(() => {
      log('遊戲伺服器已停止');
      res();
    });
    setTimeout(res, 1500);
  });
}

// ===================== 控制台（固定 8090，任何位址可連） =====================
function controlPage() {
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RUBICON 伺服器控制台</title>
<style>body{margin:0;background:#0f1319;color:#e6edf3;font:14px/1.6 "Noto Sans TC",system-ui,sans-serif}.wrap{max-width:980px;margin:0 auto;padding:20px}h1{font-size:20px;margin:0 0 6px;color:#ffb020;letter-spacing:.1em}h2{font-size:15px;margin:22px 0 8px;color:#5cc8ff}.card{background:#171c24;border:1px solid #2a3644;border-radius:6px;padding:14px 16px;margin:10px 0}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}button{font:inherit;padding:7px 16px;border:1px solid #3a4655;background:#222a35;color:#e6edf3;cursor:pointer;border-radius:4px}button.p{background:#ffb020;color:#111;border-color:#ffb020;font-weight:700}button.d{background:#5a1f24;border-color:#8a2a32}button:disabled{opacity:.4;cursor:default}input{font:inherit;background:#0f1319;color:#e6edf3;border:1px solid #3a4655;padding:6px 10px;border-radius:4px;width:90px}.st{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700}.on{background:#1f6b3a;color:#b6ffcf}.off{background:#5a1f24;color:#ffb6b6}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #2a3644;padding:6px 8px;text-align:left}th{color:#9aa6b6;font-weight:400}pre{background:#0b0e13;border:1px solid #2a3644;padding:10px;height:180px;overflow:auto;font-size:12px;margin:0}.qr{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}.qr img{background:#fff;padding:6px;border-radius:4px}.dim{color:#9aa6b6}code{background:#0b0e13;padding:2px 6px;border-radius:3px}</style></head><body><div class="wrap">
<h1>RUBICON PROTOCOL — 伺服器控制台</h1><div class="dim">版本 ${VERSION} · 控制台 port 8090 · 遊戲網頁與房間中繼由下方遊戲伺服器提供</div>
<div class="card"><div class="row"><span>狀態：<span id="st" class="st off">停止</span></span><span>遊戲 port <input id="port" type="number" min="1" max="65535"></span><button class="p" id="bStart">啟動</button><button id="bStop">停止</button><button id="bRestart">重啟</button><button class="d" id="bQuit">結束程式</button><span id="err" style="color:#ff8a8a"></span></div>
<div class="dim" style="margin-top:8px">port 80 被佔用時（IIS／Skype／其他網頁伺服器）請改用 8080 等其他 port。第一次啟動請在 Windows 防火牆詢問時按「允許」。</div></div>
<h2>玩家連線位址（區網內用瀏覽器開啟即可玩單機或多人）</h2><div class="card qr" id="addrs"></div>
<h2>房間</h2><div class="card"><table><thead><tr><th>房名</th><th>房主</th><th>人數</th><th>關卡</th><th>狀態</th><th>觀戰</th><th></th></tr></thead><tbody id="rooms"></tbody></table><div class="dim" id="peers" style="margin-top:6px"></div></div>
<h2>日誌</h2><pre id="log"></pre></div>
<script>
const $=id=>document.getElementById(id); let cur={};
async function api(p,b){ const r=await fetch(p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined}); return r.json(); }
async function refresh(){ try{ const s=await api('/api/status'); cur=s; $('st').textContent=s.running?'執行中（port '+s.port+'）':'停止'; $('st').className='st '+(s.running?'on':'off'); if(document.activeElement!==$('port')) $('port').value=s.cfgPort; $('bStart').disabled=s.running; $('bStop').disabled=!s.running; $('bRestart').disabled=!s.running;
  $('addrs').innerHTML=s.running? s.ips.map(i=>{ const url='http://'+i.ip+(s.port===80?'':':'+s.port)+'/'; return '<div><div><b>'+i.name+'</b>　<a style="color:#5cc8ff" href="'+url+'" target="_blank">'+url+'</a>　<a class="dim" href="'+url+'models" target="_blank">模型庫</a></div><img src="/api/qr?text='+encodeURIComponent(url)+'" width="140" height="140"></div>'; }).join('') : '<span class="dim">伺服器未啟動</span>';
  $('rooms').innerHTML=(s.rooms||[]).map(r=>'<tr><td>'+esc(r.room)+'</td><td>'+esc(r.host)+'</td><td>'+r.n+'/4</td><td>'+r.level+'</td><td>'+(r.state==='play'?'<span class="st on">任務中</span>':'大廳')+'</td><td>'+(r.spectators||0)+'</td><td><button onclick="spectate(\\''+r.peerId+'\\')">觀戰</button></td></tr>').join('')||'<tr><td colspan="7" class="dim">目前沒有房間</td></tr>';
  $('peers').textContent='線上連線數：'+(s.peers||0); $('log').textContent=s.logs.join('\\n'); $('log').scrollTop=$('log').scrollHeight; }catch(e){ $('st').textContent='控制台連線中斷'; } }
function esc(s){ return String(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function spectate(id){ const host=location.hostname; window.open('http://'+host+(cur.port===80?'':':'+cur.port)+'/?spectate='+id,'_blank'); }
$('bStart').onclick=async()=>{ $('err').textContent=''; const r=await api('/api/start',{port:+$('port').value}); if(r.error) $('err').textContent=r.error; refresh(); };
$('bStop').onclick=async()=>{ await api('/api/stop',{}); refresh(); }; $('bRestart').onclick=async()=>{ $('err').textContent=''; const r=await api('/api/restart',{port:+$('port').value}); if(r.error) $('err').textContent=r.error; refresh(); };
$('bQuit').onclick=async()=>{ if(confirm('確定要結束伺服器程式？所有房間會中斷。')){ await api('/api/quit',{}); document.body.innerHTML='<div class="wrap"><h1>程式已結束</h1></div>'; } };
refresh(); setInterval(refresh,1500);
</script></body></html>`;
}
function status() {
  return {
    running: !!game,
    port: game ? game.port : null,
    cfgPort: cfg.port,
    ips: localIPs(),
    peers: game ? game.peers.size : 0,
    rooms: game
      ? [...game.rooms.values()].map((r) => ({
          peerId: r.hostId,
          room: r.room,
          host: r.host,
          n: r.n || 1,
          level: r.level || 1,
          full: !!r.full,
          state: r.state || 'lobby',
          spectators: r.spectators || 0,
        }))
      : [],
    logs: logs.slice(-120),
    version: VERSION,
  };
}
const control = http.createServer((req, resp) => {
  const u = new URL(req.url, 'http://x');
  const json = (o, code = 200) => {
    resp.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    resp.end(JSON.stringify(o));
  };
  if (u.pathname === '/') {
    resp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    resp.end(controlPage());
    return;
  }
  if (u.pathname === '/api/status') return json(status());
  if (u.pathname === '/api/qr') {
    const q = qrcode(0, 'M');
    q.addData(u.searchParams.get('text') || '');
    q.make();
    const svg = q.createSvgTag({ cellSize: 4, margin: 2 });
    resp.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    resp.end(svg);
    return;
  }
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let b = {};
      try {
        b = JSON.parse(body || '{}');
      } catch (e) {}
      const port = b.port > 0 && b.port < 65536 ? b.port : cfg.port;
      try {
        if (u.pathname === '/api/start') {
          cfg.port = port;
          saveCfg();
          await startGame(port);
          return json({ ok: true });
        }
        if (u.pathname === '/api/stop') {
          await stopGame();
          return json({ ok: true });
        }
        if (u.pathname === '/api/restart') {
          await stopGame();
          cfg.port = port;
          saveCfg();
          await startGame(port);
          return json({ ok: true });
        }
        if (u.pathname === '/api/quit') {
          json({ ok: true });
          log('結束程式');
          await stopGame();
          setTimeout(() => process.exit(0), 300);
          return;
        }
      } catch (e) {
        log('錯誤：' + e.message);
        return json({ error: e.message });
      }
      json({ error: 'unknown' }, 404);
    });
    return;
  }
  resp.writeHead(404);
  resp.end();
});
control.listen(CONTROL_PORT, '0.0.0.0', () => {
  log(`控制台：http://localhost:${CONTROL_PORT}/`);
  const ips = localIPs();
  for (const i of ips) log(`　區網位址：http://${i.ip}:${CONTROL_PORT}/`);
  if (cfg.autoStart) startGame(cfg.port).catch((e) => log('自動啟動失敗：' + e.message));
  openBrowser(`http://localhost:${CONTROL_PORT}/`);
});
control.on('error', (e) => {
  console.error('控制台無法啟動：', e.message);
});
function openBrowser(url) {
  const { exec } = require('child_process');
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
process.on('SIGINT', async () => {
  await stopGame();
  process.exit(0);
});
console.log('RUBICON PROTOCOL Server v' + VERSION + '  —  關閉此視窗即停止伺服器');
