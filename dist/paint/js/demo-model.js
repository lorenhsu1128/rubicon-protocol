// 範例模型：簡單的機甲形狀，每個部位一個材質與格子貼圖，UV 刻意有很多接縫（方塊 3×2 拼圖、圓柱側面與上下蓋分開）。
(function () {
  'use strict';
  const RP = (window.RP = window.RP || {});

  function gridTexture(hue, size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const n = 8;
    const cell = size / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        g.fillStyle = `hsl(${hue}, 18%, ${(x + y) % 2 ? 62 : 70}%)`;
        g.fillRect(x * cell, y * cell, cell, cell);
      }
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = Math.max(1, size / 512);
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * cell, 0);
      g.lineTo(i * cell, size);
      g.moveTo(0, i * cell);
      g.lineTo(size, i * cell);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.flipY = false; // 和 GLTFLoader 一致
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  // 方塊 6 個面排成 3×2
  function atlasBox(w, h, d) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    for (const gr of g.groups) {
      const col = gr.materialIndex % 3;
      const row = Math.floor(gr.materialIndex / 3);
      const seen = new Set();
      for (let i = gr.start; i < gr.start + gr.count; i++) {
        const vi = g.index.getX(i);
        if (seen.has(vi)) continue;
        seen.add(vi);
        const m = 0.02;
        uv.setXY(vi, (col + m + uv.getX(vi) * (1 - 2 * m)) / 3, (row + m + uv.getY(vi) * (1 - 2 * m)) / 2);
      }
    }
    g.clearGroups();
    return g;
  }

  // 圓柱：側面在上半、上下蓋在下半左右
  function atlasCylinder(rt, rb, h, seg) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1);
    const uv = g.attributes.uv;
    for (const gr of g.groups) {
      const seen = new Set();
      for (let i = gr.start; i < gr.start + gr.count; i++) {
        const vi = g.index.getX(i);
        if (seen.has(vi)) continue;
        seen.add(vi);
        const u = uv.getX(vi);
        const v = uv.getY(vi);
        if (gr.materialIndex === 0) uv.setXY(vi, 0.01 + u * 0.98, 0.51 + v * 0.48);
        else if (gr.materialIndex === 1) uv.setXY(vi, 0.01 + u * 0.48, 0.01 + v * 0.48);
        else uv.setXY(vi, 0.51 + u * 0.48, 0.01 + v * 0.48);
      }
    }
    g.clearGroups();
    return g;
  }

  function mat(name, hue) {
    return new THREE.MeshStandardMaterial({ name, map: gridTexture(hue, 1024), roughness: 0.6, metalness: 0.1 });
  }

  RP.buildDemoMech = function () {
    const root = new THREE.Group();
    root.name = 'demo_mech';
    const mBody = mat('core', 210);
    const mHead = mat('head', 30);
    const mArm = mat('arms', 120);
    const mLeg = mat('legs', 280);
    const add = (geo, m, x, y, z, name) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.name = name;
      root.add(o);
      return o;
    };
    add(atlasBox(1.2, 1.0, 0.8), mBody, 0, 2.2, 0, 'core');
    add(new THREE.SphereGeometry(0.32, 32, 20), mHead, 0, 3.0, 0.05, 'head');
    // 左右手臂共用一個材質，UV 重疊（常見的鏡像 UV 情況）
    add(atlasCylinder(0.18, 0.15, 1.1, 24), mArm, -0.85, 2.0, 0, 'arm_l').rotation.z = 0.15;
    add(atlasCylinder(0.18, 0.15, 1.1, 24), mArm, 0.85, 2.0, 0, 'arm_r').rotation.z = -0.15;
    // 兩條腿合在一個網格、不重疊的 UV（左腿 u 0–0.5、右腿 u 0.5–1）
    const legL = atlasCylinder(0.22, 0.18, 1.6, 24);
    const legR = atlasCylinder(0.22, 0.18, 1.6, 24);
    legL.translate(-0.35, 0.8, 0);
    legR.translate(0.35, 0.8, 0);
    const shift = (g, du) => {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + du);
    };
    shift(legL, 0);
    shift(legR, 0.5);
    const legs = mergeTwo(legL, legR);
    add(legs, mLeg, 0, 0, 0, 'legs');
    return root;
  };

  function mergeTwo(a, b) {
    const g = new THREE.BufferGeometry();
    const n = a.attributes.position.count;
    for (const k of ['position', 'normal', 'uv']) {
      const A = a.attributes[k];
      const B = b.attributes[k];
      const arr = new Float32Array((A.count + B.count) * A.itemSize);
      arr.set(A.array, 0);
      arr.set(B.array, A.array.length);
      g.setAttribute(k, new THREE.BufferAttribute(arr, A.itemSize));
    }
    const idx = [];
    for (let i = 0; i < a.index.count; i++) idx.push(a.index.getX(i));
    for (let i = 0; i < b.index.count; i++) idx.push(b.index.getX(i) + n);
    g.setIndex(idx);
    return g;
  }
})();
