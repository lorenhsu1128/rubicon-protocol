// 把伺服器預設組的來源發佈到執行中的伺服器：內建的玩家預設機甲（src/assets/player-mech/ 的 GLB＋joints.json）
// 與地圖物件等其他槽位（src/assets/server-default/，檔名＝槽位 id，例如 prop/rock.glb）
// npm run publish:server -- [--host=http://127.0.0.1:80] [--src=資料夾（只發佈這一個）] [--force] [--keep]
// - 透過執行中的 rubicon-server 的 API（/api/models/default/…）寫入，伺服器不用重新啟動；
//   沒給 --host 時讀專案根目錄的 rubicon-server.json 的 port（預設 80）
// - 內容雜湊和伺服器上相同的 GLB 略過（--force 全部重傳）
// - 伺服器上有、來源資料夾沒有的機甲區塊與武器（head／core／arms／legs／booster／weapon／back）移除（--keep 保留）；
//   載具、地圖物件、小物件只上傳、不移除（伺服器上刪掉的槽位要在模型庫刪）
// - 關節設定整份換成 joints.json
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const arg = (k) => {
  const a = process.argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : null;
};
const flag = (k) => process.argv.includes('--' + k);
const MECH_CATS = ['head', 'core', 'arms', 'legs', 'booster', 'weapon', 'back'];

function defaultHost() {
  let port = 80;
  try {
    port = JSON.parse(fs.readFileSync(path.join(ROOT, 'rubicon-server.json'), 'utf8')).port || 80;
  } catch (e) {}
  return 'http://127.0.0.1' + (port === 80 ? '' : ':' + port);
}

function listGlb(dir) {
  const out = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.glb')) out.push(p);
    }
  })(dir);
  return out;
}

async function api(host, u, opt) {
  const r = await fetch(host + u, opt);
  const txt = await r.text();
  if (!r.ok) throw new Error(`${opt ? opt.method : 'GET'} ${u}：${r.status} ${txt}`);
  return txt ? JSON.parse(txt) : null;
}

async function main() {
  const host = (arg('host') || defaultHost()).replace(/\/$/, '');
  const srcs = (arg('src') ? [arg('src')] : ['src/assets/player-mech', 'src/assets/server-default'])
    .map((d) => path.resolve(ROOT, d))
    .filter((d) => fs.existsSync(d));
  let man;
  try {
    man = await api(host, '/api/models/default');
  } catch (e) {
    console.error(`連不到伺服器 ${host}（先啟動 rubicon-server）：${e.message}`);
    process.exit(1);
  }
  const files = srcs.flatMap((src) => listGlb(src).map((f) => [src, f]));
  const slots = new Set();
  let put = 0,
    same = 0,
    removed = 0;
  for (const [src, f] of files) {
    const slot = path
      .relative(src, f)
      .split(path.sep)
      .join('/')
      .replace(/\.glb$/, '');
    slots.add(slot);
    const body = fs.readFileSync(f);
    const h = crypto.createHash('sha256').update(body).digest('hex');
    const rec = man.models[slot];
    if (!flag('force') && rec && rec.h === h) {
      same++;
      continue;
    }
    const q = `?name=${encodeURIComponent(path.basename(f))}`;
    await api(host, `/api/models/default/glb/${encodeURIComponent(slot)}${q}`, { method: 'PUT', body });
    put++;
  }
  const hasMech = [...slots].some((s) => MECH_CATS.includes(s.split('/')[0]));
  if (!flag('keep') && hasMech)
    for (const slot of Object.keys(man.models))
      if (MECH_CATS.includes(slot.split('/')[0]) && !slots.has(slot)) {
        await api(host, `/api/models/default/glb/${encodeURIComponent(slot)}`, { method: 'DELETE' });
        removed++;
      }
  const jf = srcs.map((d) => path.join(d, 'joints.json')).find((p) => fs.existsSync(p));
  let nj = 0;
  if (jf) {
    const joints = fs.readFileSync(jf, 'utf8');
    nj = Object.keys(JSON.parse(joints)).length;
    await api(host, '/api/models/default/joints', {
      method: 'PUT',
      body: joints,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  console.log(
    `已發佈到 ${host} 的伺服器預設組：GLB 上傳 ${put} 個、相同略過 ${same} 個、移除 ${removed} 個，` +
      `關節設定 ${nj} 個槽位`,
  );
}

main().catch((e) => {
  console.error('發佈失敗：' + e.message);
  process.exit(1);
});
