// 筆尖、紙紋與筆刷預設。圖形都用程式畫（白色＝有顏色），不需要外部圖檔。
(function () {
  'use strict';
  const RP = (window.RP = window.RP || {});
  const N = 128;

  // 固定種子的亂數，每次產生的筆尖都一樣
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function canvasTex(size, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    draw(g, size);
    const t = new THREE.CanvasTexture(c);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.canvas = c;
    return t;
  }

  function star(g, cx, cy, ro, ri, n, rot) {
    g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? ri : ro;
      const a = rot + (i * Math.PI) / n - Math.PI / 2;
      g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    g.closePath();
    g.fill();
  }

  const TIP_DRAW = {
    square: (g, n) => g.fillRect(n * 0.08, n * 0.08, n * 0.84, n * 0.84),
    chalk: (g, n) => {
      const r = rng(7);
      for (let i = 0; i < 2600; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * n * 0.46;
        g.globalAlpha = 0.25 + r() * 0.6;
        g.fillRect(n / 2 + d * Math.cos(a), n / 2 + d * Math.sin(a), 2, 2);
      }
    },
    spray: (g, n) => {
      const r = rng(11);
      for (let i = 0; i < 260; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * n * 0.46;
        g.globalAlpha = 0.5 + r() * 0.5;
        g.beginPath();
        g.arc(n / 2 + d * Math.cos(a), n / 2 + d * Math.sin(a), 0.8 + r() * 1.6, 0, 7);
        g.fill();
      }
    },
    flat: (g, n) => {
      g.beginPath();
      g.ellipse(n / 2, n / 2, n * 0.46, n * 0.14, 0, 0, 7);
      g.fill();
    },
    star: (g, n) => star(g, n / 2, n / 2 + n * 0.03, n * 0.47, n * 0.19, 5, 0),
    sparkle: (g, n) => star(g, n / 2, n / 2, n * 0.48, n * 0.08, 4, 0),
    heart: (g, n) => {
      const s = n / 32;
      g.beginPath();
      g.moveTo(16 * s, 28 * s);
      g.bezierCurveTo(2 * s, 18 * s, 2 * s, 6 * s, 9 * s, 5 * s);
      g.bezierCurveTo(13 * s, 4.5 * s, 15.5 * s, 7 * s, 16 * s, 9 * s);
      g.bezierCurveTo(16.5 * s, 7 * s, 19 * s, 4.5 * s, 23 * s, 5 * s);
      g.bezierCurveTo(30 * s, 6 * s, 30 * s, 18 * s, 16 * s, 28 * s);
      g.fill();
    },
    flower: (g, n) => {
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
        g.beginPath();
        g.ellipse(n / 2 + Math.cos(a) * n * 0.24, n / 2 + Math.sin(a) * n * 0.24, n * 0.2, n * 0.13, a, 0, 7);
        g.fill();
      }
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(n / 2, n / 2, n * 0.08, 0, 7);
      g.fill();
    },
  };

  const GRAIN_DRAW = {
    // 紙：多層雜訊
    paper: (g, n) => {
      const img = g.getImageData(0, 0, n, n);
      const r = rng(3);
      const base = new Float32Array(n * n);
      for (let oct = 0, amp = 1; oct < 4; oct++, amp *= 0.5) {
        const cell = 32 >> oct;
        const gw = Math.ceil(n / cell) + 1;
        const grid = new Float32Array(gw * gw).map(() => r());
        const at = (x, y) => grid[(y % (gw - 1)) * gw + (x % (gw - 1))];
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            const gx = x / cell;
            const gy = y / cell;
            const x0 = Math.floor(gx);
            const y0 = Math.floor(gy);
            const fx = gx - x0;
            const fy = gy - y0;
            const v =
              (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
            base[y * n + x] += v * amp;
          }
      }
      for (let i = 0; i < n * n; i++) {
        const v = Math.min(255, Math.max(0, (base[i] / 1.875 - 0.25) * 1.6 * 255));
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    },
    // 帆布：交錯的織紋
    canvas: (g, n) => {
      const img = g.getImageData(0, 0, n, n);
      const r = rng(5);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const wx = Math.sin((x / n) * Math.PI * 32) * 0.5 + 0.5;
          const wy = Math.sin((y / n) * Math.PI * 32) * 0.5 + 0.5;
          const v = (((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? wx : wy) * 0.8 + r() * 0.2) * 255;
          const i = (y * n + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      g.putImageData(img, 0, 0);
    },
  };

  const tipCache = {};
  const grainCache = {};
  RP.tipTexture = (name) => {
    if (!name || name === 'round' || !TIP_DRAW[name]) return null;
    return (tipCache[name] = tipCache[name] || canvasTex(N, TIP_DRAW[name]));
  };
  RP.grainTexture = (name) => {
    if (!name || name === 'none' || !GRAIN_DRAW[name]) return null;
    return (grainCache[name] = grainCache[name] || canvasTex(256, GRAIN_DRAW[name], true));
  };

  RP.TIPS = [
    ['round', '圓形'],
    ['square', '方形'],
    ['flat', '扁平'],
    ['chalk', '粉筆'],
    ['spray', '噴霧'],
    ['star', '星星'],
    ['sparkle', '閃光'],
    ['heart', '愛心'],
    ['flower', '花'],
  ];
  RP.GRAINS = [
    ['none', '無'],
    ['paper', '紙'],
    ['canvas', '帆布'],
  ];

  // 筆刷預設：只列出要改的設定，其他用 DEFAULT
  const DEFAULT = {
    hardness: 0.6,
    opacity: 1,
    spacing: 0.12,
    pSize: true,
    pOpacity: false,
    tip: 'round',
    grain: 'none',
    grainAmt: 0.5,
    scatter: 0,
    jitter: 0,
    rotRandom: false,
    rotFollow: false,
  };
  RP.BRUSH_PRESETS = [
    { id: 'gpen', name: 'G筆', hardness: 0.92, spacing: 0.06 },
    { id: 'round', name: '圓筆', hardness: 0.6 },
    { id: 'pencil', name: '鉛筆', hardness: 0.85, spacing: 0.08, pOpacity: true, grain: 'paper', grainAmt: 0.6 },
    { id: 'air', name: '噴槍', hardness: 0, opacity: 0.35, spacing: 0.05, pSize: false, pOpacity: true },
    { id: 'water', name: '水彩', hardness: 0.2, opacity: 0.55, spacing: 0.06, grain: 'paper', grainAmt: 0.35 },
    { id: 'marker', name: '麥克筆', tip: 'flat', hardness: 0.9, opacity: 0.8, spacing: 0.05, pSize: false, rotFollow: true },
    { id: 'chalk', name: '粉筆', tip: 'chalk', spacing: 0.15, grain: 'canvas', grainAmt: 0.4, rotRandom: true },
    { id: 'spray', name: '噴霧', tip: 'spray', spacing: 0.25, pSize: false, rotRandom: true, jitter: 0.2 },
    { id: 'square', name: '方頭', tip: 'square', spacing: 0.08, pSize: false },
    { id: 'stars', name: '星星', tip: 'star', spacing: 1.2, pSize: false, scatter: 0.8, jitter: 0.6, rotRandom: true },
    { id: 'sparkle', name: '閃光', tip: 'sparkle', spacing: 1.4, pSize: false, scatter: 0.9, jitter: 0.7, rotRandom: true },
    { id: 'hearts', name: '愛心', tip: 'heart', spacing: 1.3, pSize: false, scatter: 0.7, jitter: 0.5, rotRandom: true },
    { id: 'flowers', name: '花', tip: 'flower', spacing: 1.3, pSize: false, scatter: 0.7, jitter: 0.5, rotRandom: true },
  ].map((p) => Object.assign({}, DEFAULT, p));
})();
