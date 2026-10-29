// 程式模型的近拍（docs/model-detail.md）：在模型庫的檢視窗關掉輔助標示，從前後兩個斜角各拍一張。
//   node scripts/model-shots.js vehicle/tank vehicle/heli prop/container --tag=after
// 輸出 test-results/shots/<槽位>-<tag>-a.png／-b.png。需要先 npm run build；--html＝改用別的模型庫檔案（例如舊版，比較用）、
// --zoom＝第一張的距離倍率（預設 0.62）
/* global window, document -- page.evaluate 的回呼在瀏覽器端執行 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'test-results', 'shots');
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const tag = (process.argv.find((a) => a.startsWith('--tag=')) || '--tag=now').slice(6);
const zoom = +(process.argv.find((a) => a.startsWith('--zoom=')) || '--zoom=0.62').slice(7);
const EXE = [
  process.env.BENCH_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => p && fs.existsSync(p));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const p = await b.newPage({ viewport: { width: 1300, height: 800 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const html =
    (process.argv.find((a) => a.startsWith('--html=')) || '').slice(7) ||
    path.join(ROOT, 'dist', 'model-library.html');
  const url = require('url').pathToFileURL(path.resolve(html)).href + '?test';
  for (const id of ids) {
    await p.goto(url + '#' + id);
    await p.waitForFunction(() => window.__inspect && document.querySelector('#insToggles input'), null, {
      timeout: 30000,
    });
    await p.waitForTimeout(1500);
    const info = await p.evaluate(() => {
      for (const cb of document.querySelectorAll('#insToggles input')) {
        const off = ['axes', 'conns', 'dims', 'box', 'ruler', 'human', 'grid'].includes(cb.dataset.k);
        if (off && cb.checked) cb.click();
      }
      const ins = window.__inspect;
      return { d: ins.camera.position.distanceTo(ins.controls.target) };
    });
    for (const [k, ang] of [
      ['a', -0.75],
      ['b', 2.3],
    ]) {
      await p.evaluate(
        ({ ang, zoom }) => {
          const ins = window.__inspect,
            c = ins.camera,
            t = ins.controls.target;
          const d = c.position.distanceTo(t) * zoom,
            el = 0.42;
          c.position.set(
            t.x + Math.sin(ang) * Math.cos(el) * d,
            t.y + Math.sin(el) * d,
            t.z - Math.cos(ang) * Math.cos(el) * d,
          );
          c.lookAt(t);
          ins.controls.update();
        },
        { ang, zoom: k === 'a' ? zoom : zoom / (info.d ? 1 : 1) },
      );
      await p.waitForTimeout(700);
      await p.screenshot({
        path: path.join(OUT, `${id.replace(/\//g, '_')}-${tag}-${k}.png`),
        clip: { x: 0, y: 0, width: 1040, height: 800 },
      });
      // 第二個角度用原本的距離（第一張拉近之後再拉回）
      await p.evaluate((zoom) => {
        const ins = window.__inspect,
          c = ins.camera,
          t = ins.controls.target;
        c.position
          .sub(t)
          .multiplyScalar(1 / zoom)
          .add(t);
      }, zoom);
    }
    const tris = await p.evaluate(() => {
      const r = [...document.querySelectorAll('#insInfo div, .insRow, tr')]
        .map((e) => e.textContent)
        .join('|');
      const m =
        /三角面\s*([\d,]+)/.exec(r) || /三角面([\d,]+)/.exec(document.body.innerText.replace(/\s+/g, ''));
      const c = /繪製次數([\d,]+)/.exec(document.body.innerText.replace(/\s+/g, ''));
      return (m ? m[1] : '?') + ' 三角形、' + (c ? c[1] : '?') + ' 次繪製';
    });
    console.log(`${id}：${tris}`);
  }
  if (errs.length) console.log('錯誤：\n' + errs.slice(0, 10).join('\n'));
  await b.close();
})();
