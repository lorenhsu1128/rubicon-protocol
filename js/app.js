// 介面、相機、輸入與匯出。繪圖運算在 paint-core.js。
(function () {
  'use strict';
  const RP = window.RP;
  const $ = (id) => document.getElementById(id);

  // ---------- 狀態 ----------
  const S = {
    tool: 'pen',
    size: 24,
    opacity: 1,
    hardness: 0.6,
    spacing: 0.12,
    smooth: 0.3,
    pSize: true,
    pOpacity: false,
    color: '#d23c3c',
    backfaces: false,
    sym: false,
    wire: false,
    uvLines: true,
    altPick: false,
    current: null, // 目前的貼圖組（UV 面板、匯出 PNG）
    fileName: 'model',
  };

  // ---------- three.js ----------
  const canvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0x4a4a50, 1);
  if (!renderer.capabilities.isWebGL2) setStatus('這個瀏覽器不支援 WebGL2，可能無法正常繪圖', true);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x4a4a50);
  const persp = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  persp.position.set(0, 2, 8);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  let camera = persp;
  scene.add(persp, ortho);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555560, 0.75));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.65);
  keyLight.position.set(0.4, 0.8, 1);
  persp.add(keyLight);
  const keyLight2 = keyLight.clone();
  ortho.add(keyLight2);
  const grid = new THREE.GridHelper(10, 20, 0x666670, 0x56565c);
  scene.add(grid);
  const wireGroup = new THREE.Group();
  wireGroup.visible = false;
  scene.add(wireGroup);

  const view3d = $('view3d');
  const controls = new THREE.OrbitControls(persp, view3d);
  controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  controls.zoomSpeed = 1.2;

  const painter = new RP.Painter(renderer);
  let model = null;
  let modelBox = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  let modelSize = 2;

  // ---------- UV 面板 ----------
  const viewUV = $('viewUV');
  const uvScene = new THREE.Scene();
  uvScene.background = new THREE.Color(0x303034);
  const uvCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  const uvGroup = new THREE.Group();
  uvScene.add(uvGroup);
  const checker = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#8a8a90';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#6e6e74';
    g.fillRect(0, 0, 8, 8);
    g.fillRect(8, 8, 8, 8);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(32, 32);
    t.magFilter = THREE.NearestFilter;
    return t;
  })();
  const uvBg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0), new THREE.MeshBasicMaterial({ map: checker }));
  const uvQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0.01),
    new THREE.MeshBasicMaterial({ transparent: true }),
  );
  // PlaneGeometry 的 uv 是左下 (0,0)；面板以 v 往上顯示，和 UV 座標一致
  uvGroup.add(uvBg, uvQuad);
  const uvLineMat = new THREE.LineBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.45 });
  const uvLinesCache = new Map();
  const uvState = { cx: 0.5, cy: 0.5, zoom: 1 };

  function uvLinesFor(set) {
    if (uvLinesCache.has(set)) return uvLinesCache.get(set);
    let obj = null;
    if (set.triCount <= 400000) {
      const pos = new Float32Array(set.triCount * 18);
      let o = 0;
      for (const p of set.parts) {
        const g = p.mesh.geometry;
        const uv = g.attributes.uv;
        const idx = g.index;
        for (let i = p.start; i + 2 < p.start + p.count; i += 3) {
          const a = idx ? idx.getX(i) : i;
          const b = idx ? idx.getX(i + 1) : i + 1;
          const c = idx ? idx.getX(i + 2) : i + 2;
          for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
          ]) {
            pos[o++] = uv.getX(u);
            pos[o++] = uv.getY(u);
            pos[o++] = 0.02;
            pos[o++] = uv.getX(v);
            pos[o++] = uv.getY(v);
            pos[o++] = 0.02;
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, o), 3));
      obj = new THREE.LineSegments(g, uvLineMat);
      obj.frustumCulled = false;
    }
    uvLinesCache.set(set, obj);
    return obj;
  }

  function showSet(set) {
    S.current = set;
    for (const c of [...uvGroup.children]) if (c.isLineSegments) uvGroup.remove(c);
    if (!set) {
      uvQuad.material.map = null;
      uvQuad.material.needsUpdate = true;
      $('uvInfo').textContent = '';
      return;
    }
    uvQuad.material.map = set.comp.texture;
    uvQuad.material.needsUpdate = true;
    uvGroup.scale.x = set.w / set.h;
    const lines = uvLinesFor(set);
    if (lines) {
      lines.visible = S.uvLines;
      uvGroup.add(lines);
    }
    $('uvInfo').textContent = `${set.w}×${set.h}・${set.triCount.toLocaleString()} 面${lines ? '' : '（面數太多，不畫 UV 線）'}`;
    $('uvSet').value = String(set.id);
    for (const b of $('setList').children) b.classList.toggle('on', b.dataset.id === String(set.id));
  }

  function fitUV() {
    const r = viewUV.getBoundingClientRect();
    const aspect = S.current ? S.current.w / S.current.h : 1;
    const availH = Math.max(10, r.height - 40);
    const k = Math.min(r.width / aspect, availH) * 0.92;
    uvState.zoom = k / r.height; // 1 個 UV 單位佔面板高度的比例
    uvState.cx = aspect / 2;
    uvState.cy = 0.5 + 16 / k; // 讓出標題列
  }

  function updateUVCam(w, h) {
    const halfH = 0.5 / uvState.zoom;
    const halfW = halfH * (w / h);
    uvCam.left = uvState.cx - halfW;
    uvCam.right = uvState.cx + halfW;
    uvCam.top = uvState.cy + halfH;
    uvCam.bottom = uvState.cy - halfH;
    uvCam.updateProjectionMatrix();
  }

  // ---------- 載入 ----------
  const loader = new THREE.GLTFLoader();

  function loadArrayBuffer(buf, name) {
    setStatus('讀取中…');
    loader.parse(
      buf,
      '',
      (gltf) => {
        S.fileName = name.replace(/\.glb$/i, '');
        setModel(gltf.scene);
      },
      (err) => {
        const msg = String((err && err.message) || err);
        setStatus(/draco/i.test(msg) ? '這個 GLB 用了 Draco 壓縮，驗證版還不支援（請輸出未壓縮的 GLB）' : '讀取失敗：' + msg, true);
      },
    );
  }

  function setModel(root) {
    if (model) {
      scene.remove(model);
      model.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
    }
    for (const c of [...wireGroup.children]) {
      wireGroup.remove(c);
      c.geometry.dispose();
    }
    uvLinesCache.clear();
    model = root;
    scene.add(model);
    model.updateMatrixWorld(true);
    modelBox = new THREE.Box3().setFromObject(model);
    modelSize = modelBox.getSize(new THREE.Vector3()).length() || 1;
    grid.position.y = modelBox.min.y;
    grid.scale.setScalar(Math.max(0.2, modelSize / 6));
    persp.near = ortho.near = modelSize * 0.005;
    persp.far = ortho.far = modelSize * 50;
    persp.updateProjectionMatrix();
    const warnings = painter.build(model, { defaultSize: 1024 });
    buildSetList();
    showSet(painter.sets[0] || null);
    fitUV();
    setView('front');
    fitView();
    const sets = painter.sets.length;
    if (!sets) setStatus('沒有可以畫的網格（需要有 UV）', true);
    else if (warnings.length) setStatus(`載入「${S.fileName}」：${sets} 組貼圖。注意：${warnings.slice(0, 3).join('；')}`, true);
    else setStatus(`載入「${S.fileName}」：${sets} 組貼圖。`);
  }

  function buildSetList() {
    const list = $('setList');
    const sel = $('uvSet');
    list.innerHTML = '';
    sel.innerHTML = '';
    for (const s of painter.sets) {
      const b = document.createElement('button');
      b.textContent = s.name;
      b.dataset.id = String(s.id);
      b.title = `${s.w}×${s.h}`;
      b.onclick = () => showSet(s);
      list.appendChild(b);
      const o = document.createElement('option');
      o.value = String(s.id);
      o.textContent = s.name;
      sel.appendChild(o);
    }
  }

  function buildWire() {
    if (!model || wireGroup.children.length) return;
    const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthTest: true });
    model.traverse((o) => {
      if (!o.isMesh) return;
      const w = new THREE.LineSegments(new THREE.WireframeGeometry(o.geometry), mat);
      w.matrixAutoUpdate = false;
      w.matrix.copy(o.matrixWorld);
      wireGroup.add(w);
    });
  }

  // ---------- 相機 ----------
  function setView(name) {
    const t = controls.target;
    const d = camera.position.distanceTo(t) || modelSize * 1.5;
    const dirs = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      left: [-1, 0, 0],
      right: [1, 0, 0],
      top: [0, 1, 0.0001],
    };
    const v = dirs[name];
    if (!v) return;
    camera.position.set(t.x + v[0] * d, t.y + v[1] * d, t.z + v[2] * d);
    camera.lookAt(t);
    controls.update();
  }

  function fitView() {
    const c = modelBox.getCenter(new THREE.Vector3());
    const r = modelSize / 2;
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (!isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0, 0, 1);
    controls.target.copy(c);
    const dist = r / Math.sin(THREE.MathUtils.degToRad(persp.fov) / 2);
    camera.position.copy(c).addScaledVector(dir, dist * 1.05);
    if (camera.isOrthographicCamera) {
      camera.zoom = 1;
      orthoHalf = r * 1.1;
    }
    camera.lookAt(c);
    controls.update();
  }

  let orthoHalf = 1;
  function togglePersp() {
    const from = camera;
    const to = camera === persp ? ortho : persp;
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    if (to === ortho) {
      const d = persp.position.distanceTo(controls.target);
      orthoHalf = d * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2);
      ortho.zoom = 1;
    } else {
      const d = orthoHalf / ortho.zoom / Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2);
      const dir = ortho.position.clone().sub(controls.target).normalize();
      persp.position.copy(controls.target).addScaledVector(dir, d);
    }
    camera = to;
    controls.object = to;
    controls.update();
    $('btnPersp').textContent = camera === persp ? '透視' : '平行';
  }

  // ---------- 畫面更新 ----------
  function rectIn(el, stageRect) {
    const r = el.getBoundingClientRect();
    return { x: r.left - stageRect.left, y: r.top - stageRect.top, w: r.width, h: r.height };
  }

  let pendingDabs = [];
  function frame() {
    requestAnimationFrame(frame);
    const stage = $('stage');
    const sr = stage.getBoundingClientRect();
    const W = Math.round(sr.width);
    const H = Math.round(sr.height);
    if (canvas.width !== Math.round(W * renderer.getPixelRatio()) || canvas.height !== Math.round(H * renderer.getPixelRatio()))
      renderer.setSize(W, H, false);

    if (pendingDabs.length) {
      painter.paintDabs(pendingDabs);
      pendingDabs = [];
    }
    updateDecal();
    painter.composite();

    renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    const r3 = rectIn(view3d, sr);
    if (r3.w > 0 && r3.h > 0) {
      const aspect = r3.w / r3.h;
      persp.aspect = aspect;
      persp.updateProjectionMatrix();
      ortho.left = -orthoHalf * aspect;
      ortho.right = orthoHalf * aspect;
      ortho.top = orthoHalf;
      ortho.bottom = -orthoHalf;
      ortho.updateProjectionMatrix();
      renderer.setViewport(r3.x, H - r3.y - r3.h, r3.w, r3.h);
      renderer.setScissor(r3.x, H - r3.y - r3.h, r3.w, r3.h);
      renderer.render(scene, camera);
    }
    if (!document.body.classList.contains('noUV')) {
      const ru = rectIn(viewUV, sr);
      if (ru.w > 0 && ru.h > 0) {
        updateUVCam(ru.w, ru.h);
        renderer.setViewport(ru.x, H - ru.y - ru.h, ru.w, ru.h);
        renderer.setScissor(ru.x, H - ru.y - ru.h, ru.w, ru.h);
        renderer.render(uvScene, uvCam);
      }
    }
    renderer.setScissorTest(false);
  }

  // ---------- 繪圖輸入 ----------
  let stroke = null;
  const cursor = $('cursor');

  function brushRadius(p) {
    return (S.size / 2) * (S.pSize ? 0.15 + 0.85 * p : 1);
  }

  function modelCenterX() {
    return (modelBox.min.x + modelBox.max.x) / 2;
  }

  function placeDab(x, y, p) {
    const r = brushRadius(p);
    const a = S.pOpacity ? Math.max(0.02, p) : 1;
    const h = stroke.h;
    let hit = null;
    if (S.backfaces || S.sym) hit = painter.pickWorld(x, y);
    if (S.backfaces) {
      if (hit) pendingDabs.push({ type: 'w', p: hit.p, r: r * hit.perPx, a });
    } else pendingDabs.push({ type: 's', x, y: h - y, r, a });
    if (S.sym && hit) {
      const m = hit.p.clone();
      m.x = 2 * modelCenterX() - m.x;
      if (Math.abs(m.x - hit.p.x) > 1e-6 || S.backfaces) pendingDabs.push({ type: 'w', p: m, r: r * hit.perPx, a });
    }
  }

  // 沿線段以間距放置筆刷點
  function segment(x1, y1, p1) {
    const st = stroke;
    const dx = x1 - st.lx;
    const dy = y1 - st.ly;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) {
      st.lp = p1;
      return;
    }
    let t = st.carry;
    while (t <= len) {
      const f = t / len;
      const p = st.lp + (p1 - st.lp) * f;
      placeDab(st.lx + dx * f, st.ly + dy * f, p);
      t += Math.max(0.5, brushRadius(p) * 2 * S.spacing);
    }
    st.carry = t - len;
    st.lx = x1;
    st.ly = y1;
    st.lp = p1;
  }

  function addInput(x, y, p) {
    const st = stroke;
    const k = S.smooth;
    st.sx += (x - st.sx) * (1 - k);
    st.sy += (y - st.sy) * (1 - k);
    st.tx = x;
    st.ty = y;
    st.tp = p;
    segment(st.sx, st.sy, p);
  }

  function pressureOf(e) {
    if (e.pointerType === 'pen') return e.pressure > 0 ? e.pressure : 0.5;
    return 1;
  }

  function localXY(e) {
    const r = view3d.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function currentTool() {
    return S.altPick ? 'picker' : S.tool;
  }

  view3d.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return; // 觸控交給 OrbitControls（旋轉、縮放、平移）
    if (e.target.closest('button, .corner')) return; // 疊在視窗上的按鈕
    const eraserButton = e.button === 5; // 筆的橡皮擦端
    if (e.button !== 0 && !eraserButton) return;
    if (!model || !painter.sets.length) return;
    const [x, y] = localXY(e);
    if (D.active) {
      decalPointerDown(e, x, y); // 貼圖片中：點選表面
      e.preventDefault();
      return;
    }
    if (currentTool() === 'picker' || e.altKey) {
      pickColorAt(x, y);
      return;
    }
    const r = view3d.getBoundingClientRect();
    camera.updateMatrixWorld();
    const tool = eraserButton ? 'eraser' : S.tool;
    painter.beginStroke(
      { camera, scene, w: r.width, h: r.height, hide: [grid, wireGroup], modelSize },
      {
        color: S.color,
        opacity: S.opacity,
        hardness: S.hardness,
        erase: tool === 'eraser',
        backfaces: S.backfaces,
      },
    );
    const p = pressureOf(e);
    stroke = { id: e.pointerId, h: r.height, lx: x, ly: y, lp: p, sx: x, sy: y, carry: 0, tx: x, ty: y, tp: p };
    placeDab(x, y, p);
    stroke.carry = Math.max(0.5, brushRadius(p) * 2 * S.spacing);
    view3d.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  view3d.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') {
      const [x, y] = localXY(e);
      const d = currentTool() === 'picker' || D.active ? 0 : S.size;
      view3d.style.cursor = D.active ? (D.dragging ? 'grabbing' : 'crosshair') : currentTool() === 'picker' ? 'crosshair' : 'none';
      cursor.style.display = d > 2 ? 'block' : 'none';
      cursor.style.left = x + 'px';
      cursor.style.top = y + 'px';
      cursor.style.width = cursor.style.height = d + 'px';
      cursor.style.borderStyle = S.backfaces ? 'dashed' : 'solid';
    }
    if (D.active) {
      const [x, y] = localXY(e);
      decalPointerMove(e, x, y);
      return;
    }
    if (!stroke || e.pointerId !== stroke.id) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) {
      const [x, y] = localXY(ev);
      addInput(x, y, pressureOf(ev));
    }
  });

  function endStroke(e) {
    if (!stroke || (e && e.pointerId !== stroke.id)) return;
    // 手震修正的延遲：收筆時補到最後的位置
    segment(stroke.tx, stroke.ty, stroke.tp);
    if (pendingDabs.length) {
      painter.paintDabs(pendingDabs);
      pendingDabs = [];
    }
    const touched = painter.stroke ? [...painter.stroke.touched] : [];
    painter.endStroke();
    stroke = null;
    if (touched.length && !touched.includes(S.current)) showSet(touched[0]);
    updateUndoButtons();
  }
  view3d.addEventListener('pointerup', endStroke);
  view3d.addEventListener('pointercancel', endStroke);
  view3d.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch' && !stroke) cursor.style.display = 'none';
  });
  view3d.addEventListener('contextmenu', (e) => e.preventDefault());

  const raycaster = new THREE.Raycaster();
  function pickColorAt(x, y) {
    const r = view3d.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1), camera);
    const hits = raycaster.intersectObject(model, true);
    for (const h of hits) {
      if (!h.uv || !h.object.isMesh) continue;
      const mats = h.object.material;
      const m = Array.isArray(mats) ? mats[h.face.materialIndex] : mats;
      const set = painter.matSet.get(m);
      if (!set) continue;
      const b = painter.pickColor(set, h.uv);
      setColor('#' + [b[0], b[1], b[2]].map((v) => v.toString(16).padStart(2, '0')).join(''));
      setStatus(`取色：${S.color}（${set.name}）`);
      return;
    }
  }

  // ---------- UV 面板操作 ----------
  const uvPtrs = new Map();
  let uvPinch = null;
  viewUV.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = viewUV.getBoundingClientRect();
    const before = uvAt(e.clientX - r.left, e.clientY - r.top, r);
    uvState.zoom *= Math.exp(-e.deltaY * 0.0015);
    uvState.zoom = Math.min(64, Math.max(0.1, uvState.zoom));
    const after = uvAt(e.clientX - r.left, e.clientY - r.top, r);
    uvState.cx += before.x - after.x;
    uvState.cy += before.y - after.y;
  }, { passive: false });
  function uvAt(x, y, r) {
    const halfH = 0.5 / uvState.zoom;
    return { x: uvState.cx + (x / r.height - (r.width / r.height) / 2) * 2 * halfH, y: uvState.cy - (y / r.height - 0.5) * 2 * halfH };
  }
  viewUV.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.uvHead')) return;
    viewUV.setPointerCapture(e.pointerId);
    uvPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (uvPtrs.size === 2) {
      const [a, b] = [...uvPtrs.values()];
      uvPinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: uvState.zoom };
    }
  });
  viewUV.addEventListener('pointermove', (e) => {
    const prev = uvPtrs.get(e.pointerId);
    if (!prev) return;
    const r = viewUV.getBoundingClientRect();
    const cur = { x: e.clientX, y: e.clientY };
    uvPtrs.set(e.pointerId, cur);
    if (uvPtrs.size === 2 && uvPinch) {
      const [a, b] = [...uvPtrs.values()];
      uvState.zoom = Math.min(64, Math.max(0.1, (uvPinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / uvPinch.d));
    }
    const k = 1 / (uvState.zoom * r.height) / uvPtrs.size;
    uvState.cx -= (cur.x - prev.x) * k;
    uvState.cy += (cur.y - prev.y) * k;
  });
  const uvUp = (e) => {
    uvPtrs.delete(e.pointerId);
    if (uvPtrs.size < 2) uvPinch = null;
  };
  viewUV.addEventListener('pointerup', uvUp);
  viewUV.addEventListener('pointercancel', uvUp);
  viewUV.addEventListener('contextmenu', (e) => e.preventDefault());

  // 分隔線
  $('splitter').addEventListener('pointerdown', (e) => {
    const sp = e.currentTarget;
    sp.setPointerCapture(e.pointerId);
    const stageR = $('stage').getBoundingClientRect();
    const move = (ev) => {
      const w = Math.min(stageR.width - 200, Math.max(160, stageR.right - ev.clientX));
      viewUV.style.width = w + 'px';
    };
    const up = () => {
      sp.removeEventListener('pointermove', move);
      sp.removeEventListener('pointerup', up);
    };
    sp.addEventListener('pointermove', move);
    sp.addEventListener('pointerup', up);
  });

  // ---------- 介面 ----------
  function setStatus(msg, warn) {
    const el = $('status');
    el.textContent = msg;
    el.classList.toggle('warn', !!warn);
  }

  function setTool(t) {
    S.tool = t;
    for (const b of document.querySelectorAll('.tool[data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
    view3d.style.cursor = t === 'picker' ? 'crosshair' : 'none';
  }
  for (const b of document.querySelectorAll('.tool[data-tool]')) b.onclick = () => setTool(b.dataset.tool);
  setTool('pen');

  function bindRange(id, out, apply) {
    const el = $(id);
    const o = out && $(out);
    const f = () => {
      apply(Number(el.value));
      if (o) o.textContent = el.value;
    };
    el.addEventListener('input', f);
    f();
  }
  function setSize(v) {
    S.size = Math.max(1, Math.min(400, Math.round(v)));
    $('size').value = S.size;
    $('sizeNum').value = S.size;
  }
  $('size').addEventListener('input', () => setSize(Number($('size').value)));
  $('sizeNum').addEventListener('change', () => setSize(Number($('sizeNum').value)));
  bindRange('opacity', 'opacityOut', (v) => (S.opacity = v / 100));
  bindRange('hardness', 'hardnessOut', (v) => (S.hardness = v / 100));
  bindRange('spacing', 'spacingOut', (v) => (S.spacing = v / 100));
  bindRange('smooth', 'smoothOut', (v) => (S.smooth = v / 100));
  $('pSize').onchange = (e) => (S.pSize = e.target.checked);
  $('pOpacity').onchange = (e) => (S.pOpacity = e.target.checked);

  const recent = [];
  const PRESETS = ['#000000', '#ffffff', '#7f7f7f', '#d23c3c', '#e6893a', '#e8d14a', '#4caf50', '#3a8de6', '#3a4fb0', '#8e4ac4', '#e66fa8', '#6b4a32', '#c9b38f', '#2e3b2e', '#b0b8c0', '#404850'];
  function renderSwatches() {
    const box = $('swatches');
    box.innerHTML = '';
    for (const c of [...recent, ...PRESETS.filter((p) => !recent.includes(p))].slice(0, 24)) {
      const d = document.createElement('div');
      d.style.background = c;
      d.title = c;
      d.onclick = () => setColor(c);
      box.appendChild(d);
    }
  }
  function setColor(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    S.color = hex.toLowerCase();
    $('color').value = S.color;
    $('hex').value = S.color;
  }
  function rememberColor() {
    const i = recent.indexOf(S.color);
    if (i >= 0) recent.splice(i, 1);
    recent.unshift(S.color);
    if (recent.length > 8) recent.pop();
    renderSwatches();
  }
  $('color').addEventListener('input', (e) => setColor(e.target.value));
  $('color').addEventListener('change', rememberColor);
  $('hex').addEventListener('change', (e) => {
    let v = e.target.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    setColor(v);
    rememberColor();
  });
  renderSwatches();

  function toggleBtn(id, key, after) {
    $(id).onclick = () => {
      S[key] = !S[key];
      $(id).classList.toggle('on', S[key]);
      if (after) after();
      D.dirty = true;
    };
  }
  toggleBtn('tgBack', 'backfaces');
  toggleBtn('tgSym', 'sym');
  toggleBtn('tgWire', 'wire', () => {
    buildWire();
    wireGroup.visible = S.wire;
  });
  toggleBtn('tgUvLines', 'uvLines', () => {
    for (const c of uvGroup.children) if (c.isLineSegments) c.visible = S.uvLines;
  });
  $('btnUvFit').onclick = fitUV;
  $('uvSet').onchange = (e) => showSet(painter.sets[Number(e.target.value)]);
  $('btnUvToggle').onclick = () => {
    document.body.classList.toggle('noUV');
    $('btnUvToggle').classList.toggle('on', !document.body.classList.contains('noUV'));
  };
  if (window.innerWidth < 760) $('btnUvToggle').click();

  for (const b of document.querySelectorAll('[data-view]'))
    b.onclick = () => {
      const v = b.dataset.view;
      if (v === 'fit') fitView();
      else if (v === 'persp') togglePersp();
      else setView(v);
    };

  function updateUndoButtons() {
    $('btnUndo').disabled = !painter.undoStack.length;
    $('btnRedo').disabled = !painter.redoStack.length;
  }
  $('btnUndo').onclick = () => {
    painter.undo();
    updateUndoButtons();
  };
  $('btnRedo').onclick = () => {
    painter.redo();
    updateUndoButtons();
  };
  $('btnClearLayer').onclick = () => {
    if (!S.current) return;
    painter.clearLayer(S.current);
    updateUndoButtons();
  };
  updateUndoButtons();

  // 開檔
  $('btnOpen').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => {
    const f = e.target.files[0];
    if (f) f.arrayBuffer().then((b) => loadArrayBuffer(b, f.name));
    e.target.value = '';
  };
  $('btnDemo').onclick = () => {
    S.fileName = 'demo_mech';
    setModel(RP.buildDemoMech());
  };
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('dragging');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const f = e.dataTransfer.files[0];
    if (f && /\.glb$/i.test(f.name)) f.arrayBuffer().then((b) => loadArrayBuffer(b, f.name));
    else if (f && /^image\//.test(f.type)) openImageFile(f);
    else if (f) setStatus('只支援 .glb 與圖片（PNG／JPG／WebP）', true);
  });

  // ---------- 貼上圖片 ----------
  // 像貼紙一樣：在模型上點一下就貼在那裡（沿表面法線投影，和視角無關），之後可以拖曳移動、
  // 調大小與角度；預覽寫在 stroke 緩衝，按確定才寫進圖層（可復原）。
  const D = {
    active: false,
    placed: false, // 點過之後固定，不再跟著滑鼠
    hasPoint: false,
    tex: null,
    img: null,
    P: new THREE.Vector3(),
    N: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0, 1, 0), // 圖片的「上」（世界座標，放置時取相機的上方）
    size: 0.2, // 寬度（世界長度）
    autoSize: true,
    rot: 0,
    flip: false,
    opacity: 1,
    dirty: false,
    hover: null, // 待處理的滑鼠位置（每個畫面最多做一次射線檢測）
    dragging: null,
  };
  const decalOutline = new THREE.LineLoop(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)),
    new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.85 }),
  );
  decalOutline.renderOrder = 10;
  decalOutline.frustumCulled = false;
  decalOutline.visible = false;
  scene.add(decalOutline);

  function openImageFile(f) {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      startDecal(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => setStatus('圖片讀取失敗', true);
    img.src = url;
  }

  function startDecal(img) {
    if (!model || !painter.sets.length) {
      setStatus('請先開啟模型', true);
      return;
    }
    if (stroke) return;
    if (D.active) cancelDecal();
    const tex = new THREE.Texture(img);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    Object.assign(D, { tex, img, active: true, placed: false, hasPoint: false, rot: 0, flip: false, hover: null, dragging: null });
    $('decalRot').value = 0;
    $('decalRotOut').textContent = '0';
    $('decalPanel').hidden = false;
    $('btnImage').classList.add('on');
    cursor.style.display = 'none';
    decalHint();
  }

  function decalHint() {
    $('decalHint').textContent = D.placed
      ? '在圖片上拖曳可以移動（沿著表面滑動），點別的地方會重新貼過去。[ ] 大小、, . 角度。'
      : '移動滑鼠預覽，在模型上點一下要貼的位置。';
    setStatus(D.placed ? '調整好後按「確定」（Enter），Esc 取消。' : '在模型上點一下要貼的位置（右鍵可以旋轉視角）。');
  }

  // 畫面座標 → 模型表面的點與法線（法線用頂點法線內插，曲面上拖曳時方向比較穩定）
  const _tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  function hitSurface(x, y) {
    const r = view3d.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1), camera);
    const hits = raycaster.intersectObject(model, true);
    for (const h of hits) {
      const o = h.object;
      if (!o.isMesh || !h.face || !o.visible) continue;
      const g = o.geometry;
      let n;
      const nor = g.attributes.normal;
      if (nor) {
        const pos = g.attributes.position;
        const { a, b, c } = h.face;
        _tri[0].fromBufferAttribute(pos, a);
        _tri[1].fromBufferAttribute(pos, b);
        _tri[2].fromBufferAttribute(pos, c);
        const lp = h.point.clone().applyMatrix4(o.matrixWorld.clone().invert());
        const bc = THREE.Triangle.getBarycoord(lp, _tri[0], _tri[1], _tri[2], new THREE.Vector3());
        n = new THREE.Vector3()
          .addScaledVector(new THREE.Vector3().fromBufferAttribute(nor, a), bc.x)
          .addScaledVector(new THREE.Vector3().fromBufferAttribute(nor, b), bc.y)
          .addScaledVector(new THREE.Vector3().fromBufferAttribute(nor, c), bc.z);
        if (n.lengthSq() < 1e-8) n.copy(h.face.normal);
      } else n = h.face.normal.clone();
      n.applyMatrix3(new THREE.Matrix3().getNormalMatrix(o.matrixWorld)).normalize();
      if (n.dot(raycaster.ray.direction) > 0) n.negate(); // 打到背面時翻成朝向相機
      return { p: h.point.clone(), n, dist: h.distance };
    }
    return null;
  }

  function cameraUp() {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  }

  function setDecalPoint(hit, keepUp) {
    D.P.copy(hit.p);
    D.N.copy(hit.n);
    if (!keepUp) D.up.copy(cameraUp());
    if (D.autoSize) {
      // 第一次：圖片寬度約為畫面高度的 25%
      const r = view3d.getBoundingClientRect();
      let perPx;
      if (camera.isOrthographicCamera) perPx = (camera.top - camera.bottom) / camera.zoom / r.height;
      else perPx = (2 * hit.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / camera.zoom / r.height;
      setDecalSize(((r.height * 0.25 * perPx) / modelSize) * 100);
      D.autoSize = false;
    }
    D.hasPoint = true;
    D.dirty = true;
  }

  function setDecalSize(pct) {
    pct = Math.min(100, Math.max(0.5, pct));
    D.size = (modelSize * pct) / 100;
    $('decalSize').value = pct;
    $('decalSizeOut').textContent = pct.toFixed(1);
    D.dirty = true;
  }
  function setDecalRot(deg) {
    deg = ((((deg + 180) % 360) + 360) % 360) - 180;
    D.rot = (-deg * Math.PI) / 180; // 介面上正值＝順時針
    $('decalRot').value = Math.round(deg);
    $('decalRotOut').textContent = Math.round(deg);
    D.dirty = true;
  }

  // 投影框：T 右、B 上（從外面看），再繞法線轉 rot
  function decalFrame() {
    const N = D.N;
    const B = D.up.clone().addScaledVector(N, -D.up.dot(N));
    if (B.lengthSq() < 1e-6) {
      // 圖片的上方和法線平行（例如從正上方看頂面）：改用相機前方
      const f = camera.getWorldDirection(new THREE.Vector3());
      B.copy(f).addScaledVector(N, -f.dot(N));
      if (B.lengthSq() < 1e-6) B.set(1, 0, 0).addScaledVector(N, -N.x);
    }
    B.normalize();
    const T = new THREE.Vector3().crossVectors(B, N).normalize();
    const c = Math.cos(D.rot);
    const s = Math.sin(D.rot);
    return {
      T: T.clone().multiplyScalar(c).addScaledVector(B, s),
      B: B.clone().multiplyScalar(c).addScaledVector(T, -s),
    };
  }

  function previewDecal() {
    D.dirty = false;
    if (!D.hasPoint) {
      painter.cancelStroke();
      decalOutline.visible = false;
      return;
    }
    const { T, B } = decalFrame();
    const w = D.size;
    const h = (D.size * D.img.height) / D.img.width;
    painter.previewImage(D.tex, {
      P: D.P,
      T,
      B,
      N: D.N,
      w,
      h,
      flip: D.flip,
      opacity: D.opacity,
      through: S.backfaces,
      graze: $('decalGraze').checked,
      sym: S.sym,
      mirrorX: modelCenterX(),
    });
    const pos = decalOutline.geometry.attributes.position;
    const base = D.P.clone().addScaledVector(D.N, modelSize * 0.002);
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].forEach(([sx, sy], i) => {
      const v = base.clone().addScaledVector(T, (sx * w) / 2).addScaledVector(B, (sy * h) / 2);
      pos.setXYZ(i, v.x, v.y, v.z);
    });
    pos.needsUpdate = true;
    decalOutline.visible = true;
  }

  // 每個畫面：處理滑鼠的射線檢測，有變動就重新貼
  function updateDecal() {
    if (!D.active) return;
    if (D.hover) {
      const hit = hitSurface(D.hover.x, D.hover.y);
      if (hit) setDecalPoint(hit, D.hover.keepUp);
      else if (!D.placed) {
        D.hasPoint = false;
        D.dirty = true;
      }
      D.hover = null;
    }
    if (D.dirty) previewDecal();
  }

  function decalPointerDown(e, x, y) {
    const hit = hitSurface(x, y);
    if (!hit) return;
    // 點在目前的圖片範圍內＝拖曳移動（保持方向）；點在別處＝重新貼在那裡
    let inside = false;
    if (D.placed && D.hasPoint) {
      const { T, B } = decalFrame();
      const d = hit.p.clone().sub(D.P);
      const h = (D.size * D.img.height) / D.img.width;
      inside = Math.abs(d.dot(T)) <= D.size / 2 && Math.abs(d.dot(B)) <= h / 2;
    }
    if (!inside) setDecalPoint(hit, D.placed);
    D.placed = true;
    D.dragging = { id: e.pointerId, dx: 0 };
    view3d.setPointerCapture(e.pointerId);
    decalHint();
  }

  function decalPointerMove(e, x, y) {
    if (D.dragging) {
      if (e.pointerId === D.dragging.id) D.hover = { x, y, keepUp: true };
    } else if (!D.placed && e.pointerType !== 'touch') D.hover = { x, y, keepUp: false };
  }

  function decalPointerUp(e) {
    if (D.dragging && e.pointerId === D.dragging.id) D.dragging = null;
  }
  view3d.addEventListener('pointerup', decalPointerUp);
  view3d.addEventListener('pointercancel', decalPointerUp);
  view3d.addEventListener('pointerleave', () => {
    if (D.active && !D.placed) {
      D.hasPoint = false;
      D.dirty = true;
    }
  });

  function endDecal() {
    D.active = false;
    D.dragging = null;
    decalOutline.visible = false;
    $('decalPanel').hidden = true;
    $('btnImage').classList.remove('on');
    if (D.tex) D.tex.dispose();
    D.tex = null;
  }
  function applyDecal() {
    if (!D.active) return;
    if (!D.hasPoint) {
      setStatus('請先在模型上點選要貼的位置', true);
      return;
    }
    previewDecal(); // 確保是最新的位置
    const touched = painter.stroke ? [...painter.stroke.touched] : [];
    painter.endStroke();
    endDecal();
    if (touched.length && !touched.includes(S.current)) showSet(touched[0]);
    updateUndoButtons();
    setStatus('已貼上圖片（Ctrl+Z 復原）');
  }
  function cancelDecal() {
    if (!D.active) return;
    painter.cancelStroke();
    endDecal();
    setStatus('已取消貼上圖片');
  }

  $('btnImage').onclick = () => $('imgInput').click();
  $('imgInput').onchange = (e) => {
    const f = e.target.files[0];
    if (f) openImageFile(f);
    e.target.value = '';
  };
  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.kind === 'file' && /^image\//.test(it.type)) {
        openImageFile(it.getAsFile());
        e.preventDefault();
        return;
      }
    }
  });
  $('decalSize').addEventListener('input', (e) => {
    D.autoSize = false;
    setDecalSize(Number(e.target.value));
  });
  $('decalRot').addEventListener('input', (e) => setDecalRot(Number(e.target.value)));
  bindRange('decalOpacity', 'decalOpacityOut', (v) => {
    D.opacity = v / 100;
    D.dirty = true;
  });
  $('decalGraze').onchange = () => (D.dirty = true);
  $('decalFlip').onclick = () => {
    D.flip = !D.flip;
    D.dirty = true;
  };
  $('decalUpright').onclick = () => {
    D.up.copy(cameraUp());
    setDecalRot(0);
  };
  $('decalOk').onclick = applyDecal;
  $('decalCancel').onclick = cancelDecal;

  // iPad 的 Apple Pencil 也會送 touch 事件：不讓 OrbitControls 把筆當成手指旋轉視角
  for (const type of ['touchstart', 'touchmove'])
    view3d.addEventListener(
      type,
      (e) => {
        for (const t of e.touches) if (t.touchType === 'stylus') return e.stopImmediatePropagation();
      },
      { capture: true },
    );

  // 匯出
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const safe = (s) => s.replace(/[\\/:*?"<>|]+/g, '_');
  function exportPng(set) {
    painter.toCanvas(set).toBlob((b) => download(b, `${safe(S.fileName)}_${safe(set.name)}.png`), 'image/png');
  }
  $('btnExportPng').onclick = () => S.current && exportPng(S.current);
  $('btnExportAll').onclick = () => painter.sets.forEach((s, i) => setTimeout(() => exportPng(s), i * 250));
  $('btnExportGlb').onclick = () => {
    if (!model) return;
    setStatus('匯出中…');
    const restore = [];
    for (const s of painter.sets) {
      const t = new THREE.CanvasTexture(painter.toCanvas(s));
      t.flipY = false;
      t.encoding = THREE.sRGBEncoding;
      t.format = THREE.RGBAFormat;
      if (s.srcMap) {
        t.wrapS = s.srcMap.wrapS;
        t.wrapT = s.srcMap.wrapT;
        t.name = s.srcMap.name;
      }
      for (const m of s.materials) {
        restore.push([m, m.map]);
        m.map = t;
      }
    }
    const done = (res) => {
      for (const [m, map] of restore) m.map = map;
      download(new Blob([res], { type: 'model/gltf-binary' }), `${safe(S.fileName)}_painted.glb`);
      setStatus('已匯出 GLB');
    };
    try {
      new THREE.GLTFExporter().parse(model, done, { binary: true, onlyVisible: true, maxTextureSize: 4096 });
    } catch (err) {
      for (const [m, map] of restore) m.map = map;
      setStatus('匯出失敗：' + err.message, true);
    }
  };

  // 鍵盤
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type=text], input[type=number]')) return;
    const k = e.key.toLowerCase();
    if (e.key === 'Alt') {
      e.preventDefault();
      S.altPick = true;
      view3d.style.cursor = 'crosshair';
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z' && !e.shiftKey) $('btnUndo').click();
      else if (k === 'y' || (k === 'z' && e.shiftKey)) $('btnRedo').click();
      else if (e.code === 'Numpad1') setView('back');
      else if (e.code === 'Numpad3') setView('left');
      else return;
      e.preventDefault();
      return;
    }
    if (D.active && e.key === 'Enter') applyDecal();
    else if (D.active && e.key === 'Escape') cancelDecal();
    else if (D.active && k === '[') setDecalSize(Number($('decalSize').value) / 1.1);
    else if (D.active && k === ']') setDecalSize(Number($('decalSize').value) * 1.1);
    else if (D.active && (k === ',' || k === '.' || k === '<' || k === '>'))
      setDecalRot(Number($('decalRot').value) + (k === ',' || k === '<' ? -1 : 1) * (e.shiftKey ? 15 : 5));
    else if (k === 'b') setTool('pen');
    else if (k === 'e') setTool('eraser');
    else if (k === 'i') setTool('picker');
    else if (k === '[') setSize(S.size / 1.15);
    else if (k === ']') setSize(S.size * 1.15);
    else if (k === 'f') fitView();
    else if (e.code === 'Numpad1') setView('front');
    else if (e.code === 'Numpad3') setView('right');
    else if (e.code === 'Numpad7') setView('top');
    else if (e.code === 'Numpad5') togglePersp();
    else return;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') {
      S.altPick = false;
      setTool(S.tool);
    }
  });
  window.addEventListener('blur', () => {
    S.altPick = false;
  });

  window.addEventListener('resize', fitUV);

  // 測試用
  window.__rp = { S, painter, get camera() { return camera; }, setModel, showSet, scene };

  requestAnimationFrame(frame);
})();
