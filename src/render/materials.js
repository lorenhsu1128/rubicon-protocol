// ============================================================
//  MECH BUILDER v3 — 硬表面分層裝甲 / 面板法線貼圖 / 墨線描邊 / 貼花
// ============================================================
import { rnd, rndi } from '../core/math.js';

function makeWearTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#d4d4d4';
  x.fillRect(0, 0, 256, 256);
  const img = x.getImageData(0, 0, 256, 256),
    d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = 200 + Math.random() * 55;
    d[i] = d[i + 1] = d[i + 2] = n;
  }
  x.putImageData(img, 0, 0);
  x.globalAlpha = 0.35;
  for (let i = 0; i < 90; i++) {
    x.strokeStyle = Math.random() < 0.5 ? '#5a5a5a' : '#f8f8f8';
    x.lineWidth = rnd(0.5, 1.5);
    x.beginPath();
    const sx = rnd(0, 256),
      sy = rnd(0, 256);
    x.moveTo(sx, sy);
    x.lineTo(sx + rnd(-30, 30), sy + rnd(-30, 30));
    x.stroke();
  }
  for (let i = 0; i < 50; i++) {
    x.fillStyle = 'rgba(50,42,34,' + rnd(0.05, 0.3) + ')';
    x.beginPath();
    x.arc(rnd(0, 256), rnd(0, 256), rnd(3, 28), 0, 7);
    x.fill();
  }
  // edge grime along panel borders
  x.globalAlpha = 1;
  x.strokeStyle = 'rgba(30,30,30,.55)';
  x.lineWidth = 2;
  x.strokeRect(2, 2, 252, 252);
  x.strokeStyle = 'rgba(255,255,255,.35)';
  x.lineWidth = 1;
  x.strokeRect(5, 5, 246, 246);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// panel-line normal map: bevelled rectangles + rivets + grooves
