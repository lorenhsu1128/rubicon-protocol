// 去除圖片背景：白底，或 AI 工具畫進圖裡的「假透明」棋盤格（白＋淺灰交錯）。
// 1. 從圖片四周取樣，找出背景的顏色（低彩度的淺色；一種＝白底、兩種＝棋盤格）
// 2. 從邊緣開始，把相連、像背景的像素整片去掉（圖案裡的白色、灰字不會被誤刪）
// 3. 被圖案包住的區域（例如字母 O 的洞）如果也是背景（棋盤格兩色都有，或純色的背景色），一起去掉
// 4. 和去掉的區域相鄰的邊緣像素，依和背景色的差距算出半透明並還原原本的顏色（避免白邊、灰邊）
(function () {
  'use strict';
  const RP = (window.RP = window.RP || {});

  // tol：0～1，越大去得越多
  RP.removeBackground = function (img, tol) {
    const maxSide = 4096;
    const k = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * k));
    const h = Math.max(1, Math.round(img.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    const im = g.getImageData(0, 0, w, h);
    const d = im.data;
    const n = w * h;
    const satTol = 14 + tol * 40; // 低彩度的範圍
    const sat = (i) => Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) - Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    const lum = (i) => (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;

    // 1. 邊緣取樣：低彩度的淺色
    const border = [];
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
    const lums = [];
    for (const i of border) if (d[i * 4 + 3] > 250 && sat(i) <= satTol && lum(i) >= 140) lums.push(lum(i));
    if (lums.length < border.length * 0.3) return { canvas: null, removed: 0, mode: 'none' };
    lums.sort((a, b) => a - b);
    // 兩種色調：以最亮的為準，差超過 18 的算第二種
    const hi = lums[Math.floor(lums.length * 0.9)];
    const second = lums.filter((v) => v < hi - 18);
    const twoTone = second.length > lums.length * 0.15;
    const lo = twoTone ? second[Math.floor(second.length * 0.5)] : hi;
    const tones = twoTone ? [hi, lo] : [hi];
    const lumMin = Math.min(...tones) - 10 - tol * 50;
    const bgLike = (i) => d[i * 4 + 3] > 0 && sat(i) <= satTol && lum(i) >= lumMin;
    const nearTone = (i) => {
      const L = lum(i);
      let best = 0;
      for (let t = 1; t < tones.length; t++) if (Math.abs(L - tones[t]) < Math.abs(L - tones[best])) best = t;
      return best;
    };

    // 2. 從邊緣灌水
    const removed = new Uint8Array(n);
    const stack = [];
    for (const i of border)
      if (!removed[i] && bgLike(i)) {
        removed[i] = 1;
        stack.push(i);
      }
    const flood = (st, mark, test) => {
      while (st.length) {
        const i = st.pop();
        const x = i % w;
        const y = (i - x) / w;
        if (x > 0 && !mark[i - 1] && test(i - 1)) (mark[i - 1] = 1), st.push(i - 1);
        if (x < w - 1 && !mark[i + 1] && test(i + 1)) (mark[i + 1] = 1), st.push(i + 1);
        if (y > 0 && !mark[i - w] && test(i - w)) (mark[i - w] = 1), st.push(i - w);
        if (y < h - 1 && !mark[i + w] && test(i + w)) (mark[i + w] = 1), st.push(i + w);
      }
    };
    flood(stack, removed, bgLike);

    // 3. 被包住的背景區域
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (removed[i] || seen[i] || !bgLike(i)) continue;
      const comp = [i];
      seen[i] = 1;
      const st = [i];
      while (st.length) {
        const j = st.pop();
        const x = j % w;
        const y = (j - x) / w;
        for (const q of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1])
          if (q >= 0 && !seen[q] && !removed[q] && bgLike(q)) {
            seen[q] = 1;
            st.push(q);
            comp.push(q);
          }
      }
      if (comp.length < 24) continue;
      let isBg;
      if (twoTone) {
        // 棋盤格：兩種色調都要有一定比例
        const cnt = [0, 0];
        for (const j of comp) cnt[nearTone(j)]++;
        isBg = cnt[0] > comp.length * 0.15 && cnt[1] > comp.length * 0.15;
      } else {
        // 白底：幾乎整塊都是背景色
        let ok = 0;
        for (const j of comp) if (Math.abs(lum(j) - hi) <= 6) ok++;
        isBg = ok > comp.length * 0.95;
      }
      if (isBg) for (const j of comp) removed[j] = 1;
    }

    // 4. 邊緣：和背景相鄰兩個像素內，依和背景色的差距算 alpha，並把背景色從顏色裡扣掉
    let count = 0;
    const edge = new Float32Array(n).fill(-1); // 鄰近被去掉像素的背景亮度
    for (let i = 0; i < n; i++) {
      if (!removed[i]) continue;
      count++;
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (!removed[q] && edge[q] < 0) edge[q] = tones[nearTone(i)];
        }
    }
    for (let i = 0; i < n; i++) {
      if (removed[i]) {
        d[i * 4 + 3] = 0;
        continue;
      }
      const B = edge[i];
      if (B < 0) continue;
      // 「顏色轉透明」：以背景色 B 為基準，各通道需要的最小不透明度
      let a = 0;
      for (let ch = 0; ch < 3; ch++) {
        const v = d[i * 4 + ch];
        a = Math.max(a, v < B ? (B - v) / B : v > B ? (v - B) / (255 - B || 1) : 0);
      }
      a = Math.min(1, a * 1.15);
      if (a >= 0.999) continue;
      if (a < 0.02) {
        d[i * 4 + 3] = 0;
        continue;
      }
      for (let ch = 0; ch < 3; ch++) d[i * 4 + ch] = Math.max(0, Math.min(255, Math.round((d[i * 4 + ch] - (1 - a) * B) / a)));
      d[i * 4 + 3] = Math.round(a * d[i * 4 + 3]);
    }
    g.putImageData(im, 0, 0);
    return { canvas: c, removed: count / n, mode: twoTone ? 'checker' : 'white' };
  };
})();