function makePanelNormal() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = 'rgb(128,128,255)';
  x.fillRect(0, 0, S, S);
  const bevel = (px, py, w, h, t) => {
    x.fillStyle = 'rgb(128,' + (128 + 62) + ',255)';
    x.fillRect(px, py, w, t);
    x.fillStyle = 'rgb(128,' + (128 - 62) + ',255)';
    x.fillRect(px, py + h - t, w, t);
    x.fillStyle = 'rgb(' + (128 - 62) + ',128,255)';
    x.fillRect(px, py, t, h);
    x.fillStyle = 'rgb(' + (128 + 62) + ',128,255)';
    x.fillRect(px + w - t, py, t, h);
  };
  // outer bevel of the whole tile (every face gets an edge highlight)
  bevel(0, 0, S, S, 7);
  // a few inset panels
  const panels = [
    [40, 40, 200, 150],
    [280, 60, 190, 120],
    [60, 230, 150, 220],
    [250, 220, 220, 110],
    [260, 360, 200, 110],
  ];
  for (const [px, py, w, h] of panels) {
    x.fillStyle = 'rgb(128,128,255)';
    x.fillRect(px, py, w, h);
    bevel(px, py, w, h, 4);
    x.fillStyle = 'rgba(128,128,255,1)';
  }
  // grooves (thin line pairs)
  x.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const sx = rnd(20, S - 20),
      sy = rnd(20, S - 20),
      L = rnd(40, 160),
      vert = Math.random() < 0.5;
    x.strokeStyle = vert ? 'rgb(96,128,255)' : 'rgb(128,160,255)';
    x.beginPath();
    x.moveTo(sx, sy);
    x.lineTo(vert ? sx : sx + L, vert ? sy + L : sy);
    x.stroke();
    x.strokeStyle = vert ? 'rgb(160,128,255)' : 'rgb(128,96,255)';
    x.beginPath();
    x.moveTo(vert ? sx + 2 : sx, vert ? sy : sy + 2);
    x.lineTo(vert ? sx + 2 : sx + L, vert ? sy + L : sy + 2);
    x.stroke();
  }
  // rivets
  for (let i = 0; i < 60; i++) {
    const rx = rnd(10, S - 10),
      ry = rnd(10, S - 10),
      r = rnd(3, 6);
    const g = x.createRadialGradient(rx - r * 0.4, ry - r * 0.4, 0, rx, ry, r);
    g.addColorStop(0, 'rgb(150,150,255)');
    g.addColorStop(0.6, 'rgb(110,110,255)');
    g.addColorStop(1, 'rgb(128,128,255)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(rx, ry, r, 0, 7);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// decal atlas: 4x2 tiles — warning triangle, number, hazard stripes, unit mark, arrow, "NO STEP", dot code, blank
function makeDecalTexture() {
  const S = 512,
    T = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, S, 256);
  const tile = (i, fn) => {
    x.save();
    x.translate((i % 4) * T, Math.floor(i / 4) * T);
    fn();
    x.restore();
  };
  tile(0, () => {
    x.fillStyle = '#ffc21a';
    x.beginPath();
    x.moveTo(64, 14);
    x.lineTo(118, 110);
    x.lineTo(10, 110);
    x.closePath();
    x.fill();
    x.fillStyle = '#111';
    x.font = 'bold 64px sans-serif';
    x.textAlign = 'center';
    x.fillText('!', 64, 100);
  });
  tile(1, () => {
    x.fillStyle = '#e8e2d0';
    x.font = 'bold 84px Chakra Petch, sans-serif';
    x.textAlign = 'center';
    x.fillText(String(rndi(10, 99)), 64, 96);
  });
  tile(2, () => {
    x.fillStyle = '#ffc21a';
    x.fillRect(0, 40, 128, 48);
    x.fillStyle = '#111';
    for (let i = -1; i < 8; i++) {
      x.beginPath();
      x.moveTo(i * 24, 88);
      x.lineTo(i * 24 + 16, 88);
      x.lineTo(i * 24 + 40, 40);
      x.lineTo(i * 24 + 24, 40);
      x.closePath();
      x.fill();
    }
  });
  tile(3, () => {
    x.fillStyle = '#e8e2d0';
    x.font = 'bold 46px Chakra Petch, sans-serif';
    x.textAlign = 'center';
    x.fillText('AC', 64, 56);
    x.font = 'bold 26px Chakra Petch, sans-serif';
    x.fillText('AC-01', 64, 96);
    x.fillRect(16, 64, 96, 3);
  });
  tile(4, () => {
    x.fillStyle = '#ff5a2a';
    x.beginPath();
    x.moveTo(20, 64);
    x.lineTo(80, 20);
    x.lineTo(80, 46);
    x.lineTo(112, 46);
    x.lineTo(112, 82);
    x.lineTo(80, 82);
    x.lineTo(80, 108);
    x.closePath();
    x.fill();
  });
  tile(5, () => {
    x.fillStyle = '#e8e2d0';
    x.font = 'bold 34px Chakra Petch, sans-serif';
    x.textAlign = 'center';
    x.fillText('CUBEE', 64, 58);
    x.font = 'bold 24px Chakra Petch, sans-serif';
    x.fillText('AC-01', 64, 92);
    x.fillRect(16, 66, 96, 3);
  });
  tile(6, () => {
    x.fillStyle = '#e8e2d0';
    for (let i = 0; i < 5; i++) {
      x.fillRect(14 + i * 22, 40, 10, 48);
    }
    x.fillStyle = '#ff5a2a';
    x.fillRect(14, 96, 108, 8);
  });
  tile(7, () => {
    x.fillStyle = '#e8e2d0';
    x.font = 'bold 74px Chakra Petch, sans-serif';
    x.textAlign = 'center';
    x.fillText('01', 64, 92);
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
export let WEAR = null,
  PANEL = null,
  DECAL = null;
// 配色槽位的實際顏色（含未設定時的回退）：程式模型與 GLB 換色共用
export function palColor(pal, slot) {
  switch (slot) {
    case 'main2':
      return pal.main2 || pal.main;
    case 'main3':
      return pal.main3 || pal.main2 || pal.main;
    case 'gun':
      return pal.gun || 0x34373c;
    case 'grey':
      return pal.grey || 0x8a8f95;
    case 'glow':
      return pal.glow || 0x9ff0ff;
    default:
      return pal[slot];
  }
}
export function mechMats(pal) {
  if (!WEAR) {
    WEAR = makeWearTexture();
    PANEL = makePanelNormal();
    DECAL = makeDecalTexture();
  }
  const mk = (color, o) =>
    new THREE.MeshStandardMaterial(
      Object.assign(
        {
          color,
          map: WEAR,
          roughnessMap: WEAR,
          normalMap: PANEL,
          normalScale: new THREE.Vector2(0.55, 0.55),
          roughness: 0.72,
          metalness: 0.38,
          flatShading: true,
        },
        o || {},
      ),
    );
  const M = {
    main: mk(pal.main),
    main2: mk(palColor(pal, 'main2'), { roughness: 0.78 }),
    main3: mk(palColor(pal, 'main3'), { roughness: 0.7, metalness: 0.45 }),
    sub: mk(pal.sub, { metalness: 0.55, roughness: 0.5 }),
    acc: mk(pal.acc, { metalness: 0.3, normalScale: new THREE.Vector2(0.3, 0.3) }),
    joint: new THREE.MeshStandardMaterial({
      color: pal.joint,
      roughness: 0.55,
      metalness: 0.75,
      flatShading: true,
    }),
    gun: new THREE.MeshStandardMaterial({
      color: palColor(pal, 'gun'),
      roughness: 0.5,
      metalness: 0.7,
      flatShading: true,
      map: WEAR,
      normalMap: PANEL,
      normalScale: new THREE.Vector2(0.4, 0.4),
    }),
    grey: mk(palColor(pal, 'grey'), { roughness: 0.7, metalness: 0.35 }),
    visor: new THREE.MeshStandardMaterial({
      color: pal.visor,
      emissive: pal.visor,
      emissiveIntensity: 2.2,
      roughness: 0.3,
    }),
    lens: new THREE.MeshStandardMaterial({ color: 0x222a33, roughness: 0.15, metalness: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x1c1e21,
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,
    }),
  };
  for (const k in M) M[k].name = k; // 材質名稱＝配色槽位（匯出 GLB 範本時保留）
  return M;
}
export const PALETTES = {
  player: {
    main: 0x4b5a3f,
    main2: 0x2b3a5c,
    main3: 0x5d6c4d,
    sub: 0x1e2430,
    acc: 0xe0b23c,
    joint: 0x2a2d33,
    visor: 0xff3020,
    glow: 0x7fe8ff,
  },
  enemy: {
    main: 0x8a8a76,
    main2: 0x6c6b5a,
    main3: 0x9c9d88,
    sub: 0x3b3c36,
    acc: 0xc26a2d,
    joint: 0x2a2c2c,
    visor: 0xff5040,
    glow: 0xffa050,
  },
  longshot: {
    main: 0x3a3d44,
    main2: 0x2a2c32,
    main3: 0x4a4e58,
    sub: 0x1b1c20,
    acc: 0xd83030,
    joint: 0x232426,
    visor: 0xff2020,
    glow: 0xff5050,
  },
  berserker: {
    main: 0x8a1a22,
    main2: 0x5e1016,
    main3: 0xa4262f,
    sub: 0x1a1214,
    acc: 0xf0d040,
    joint: 0x201c1c,
    visor: 0xffd040,
    glow: 0xff6030,
  },
  rain: {
    main: 0xe4e6ea,
    main2: 0xbfc4cc,
    main3: 0xf4f5f7,
    sub: 0x2b3a52,
    acc: 0x2f7bd9,
    joint: 0x2a2d33,
    visor: 0x50c0ff,
    glow: 0x8fd8ff,
  },
  bastion: {
    main: 0x5a6238,
    main2: 0x444b2a,
    main3: 0x6c7546,
    sub: 0x2a2d20,
    acc: 0xe87a20,
    joint: 0x232522,
    visor: 0xffa040,
    glow: 0xffa050,
  },
  duelist: {
    main: 0x4a2d7a,
    main2: 0x35205a,
    main3: 0x5d3d96,
    sub: 0x1c1626,
    acc: 0xc8ccd6,
    joint: 0x26242c,
    visor: 0xd070ff,
    glow: 0xe090ff,
  },
  gravel: {
    main: 0x6b5a3a,
    main2: 0x4a3f2a,
    main3: 0x84704a,
    sub: 0x2a241c,
    acc: 0xe0c060,
    joint: 0x232222,
    visor: 0xffa040,
    glow: 0xffb060,
  },
  nightfall: {
    main: 0x1f2a44,
    main2: 0x152036,
    main3: 0x2c3b5c,
    sub: 0x0f1420,
    acc: 0x60d0ff,
    joint: 0x1c2028,
    visor: 0x80e0ff,
    glow: 0x90e8ff,
  },
  hornet: {
    main: 0xd8b020,
    main2: 0x2a2622,
    main3: 0xf0c830,
    sub: 0x1c1a16,
    acc: 0x202020,
    joint: 0x26241f,
    visor: 0xff8020,
    glow: 0xffc040,
  },
  // 主題專屬敵人與專屬 AC（data/foes.js）
  scav: {
    main: 0x7a5a3e,
    main2: 0x5a4434,
    main3: 0x8c7050,
    sub: 0x3a2e26,
    acc: 0xc8702a,
    joint: 0x2a2420,
    visor: 0xffb060,
    glow: 0xffa050,
  },
  rust: {
    main: 0x8a4a2a,
    main2: 0x5e3420,
    main3: 0x9c6a44,
    sub: 0x3a2a22,
    acc: 0xd8c070,
    joint: 0x2a2220,
    visor: 0xff8040,
    glow: 0xff7a30,
  },
  yard: {
    main: 0xd8a020,
    main2: 0x3a3e44,
    main3: 0xe8c050,
    sub: 0x2a2c30,
    acc: 0x2b4fb0,
    joint: 0x26282c,
    visor: 0xffb040,
    glow: 0xffc060,
  },
  orbitbot: {
    main: 0xe6e8ea,
    main2: 0xd8a020,
    main3: 0xffffff,
    sub: 0x2a2e34,
    acc: 0x1d3a6a,
    joint: 0x262a30,
    visor: 0x9fe8ff,
    glow: 0x9fe8ff,
  },
  zenith: {
    main: 0xf0f2f6,
    main2: 0x2a4a7a,
    main3: 0xffffff,
    sub: 0x1a1e24,
    acc: 0xffd060,
    joint: 0x22262c,
    visor: 0x9fe8ff,
    glow: 0x9fe8ff,
  },
  xylemdrone: {
    main: 0xd8dce0,
    main2: 0x5aa0d0,
    main3: 0xf0f4f8,
    sub: 0x2a3038,
    acc: 0x3a7ab0,
    joint: 0x262c34,
    visor: 0x60e0ff,
    glow: 0x60e0ff,
  },
  undertow: {
    main: 0x2a4a66,
    main2: 0x1a2a3a,
    main3: 0x4a7a9a,
    sub: 0x121a22,
    acc: 0x40c0e0,
    joint: 0x1a2028,
    visor: 0x60e0ff,
    glow: 0x60e0ff,
  },
  crawler: {
    main: 0x5a524a,
    main2: 0x3a342e,
    main3: 0x8a7a68,
    sub: 0x221e1a,
    acc: 0xd06a20,
    joint: 0x2a2620,
    visor: 0xffa040,
    glow: 0xffa040,
  },
  spire: {
    main: 0x7a6a5a,
    main2: 0x3e342c,
    main3: 0xb0a090,
    sub: 0x1e1a16,
    acc: 0xe0b040,
    joint: 0x2a2620,
    visor: 0xffd060,
    glow: 0xffd060,
  },
  spacemt: {
    main: 0xd8d8d0,
    main2: 0x8a8c90,
    main3: 0xf0f0e8,
    sub: 0x2e3034,
    acc: 0xd85a20,
    joint: 0x2a2c30,
    visor: 0x60c0ff,
    glow: 0x60c0ff,
  },
  countdown: {
    main: 0xe8e4dc,
    main2: 0xb04a2a,
    main3: 0xffffff,
    sub: 0x24262a,
    acc: 0xff6a20,
    joint: 0x2a2c30,
    visor: 0xff3020,
    glow: 0xff6a20,
  },
  specimen: {
    main: 0x8a3a3e,
    main2: 0x4a2226,
    main3: 0xc8686a,
    sub: 0x241416,
    acc: 0xff3a30,
    joint: 0x2a1a1c,
    visor: 0xff5040,
    glow: 0xff3a30,
  },
  snowcamo: {
    main: 0xd8dee4,
    main2: 0x8a96a2,
    main3: 0xeef2f6,
    sub: 0x3a4048,
    acc: 0xc8322a,
    joint: 0x2a3038,
    visor: 0xff6040,
    glow: 0xffa060,
  },
  whiteout: {
    main: 0xe8eef4,
    main2: 0xa8b4c0,
    main3: 0xffffff,
    sub: 0x2e343c,
    acc: 0x7fb8e8,
    joint: 0x262c34,
    visor: 0x9fd8ff,
    glow: 0x9fd8ff,
  },
  toxic: {
    main: 0x5a6a3a,
    main2: 0x3a4228,
    main3: 0x8a9a4a,
    sub: 0x22281a,
    acc: 0xb0d030,
    joint: 0x242a1e,
    visor: 0x9aff40,
    glow: 0x9aff40,
  },
  marsh: {
    main: 0x3e5a52,
    main2: 0x24342e,
    main3: 0x6a8a7a,
    sub: 0x18201c,
    acc: 0x40d0a0,
    joint: 0x1e2622,
    visor: 0x40ffc0,
    glow: 0x40ffc0,
  },
  sluice: {
    main: 0x5a6a74,
    main2: 0x2e3a42,
    main3: 0x8a9aa4,
    sub: 0x1c2228,
    acc: 0x40a0d8,
    joint: 0x22282e,
    visor: 0x60c8ff,
    glow: 0x60c8ff,
  },
  stevedore: {
    main: 0xc89a2a,
    main2: 0x2e3034,
    main3: 0xe0c060,
    sub: 0x1e2024,
    acc: 0xd04020,
    joint: 0x22242a,
    visor: 0xff8a20,
    glow: 0xffa030,
  },
  sirocco: {
    main: 0xd8c09a,
    main2: 0x9c7c50,
    main3: 0xe8d4b0,
    sub: 0x3a3028,
    acc: 0xc83a2a,
    joint: 0x2a2620,
    visor: 0xff5040,
    glow: 0xff5a40,
  },
  prospector: {
    main: 0xb89838,
    main2: 0x6e5c28,
    main3: 0xc8aa50,
    sub: 0x2c2a24,
    acc: 0x3a3a3a,
    joint: 0x24221e,
    visor: 0x60e0ff,
    glow: 0x60d0ff,
  },
  piledriver: {
    main: 0x7a7a7a,
    main2: 0x5a5a5a,
    main3: 0x909090,
    sub: 0x262626,
    acc: 0xff5020,
    joint: 0x202020,
    visor: 0xff3020,
    glow: 0xff7040,
  },
  volker: {
    main: 0x3f4a3a,
    main2: 0x2c3428,
    main3: 0x52604a,
    sub: 0x1e221c,
    acc: 0xc8c0a0,
    joint: 0x232522,
    visor: 0xffb040,
    glow: 0xffb060,
  },
  helios: {
    main: 0x3a3f47,
    main2: 0x2b2f36,
    main3: 0x4a5058,
    sub: 0x1c1e22,
    acc: 0xff6a2a,
    joint: 0x232426,
    visor: 0xff3020,
    glow: 0xff6040,
  },
  vehicle: {
    main: 0x6b6f5a,
    main2: 0x565a48,
    main3: 0x7d8169,
    sub: 0x2c2e26,
    acc: 0xc9a03a,
    joint: 0x232522,
    visor: 0xff5040,
    glow: 0xffb060,
  },
  kami: {
    main: 0xb03a2a,
    main2: 0x8a2a1e,
    main3: 0xc8503c,
    sub: 0x2a1a18,
    acc: 0xffd040,
    joint: 0x232222,
    visor: 0xffff60,
    glow: 0xff8030,
  },
  ac: {
    main: 0x6f6a60,
    main2: 0x55514a,
    main3: 0x84806f,
    sub: 0x2b2926,
    acc: 0xd9b25c,
    joint: 0x262828,
    visor: 0xff8040,
    glow: 0xffc060,
  },
  mt: {
    main: 0x9ea08c,
    main2: 0x7f8270,
    main3: 0xb0b29c,
    sub: 0x43463f,
    acc: 0xd8a437,
    joint: 0x2a2c2a,
    visor: 0xff6040,
    glow: 0xffb060,
  },
  p3: {
    main: 0x9a5a2a,
    main2: 0x7a4520,
    main3: 0xb56c34,
    sub: 0x2a1e18,
    acc: 0xffd070,
    joint: 0x2a2626,
    visor: 0xffb060,
    glow: 0xffc080,
  },
  p4: {
    main: 0x5a3a8a,
    main2: 0x452c6a,
    main3: 0x6f4aa6,
    sub: 0x1e1826,
    acc: 0xd0c0ff,
    joint: 0x26242c,
    visor: 0xd070ff,
    glow: 0xe0a0ff,
  },
  ally: {
    main: 0x3f7f5a,
    main2: 0x2e5f44,
    main3: 0x4f966a,
    sub: 0x1c2620,
    acc: 0xe8d08a,
    joint: 0x262a28,
    visor: 0x80ffb0,
    glow: 0x9fffc8,
  },
  boss: {
    main: 0x4a2a2e,
    main2: 0x321c20,
    main3: 0x5e3238,
    sub: 0x1c1416,
    acc: 0xff6a2a,
    joint: 0x201c1c,
    visor: 0xff3020,
    glow: 0xff6040,
  },
  heavy: {
    main: 0x4d5b4a,
    main2: 0x3a4638,
    main3: 0x5f6d5b,
    sub: 0x252a24,
    acc: 0xe86a1e,
    joint: 0x222522,
    visor: 0xffb040,
    glow: 0xffa050,
  },
  // 支援型敵人（修理無人機、護盾產生器）：淺灰＋綠
  support: {
    main: 0xb4b8b0,
    main2: 0x8e948c,
    main3: 0xc8ccc2,
    sub: 0x3a403a,
    acc: 0x3ccf6a,
    joint: 0x2a2e2a,
    visor: 0x60ff9a,
    glow: 0x7dffb0,
  },
  // 鑽地蟲：沙土色＋橘色感測器
  worm: {
    main: 0x8a7458,
    main2: 0x5e4c38,
    main3: 0x9e8668,
    sub: 0x2e261e,
    acc: 0xc8743a,
    joint: 0x2a241e,
    visor: 0xff8a2a,
    glow: 0xffa050,
  },
  // 電磁狩獵機：黑＋電藍
  hunter: {
    main: 0x24282e,
    main2: 0x181b20,
    main3: 0x343a42,
    sub: 0x0e1014,
    acc: 0x3aa8ff,
    joint: 0x1a1c20,
    visor: 0x60c8ff,
    glow: 0x7fd8ff,
  },
  // 指揮官 MT：深藍＋金
  command: {
    main: 0x2c3448,
    main2: 0x1e2434,
    main3: 0x3c4660,
    sub: 0x15181f,
    acc: 0xf0c040,
    joint: 0x1c1e24,
    visor: 0xffd060,
    glow: 0xffc860,
  },
  // 複製 AC：鏡面般的銀灰（適應裝甲依傷害類型發出不同顏色的光）
  mirror: {
    main: 0x9aa0aa,
    main2: 0x6c727c,
    main3: 0xb4bac4,
    sub: 0x2a2e34,
    acc: 0xe8eef8,
    joint: 0x24272c,
    visor: 0xffffff,
    glow: 0xd8e8ff,
  },
  // 光學迷彩電戰機：暗紫＋青
  phantom: {
    main: 0x3a3448,
    main2: 0x282334,
    main3: 0x4a4460,
    sub: 0x15131c,
    acc: 0x40f0e0,
    joint: 0x1c1a22,
    visor: 0x60fff0,
    glow: 0x80fff0,
  },
  // 浮游砲指揮機：白＋金
  seraph: {
    main: 0xd8d4c8,
    main2: 0xb0aca0,
    main3: 0xe8e4d8,
    sub: 0x3a3830,
    acc: 0xf0b030,
    joint: 0x2c2a26,
    visor: 0x60d0ff,
    glow: 0xffd070,
  },
  // 三機合體：紅＋黑
  trinity: {
    main: 0x9a2a24,
    main2: 0x2a2a2e,
    main3: 0xb83a30,
    sub: 0x18181a,
    acc: 0xf0d040,
    joint: 0x202022,
    visor: 0x60ff80,
    glow: 0xff7040,
  },
  // 高速突擊機：灰藍迷彩
  viper: {
    main: 0x5a6878,
    main2: 0x3e4a58,
    main3: 0x6e7e90,
    sub: 0x1e242c,
    acc: 0xff4030,
    joint: 0x22262c,
    visor: 0xffa040,
    glow: 0xffa060,
  },
  // 脈衝刃翼：深紅＋珊瑚色光
  ibis: {
    main: 0x5a1c28,
    main2: 0x3a121a,
    main3: 0x702634,
    sub: 0x140a0e,
    acc: 0xff5070,
    joint: 0x1c1014,
    visor: 0xff3060,
    glow: 0xff6080,
  },
  // 熔爐清掃機：鏽蝕的黃黑工程色
  furnace: {
    main: 0x8a6a2a,
    main2: 0x5a4420,
    main3: 0xa07e34,
    sub: 0x241c14,
    acc: 0x1e1e1e,
    joint: 0x2a221a,
    visor: 0xff6a20,
    glow: 0xff8a30,
  },
};
