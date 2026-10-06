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
    fillMode: 'island',
    preset: 'round',
    tip: 'round',
    grain: 'none',
    grainAmt: 0.5,
    scatter: 0,
    jitter: 0,
    rotRandom: false,
    rotFollow: false,
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
      renderLayers();
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
    renderLayers();
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

  // GLB 的 JSON 區塊有沒有用到 Draco 壓縮
  function glbUsesDraco(buf) {
    try {
      const dv = new DataView(buf);
      if (dv.getUint32(0, true) !== 0x46546c67) return false;
      const len = dv.getUint32(12, true);
      return new TextDecoder().decode(new Uint8Array(buf, 20, len)).includes('KHR_draco_mesh_compression');
    } catch (e) {
      return false;
    }
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('無法載入 ' + src));
      document.head.appendChild(s);
    });
  }
  // Draco 解碼器只在第一次遇到 Draco 壓縮的 GLB 時載入；解碼器原始碼包成字串（直接開檔時不能 fetch 本地檔案）
  let dracoReady = null;
  function ensureDraco() {
    if (!dracoReady)
      dracoReady = loadScript('lib/draco/draco_decoder.js')
        .then(() => loadScript('lib/three/DRACOLoader.js'))
        .then(() => {
          const d = new THREE.DRACOLoader();
          d.setDecoderConfig({ type: 'js' });
          d._loadLibrary = (url) =>
            url === 'draco_decoder.js' ? Promise.resolve(window.RP_DRACO_DECODER) : Promise.reject(new Error(url));
          loader.setDRACOLoader(d);
        })
        .catch((err) => {
          dracoReady = null;
          throw err;
        });
    return dracoReady;
  }

  function parseGLB(buf) {
    const parse = () =>
      new Promise((resolve, reject) =>
        loader.parse(buf, '', (gltf) => resolve(gltf.scene), (err) => reject(new Error(String((err && err.message) || err)))),
      );
    if (!glbUsesDraco(buf)) return parse();
    setStatus('讀取中（Draco 解壓縮）…');
    return ensureDraco().then(parse);
  }

  function loadArrayBuffer(buf, name) {
    setStatus('讀取中…');
    return parseGLB(buf).then(
      (root) => {
        S.fileName = name.replace(/\.glb$/i, '');
        S.sourceBuf = buf;
        setModel(root);
      },
      (err) => setStatus('讀取失敗：' + err.message, true),
    );
  }

  // 依副檔名開檔
  function openFile(f) {
    if (/\.glb$/i.test(f.name)) f.arrayBuffer().then((b) => loadArrayBuffer(b, f.name));
    else if (/\.rpaint$/i.test(f.name)) f.arrayBuffer().then((b) => openProject(b, f.name));
    else if (/^image\//.test(f.type)) openImageFile(f);
    else setStatus('只支援 .glb、.rpaint 與圖片（PNG／JPG／WebP）', true);
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
    renderObjects();
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
      w.userData.mesh = o;
      w.visible = o.visible;
      wireGroup.add(w);
    });
  }

  // ---------- 零件（網格）的顯示／隱藏：隱藏的零件不顯示、不擋住，也不會被畫到 ----------
  function meshes() {
    const out = [];
    if (model) model.traverse((o) => o.isMesh && out.push(o));
    return out;
  }
  function meshLabel(o, i) {
    return o.name || (o.parent && o.parent !== model && o.parent.name) || `網格 ${i + 1}`;
  }
  function setMeshVisible(o, v) {
    o.visible = v;
    for (const w of wireGroup.children) if (w.userData.mesh === o) w.visible = v;
    D.dirty = true;
  }
  function renderObjects() {
    const list = $('objList');
    list.innerHTML = '';
    meshes().forEach((o, i) => {
      const row = document.createElement('div');
      row.className = 'layerRow' + (o.visible ? '' : ' hidden');
      const eye = document.createElement('button');
      eye.className = 'eye' + (o.visible ? '' : ' off');
      eye.innerHTML = o.visible ? EYE_ON : EYE_OFF;
      eye.title = o.visible ? '隱藏' : '顯示';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = meshLabel(o, i);
      const toggle = () => {
        setMeshVisible(o, !o.visible);
        renderObjects();
      };
      eye.onclick = toggle;
      row.ondblclick = toggle;
      row.append(eye, name);
      list.appendChild(row);
    });
  }
  function showAllMeshes() {
    for (const o of meshes()) setMeshVisible(o, true);
    renderObjects();
  }
  let lastXY = null;
  function hideMeshUnderCursor() {
    if (!lastXY || !model) return;
    const r = view3d.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((lastXY[0] / r.width) * 2 - 1, -(lastXY[1] / r.height) * 2 + 1), camera);
    const h = raycaster.intersectObject(model, true).find((x) => x.object.isMesh && x.object.visible);
    if (!h) return;
    setMeshVisible(h.object, false);
    renderObjects();
    setStatus(`已隱藏「${h.object.name || '網格'}」（Alt+H 全部顯示）`);
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
    const vfov = THREE.MathUtils.degToRad(persp.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.2, persp.aspect));
    const dist = r / Math.sin(Math.min(vfov, hfov) / 2);
    if (camera.isOrthographicCamera) orthoHalf = (r * 1.1) / Math.min(1, persp.aspect);
    camera.position.copy(c).addScaledVector(dir, dist * 1.05);
    if (camera.isOrthographicCamera) camera.zoom = 1;
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

  // 散佈、大小抖動、角度（dir：筆畫方向，左下原點的弧度）
  function dabVariant(x, y, p, dir) {
    const r0 = brushRadius(p);
    let r = r0;
    if (S.jitter) r *= 1 - S.jitter * Math.random();
    if (S.scatter) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * S.scatter * r0 * 2;
      x += Math.cos(a) * d;
      y += Math.sin(a) * d;
    }
    const rot = S.rotRandom ? Math.random() * Math.PI * 2 : S.rotFollow ? dir || 0 : 0;
    return { x, y, r, rot };
  }

  function brushTextures() {
    return { tip: RP.tipTexture(S.tip), grain: RP.grainTexture(S.grain), grainAmt: S.grainAmt, grainScale: 8 };
  }

  function placeDab(x0, y0, p, dir) {
    const { x, y, r, rot } = dabVariant(x0, y0, p, dir);
    const a = S.pOpacity ? Math.max(0.02, p) : 1;
    const h = stroke.h;
    let hit = null;
    if (S.backfaces || S.sym) hit = painter.pickWorld(x, y);
    if (S.backfaces) {
      if (hit) pendingDabs.push({ type: 'w', p: hit.p, r: r * hit.perPx, a });
    } else pendingDabs.push({ type: 's', x, y: h - y, r, a, rot });
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
    const dir = Math.atan2(-dy, dx);
    while (t <= len) {
      const f = t / len;
      const p = st.lp + (p1 - st.lp) * f;
      placeDab(st.lx + dx * f, st.ly + dy * f, p, dir);
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
    if (S.current && !S.current.activeLayer.visible) {
      setStatus('目前的圖層是隱藏的，請先顯示它或選別的圖層', true);
      return;
    }
    const tool = eraserButton ? 'eraser' : S.tool;
    if (tool === 'fill') {
      fillAt(x, y);
      return;
    }
    if (tool === 'gradient') {
      startGradient(e, x, y);
      e.preventDefault();
      return;
    }
    const r = view3d.getBoundingClientRect();
    camera.updateMatrixWorld();
    painter.beginStroke(
      { camera, scene, w: r.width, h: r.height, hide: [grid, wireGroup], modelSize },
      {
        color: S.color,
        opacity: S.opacity,
        hardness: S.hardness,
        erase: tool === 'eraser',
        backfaces: S.backfaces,
        ...brushTextures(),
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
    lastXY = localXY(e);
    if (e.pointerType !== 'touch') {
      const [x, y] = localXY(e);
      const t = currentTool();
      const brushTool = (t === 'pen' || t === 'eraser') && !D.active && !e.target.closest('button, .corner');
      const d = brushTool ? S.size : 0;
      view3d.style.cursor = D.active ? (D.dragging ? 'grabbing' : 'crosshair') : brushTool ? 'none' : 'crosshair';
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
    if (grad && e.pointerId === grad.id) {
      if (e.buttons === 0) endGradient();
      else updateGradient(...localXY(e));
      return;
    }
    if (!stroke || e.pointerId !== stroke.id) return;
    if (e.buttons === 0) {
      endStroke(e); // 漏接 pointerup（例如筆離開感應範圍）時，不要繼續畫
      return;
    }
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
  const up3d = (e) => {
    if (grad && e.pointerId === grad.id) endGradient();
    else endStroke(e);
  };
  view3d.addEventListener('pointerup', up3d);
  view3d.addEventListener('pointercancel', up3d);
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
      if (!h.uv || !h.object.isMesh || !h.object.visible) continue;
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

  // ---------- 填色、漸層（3D 視窗） ----------
  // 點到的網格、三角形與貼圖組
  function rayHitSet(x, y) {
    const r = view3d.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1), camera);
    for (const h of raycaster.intersectObject(model, true)) {
      if (!h.uv || !h.object.isMesh || !h.face || !h.object.visible) continue;
      const mats = h.object.material;
      const m = Array.isArray(mats) ? mats[h.face.materialIndex] : mats;
      const set = painter.matSet.get(m);
      if (set) return { h, set };
    }
    return null;
  }

  function fillBrush() {
    return { color: S.color, opacity: S.opacity, hardness: 1, erase: false };
  }

  function doFill(set, region) {
    if (!set.activeLayer.visible) {
      setStatus('目前的圖層是隱藏的，請先顯示它或選別的圖層', true);
      return;
    }
    painter.fill(set, fillBrush(), region);
    if (set !== S.current) showSet(set);
    updateUndoButtons();
    setStatus(region ? `已填滿 UV 島（${set.name}）` : `已填滿整個材質（${set.name}）`);
  }

  function fillAt(x, y) {
    const hit = rayHitSet(x, y);
    if (!hit) return;
    const region = S.fillMode === 'island' ? painter.island(hit.set, hit.h.object, hit.h.faceIndex) : null;
    if (S.fillMode === 'island' && !region) return;
    doFill(hit.set, region);
  }

  let grad = null;
  const guide = $('guide');
  const guideLine = $('guideLine');
  function startGradient(e, x, y) {
    const r = view3d.getBoundingClientRect();
    camera.updateMatrixWorld();
    painter.beginStroke(
      { camera, scene, w: r.width, h: r.height, hide: [grid, wireGroup, decalOutline], modelSize },
      { color: S.color, opacity: S.opacity, hardness: 0.5, erase: false, backfaces: S.backfaces },
    );
    let A = null;
    if (S.backfaces) {
      const hit = painter.pickWorld(x, y);
      if (!hit) {
        painter.cancelStroke();
        setStatus('「背面也畫」模式的漸層起點要點在模型上', true);
        return;
      }
      A = hit.p;
    }
    // 只畫起點所在的那組貼圖（起點不在模型上時全部都畫）
    const hitSet = rayHitSet(x, y);
    grad = {
      only: hitSet ? hitSet.set : null,
      id: e.pointerId,
      x0: x,
      y0: y,
      h: r.height,
      A,
      plane: A ? new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), A) : null,
    };
    view3d.setPointerCapture(e.pointerId);
    guide.style.display = 'block';
    updateGradient(x, y);
  }
  function updateGradient(x, y) {
    guideLine.setAttribute('x1', grad.x0);
    guideLine.setAttribute('y1', grad.y0);
    guideLine.setAttribute('x2', x);
    guideLine.setAttribute('y2', y);
    if (grad.A) {
      const r = view3d.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1), camera);
      const B = raycaster.ray.intersectPlane(grad.plane, new THREE.Vector3()) || grad.A.clone();
      painter.gradient(grad.A, B, true, grad.only);
    } else painter.gradient(new THREE.Vector3(grad.x0, grad.h - grad.y0, 0), new THREE.Vector3(x, grad.h - y, 0), false, grad.only);
  }
  function endGradient() {
    if (grad.only && grad.only !== S.current) showSet(grad.only);
    painter.endStroke();
    grad = null;
    guide.style.display = 'none';
    updateUndoButtons();
  }

  // ---------- UV 面板操作 ----------
  // 左鍵／筆：依工具畫、填色、取色；中鍵、右鍵拖曳與觸控：平移；滾輪、雙指：縮放
  const uvPtrs = new Map();
  let uvPinch = null;
  let uvStroke = null;
  const uvCursor = $('uvCursor');
  viewUV.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = viewUV.getBoundingClientRect();
      const before = uvAt(e.clientX - r.left, e.clientY - r.top, r);
      uvState.zoom *= Math.exp(-e.deltaY * 0.0015);
      uvState.zoom = Math.min(64, Math.max(0.1, uvState.zoom));
      const after = uvAt(e.clientX - r.left, e.clientY - r.top, r);
      uvState.cx += before.x - after.x;
      uvState.cy += before.y - after.y;
    },
    { passive: false },
  );
  function uvAt(x, y, r) {
    const halfH = 0.5 / uvState.zoom;
    return { x: uvState.cx + (x / r.height - r.width / r.height / 2) * 2 * halfH, y: uvState.cy - (y / r.height - 0.5) * 2 * halfH };
  }
  // 畫面座標 → 貼圖 UV；perPx：每個畫面 px 對應的 UV 長度
  function uvTex(clientX, clientY) {
    const r = viewUV.getBoundingClientRect();
    const p = uvAt(clientX - r.left, clientY - r.top, r);
    const aspect = S.current ? S.current.w / S.current.h : 1;
    return { u: p.x / aspect, v: p.y, perPx: 1 / (uvState.zoom * r.height) };
  }

  function uvDab(cx0, cy0, p, dir) {
    const s = S.current;
    const { x: cx, y: cy, r: rpx, rot } = dabVariant(cx0, cy0, p, dir);
    const { u, v, perPx } = uvTex(cx, cy);
    const a = S.pOpacity ? Math.max(0.02, p) : 1;
    if (uvStroke.connected) {
      const P = painter.posAt(s, u, v);
      const wpu = P && painter.worldPerUV(s, u, v);
      if (!P || !wpu) return;
      const r = rpx * perPx * wpu;
      pendingDabs.push({ type: 'w', p: P, r, a });
      if (S.sym) {
        const m = P.clone();
        m.x = 2 * modelCenterX() - m.x;
        pendingDabs.push({ type: 'w', p: m, r, a });
      }
    } else pendingDabs.push({ type: 's', x: u * s.w, y: v * s.h, r: rpx * perPx * s.h, a, rot });
  }
  function uvSegment(x1, y1, p1) {
    const st = uvStroke;
    const dx = x1 - st.lx;
    const dy = y1 - st.ly;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    let t = st.carry;
    const dir = Math.atan2(-dy, dx);
    while (t <= len) {
      const f = t / len;
      const p = st.lp + (p1 - st.lp) * f;
      uvDab(st.lx + dx * f, st.ly + dy * f, p, dir);
      t += Math.max(0.5, brushRadius(p) * 2 * S.spacing);
    }
    st.carry = t - len;
    st.lx = x1;
    st.ly = y1;
    st.lp = p1;
  }
  function endUVStroke() {
    if (!uvStroke) return;
    if (pendingDabs.length) {
      painter.paintDabs(pendingDabs);
      pendingDabs = [];
    }
    painter.endStroke();
    uvStroke = null;
    updateUndoButtons();
  }

  viewUV.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.uvHead')) return;
    const s = S.current;
    const drawBtn = e.pointerType !== 'touch' && (e.button === 0 || e.button === 5);
    const tool = e.button === 5 ? 'eraser' : e.altKey ? 'picker' : currentTool();
    if (drawBtn && s && !D.active && ['pen', 'eraser', 'fill', 'picker'].includes(tool)) {
      const { u, v } = uvTex(e.clientX, e.clientY);
      e.preventDefault();
      if (tool === 'picker') {
        const b = painter.pickColor(s, { x: u, y: v });
        setColor('#' + [b[0], b[1], b[2]].map((c) => c.toString(16).padStart(2, '0')).join(''));
        setStatus(`取色：${S.color}（${s.name}）`);
        return;
      }
      if (!s.activeLayer.visible) {
        setStatus('目前的圖層是隱藏的，請先顯示它或選別的圖層', true);
        return;
      }
      if (tool === 'fill') {
        const region = S.fillMode === 'island' ? painter.islandAtUV(s, u, v) : null;
        if (S.fillMode !== 'island' || region) doFill(s, region);
        return;
      }
      const connected = $('uvConnect').checked && !!painter.posMap(s);
      painter.beginUVStroke(
        s,
        { color: S.color, opacity: S.opacity, hardness: S.hardness, erase: tool === 'eraser', ...brushTextures() },
        connected,
      );
      const p = pressureOf(e);
      uvStroke = { id: e.pointerId, connected, lx: e.clientX, ly: e.clientY, lp: p, carry: 0 };
      uvDab(e.clientX, e.clientY, p);
      uvStroke.carry = Math.max(0.5, brushRadius(p) * 2 * S.spacing);
      viewUV.setPointerCapture(e.pointerId);
      return;
    }
    viewUV.setPointerCapture(e.pointerId);
    uvPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (uvPtrs.size === 2) {
      const [a, b] = [...uvPtrs.values()];
      uvPinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: uvState.zoom };
    }
  });
  viewUV.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') {
      const r = viewUV.getBoundingClientRect();
      const t = currentTool();
      const show = (t === 'pen' || t === 'eraser') && !D.active && !e.target.closest('.uvHead');
      uvCursor.style.display = show ? 'block' : 'none';
      uvCursor.style.left = e.clientX - r.left + 'px';
      uvCursor.style.top = e.clientY - r.top + 'px';
      uvCursor.style.width = uvCursor.style.height = S.size + 'px';
      viewUV.style.cursor = show ? 'none' : t === 'picker' || t === 'fill' ? 'crosshair' : '';
    }
    if (uvStroke && e.pointerId === uvStroke.id) {
      if (e.buttons === 0) {
        endUVStroke();
        return;
      }
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) uvSegment(ev.clientX, ev.clientY, pressureOf(ev));
      return;
    }
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
    if (uvStroke && e.pointerId === uvStroke.id) {
      endUVStroke();
      return;
    }
    uvPtrs.delete(e.pointerId);
    if (uvPtrs.size < 2) uvPinch = null;
  };
  viewUV.addEventListener('pointerup', uvUp);
  viewUV.addEventListener('pointercancel', uvUp);
  viewUV.addEventListener('pointerleave', () => (uvCursor.style.display = 'none'));
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
    view3d.style.cursor = t === 'pen' || t === 'eraser' ? 'none' : 'crosshair';
    $('fillOpts').hidden = t !== 'fill';
    $('gradHint').hidden = t !== 'gradient';
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
  for (const [k, name] of RP.TIPS) $('tip').add(new Option(name, k));
  for (const [k, name] of RP.GRAINS) $('grain').add(new Option(name, k));
  $('tip').onchange = (e) => (S.tip = e.target.value);
  $('grain').onchange = (e) => (S.grain = e.target.value);
  bindRange('grainAmt', 'grainAmtOut', (v) => (S.grainAmt = v / 100));
  bindRange('scatter', 'scatterOut', (v) => (S.scatter = v / 100));
  bindRange('jitter', 'jitterOut', (v) => (S.jitter = v / 100));
  $('rotRandom').onchange = (e) => (S.rotRandom = e.target.checked);
  $('rotFollow').onchange = (e) => (S.rotFollow = e.target.checked);

  // 把狀態寫回介面（套用預設時）
  function syncBrushUI() {
    const setR = (id, v) => {
      $(id).value = v;
      const o = $(id + 'Out');
      if (o) o.textContent = v;
    };
    setR('opacity', Math.round(S.opacity * 100));
    setR('hardness', Math.round(S.hardness * 100));
    setR('spacing', Math.round(S.spacing * 100));
    setR('grainAmt', Math.round(S.grainAmt * 100));
    setR('scatter', Math.round(S.scatter * 100));
    setR('jitter', Math.round(S.jitter * 100));
    $('pSize').checked = S.pSize;
    $('pOpacity').checked = S.pOpacity;
    $('tip').value = S.tip;
    $('grain').value = S.grain;
    $('rotRandom').checked = S.rotRandom;
    $('rotFollow').checked = S.rotFollow;
    for (const b of $('presets').children) b.classList.toggle('on', b.dataset.id === S.preset);
  }
  function applyPreset(p) {
    for (const k of ['hardness', 'opacity', 'spacing', 'pSize', 'pOpacity', 'tip', 'grain', 'grainAmt', 'scatter', 'jitter', 'rotRandom', 'rotFollow'])
      S[k] = p[k];
    S.preset = p.id;
    syncBrushUI();
    if (S.tool !== 'pen' && S.tool !== 'eraser') setTool('pen');
  }
  for (const p of RP.BRUSH_PRESETS) {
    const b = document.createElement('button');
    b.textContent = p.name;
    b.dataset.id = p.id;
    b.onclick = () => applyPreset(p);
    $('presets').appendChild(b);
  }
  applyPreset(RP.BRUSH_PRESETS.find((p) => p.id === 'round'));
  $('fillMode').onchange = (e) => (S.fillMode = e.target.value);

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
  $('objShowAll').onclick = showAllMeshes;
  $('uvSet').onchange = (e) => showSet(painter.sets[Number(e.target.value)]);
  $('btnUvToggle').onclick = () => {
    document.body.classList.toggle('noUV');
    $('btnUvToggle').classList.toggle('on', !document.body.classList.contains('noUV'));
  };
  $('btnRightToggle').onclick = () => {
    document.body.classList.toggle('noRight');
    $('btnRightToggle').classList.toggle('on', !document.body.classList.contains('noRight'));
  };
  // 窄螢幕（平板直向）預設收起 UV 面板
  if (window.innerWidth < 900) $('btnUvToggle').click();

  for (const b of document.querySelectorAll('[data-view]'))
    b.onclick = () => {
      const v = b.dataset.view;
      if (v === 'fit') fitView();
      else if (v === 'persp') togglePersp();
      else setView(v);
    };

  function updateUndoButtons() {
    if (painter.undoStack.length || painter.redoStack.length) S.edited = true;
    $('btnUndo').disabled = !painter.undoStack.length;
    $('btnRedo').disabled = !painter.redoStack.length;
    renderLayers();
  }
  $('btnUndo').onclick = () => {
    painter.undo();
    updateUndoButtons();
  };
  $('btnRedo').onclick = () => {
    painter.redo();
    updateUndoButtons();
  };

  // ---------- 圖層面板（顯示目前貼圖組的圖層，最上面的圖層排在最上面） ----------
  const EYE_ON =
    '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /></svg>';
  const BLEND_NAMES = Object.fromEntries(RP.BLEND_MODES);
  for (const [k, name] of RP.BLEND_MODES) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = name;
    $('layerBlend').appendChild(o);
  }

  function renderLayers() {
    const s = S.current;
    const list = $('layerList');
    list.innerHTML = '';
    $('layerSetName').textContent = s ? `— ${s.name}` : '';
    for (const id of ['layerBlend', 'layerOpacity', 'layerLock', 'layerClip', 'lyAdd', 'lyDup', 'lyUp', 'lyDown', 'lyMerge', 'lyClear', 'lyDel'])
      $(id).disabled = !s;
    if (!s) return;
    for (let i = s.layers.length - 1; i >= 0; i--) {
      const L = s.layers[i];
      const row = document.createElement('div');
      row.className = 'layerRow' + (i === s.active ? ' on' : '') + (L.clip ? ' clip' : '');
      row.dataset.i = i;
      const eye = document.createElement('button');
      eye.className = 'eye' + (L.visible ? '' : ' off');
      eye.title = L.visible ? '隱藏' : '顯示';
      eye.innerHTML = L.visible ? EYE_ON : EYE_OFF;
      eye.onclick = (e) => {
        e.stopPropagation();
        painter.editLayers(s, () => {
          L.visible = !L.visible;
        });
        updateUndoButtons();
      };
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = L.name;
      name.title = '雙擊改名';
      name.ondblclick = (e) => {
        e.stopPropagation();
        const inp = document.createElement('input');
        inp.value = L.name;
        name.textContent = '';
        name.appendChild(inp);
        inp.focus();
        inp.select();
        const done = (ok) => {
          const v = inp.value.trim();
          if (ok && v && v !== L.name)
            painter.editLayers(s, () => {
              L.name = v;
            });
          updateUndoButtons();
        };
        inp.onkeydown = (ev) => {
          ev.stopPropagation();
          if (ev.key === 'Enter') inp.blur();
          if (ev.key === 'Escape') {
            inp.onblur = null;
            done(false);
          }
        };
        inp.onblur = () => done(true);
      };
      const tags = [];
      if (L.blend !== 'normal') tags.push(BLEND_NAMES[L.blend]);
      if (L.opacity < 1) tags.push(Math.round(L.opacity * 100) + '%');
      if (L.lockAlpha) tags.push('🔒');
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = tags.join(' ');
      row.append(eye, name, tag);
      row.onclick = () => {
        s.active = i;
        renderLayers();
      };
      list.appendChild(row);
    }
    const L = s.activeLayer;
    $('layerBlend').value = L.blend;
    $('layerOpacity').value = Math.round(L.opacity * 100);
    $('layerOpacityOut').textContent = Math.round(L.opacity * 100);
    $('layerLock').checked = L.lockAlpha;
    $('layerClip').checked = L.clip;
    $('lyMerge').disabled = s.active === 0;
    $('lyDel').disabled = s.layers.length <= 1;
  }

  function layerEdit(fn) {
    const s = S.current;
    if (!s) return;
    painter.editLayers(s, () => fn(s, s.activeLayer));
    updateUndoButtons();
  }
  $('layerBlend').onchange = (e) => layerEdit((s, L) => void (L.blend = e.target.value));
  $('layerLock').onchange = (e) => layerEdit((s, L) => void (L.lockAlpha = e.target.checked));
  $('layerClip').onchange = (e) => layerEdit((s, L) => void (L.clip = e.target.checked));
  // 不透明度：拖曳中即時預覽，放開才記一筆復原
  let opacitySnap = null;
  $('layerOpacity').addEventListener('input', (e) => {
    const s = S.current;
    if (!s) return;
    if (!opacitySnap) opacitySnap = painter.snapshot(s);
    s.activeLayer.opacity = Number(e.target.value) / 100;
    $('layerOpacityOut').textContent = e.target.value;
    s.dirty = true;
  });
  $('layerOpacity').addEventListener('change', () => {
    const s = S.current;
    if (!s || !opacitySnap) return;
    painter.pushHistory([painter.structOp(s, opacitySnap)]);
    opacitySnap = null;
    updateUndoButtons();
  });
  const withSet = (fn) => () => {
    if (!S.current) return;
    fn(S.current);
    updateUndoButtons();
  };
  $('lyAdd').onclick = withSet((s) => painter.addLayer(s));
  $('lyDup').onclick = withSet((s) => painter.duplicateLayer(s, s.active));
  $('lyUp').onclick = withSet((s) => painter.moveLayer(s, s.active, 1));
  $('lyDown').onclick = withSet((s) => painter.moveLayer(s, s.active, -1));
  $('lyMerge').onclick = withSet((s) => painter.mergeDown(s, s.active));
  $('lyClear').onclick = withSet((s) => painter.clearLayer(s));
  $('lyDel').onclick = withSet((s) => painter.deleteLayer(s, s.active));
  updateUndoButtons();

  // 開檔
  $('btnOpen').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => {
    const f = e.target.files[0];
    if (f) openFile(f);
    e.target.value = '';
  };
  $('btnDemo').onclick = () => {
    S.fileName = 'demo_mech';
    S.sourceBuf = null;
    setModel(RP.buildDemoMech());
  };
  $('btnOpenProj').onclick = () => $('projInput').click();
  $('projInput').onchange = (e) => {
    const f = e.target.files[0];
    if (f) openFile(f);
    e.target.value = '';
  };
  $('btnSaveProj').onclick = () => saveProject();

  // ---------- 專案檔（.rpaint）：不壓縮的 zip ＝ project.json ＋ model.glb（原始檔）＋ layers/*.png ----------
  // PNG 自己編碼（CompressionStream），透明度不會被瀏覽器的預乘處理弄掉精度；不支援時改用畫布
  async function encodePNG(px, w, h) {
    if (typeof CompressionStream === 'undefined') {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, px.length), w, h), 0, 0);
      return new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer());
    }
    const raw = new Uint8Array((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) raw.set(px.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
    const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const crcT = encodePNG.crc || (encodePNG.crc = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    }));
    const chunk = (type, data) => {
      const out = new Uint8Array(12 + data.length);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, data.length);
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
      out.set(data, 8);
      let c = 0xffffffff;
      for (let i = 4; i < 8 + data.length; i++) c = crcT[(c ^ out[i]) & 0xff] ^ (c >>> 8);
      dv.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
      return out;
    };
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w);
    dv.setUint32(4, h);
    ihdr.set([8, 6, 0, 0, 0], 8);
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
    return new Uint8Array(await new Blob(parts).arrayBuffer());
  }
  function decodeImage(bytes) {
    return createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }

  async function saveProject() {
    if (!model) return;
    if (stroke || D.active) return;
    setStatus('儲存專案中…');
    download(await buildProject(), `${safe(S.fileName)}.rpaint`);
    setStatus('已儲存專案');
  }

  async function buildProject() {
    const files = [];
    const meta = { app: 'rubicon-paint', version: 1, fileName: S.fileName, demo: !S.sourceBuf, sets: [], hidden: meshes().map((o) => !o.visible) };
    if (S.sourceBuf) files.push({ name: 'model.glb', data: new Uint8Array(S.sourceBuf) });
    for (let i = 0; i < painter.sets.length; i++) {
      const s = painter.sets[i];
      const layers = [];
      for (let j = 0; j < s.layers.length; j++) {
        const L = s.layers[j];
        const name = `layers/${i}_${j}.png`;
        files.push({ name, data: await encodePNG(painter.layerPixels(s, L), s.w, s.h) });
        layers.push(Object.assign(L.props(), { file: name }));
      }
      meta.sets.push({ name: s.name, w: s.w, h: s.h, active: s.active, layers });
    }
    files.unshift({ name: 'project.json', data: new TextEncoder().encode(JSON.stringify(meta, null, 1)) });
    return RP.makeZip(files);
  }

  // ---------- 自動暫存（每 5 分鐘，有改動才存；存在這個瀏覽器的 IndexedDB） ----------
  const AUTOSAVE_MS = 5 * 60 * 1000;

  function idb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('rubicon-paint', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('autosave');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbDo(mode, fn) {
    const db = await idb();
    try {
      return await new Promise((resolve, reject) => {
        const t = db.transaction('autosave', mode);
        const req = fn(t.objectStore('autosave'));
        t.oncomplete = () => resolve(req && req.result);
        t.onerror = () => reject(t.error);
      });
    } finally {
      db.close();
    }
  }
  async function autosave() {
    if (!S.edited || !model || stroke || D.active || grad || uvStroke) return false;
    S.edited = false;
    const blob = await buildProject();
    await idbDo('readwrite', (st) => st.put({ blob, time: Date.now(), name: S.fileName }, 'last'));
    return true;
  }
  setInterval(() => autosave().catch(() => {}), AUTOSAVE_MS);
  idbDo('readonly', (st) => st.get('last'))
    .then((rec) => {
      if (!rec) return;
      const b = $('btnRestore');
      b.hidden = false;
      b.title = `還原「${rec.name}」（${new Date(rec.time).toLocaleString()} 自動暫存）`;
      b.onclick = async () => {
        b.hidden = true;
        await openProject(await rec.blob.arrayBuffer(), rec.name + '.rpaint');
      };
    })
    .catch(() => {});

  async function openProject(buf, name) {
    try {
      setStatus('開啟專案中…');
      const zip = RP.readZip(buf);
      const metaBytes = zip.get('project.json');
      if (!metaBytes) throw new Error('沒有 project.json');
      const meta = JSON.parse(new TextDecoder().decode(metaBytes));
      if (meta.demo) {
        S.sourceBuf = null;
        S.fileName = meta.fileName || 'demo_mech';
        setModel(RP.buildDemoMech());
      } else {
        const glb = zip.get('model.glb');
        if (!glb) throw new Error('沒有 model.glb');
        const ab = glb.slice().buffer;
        const root = await parseGLB(ab);
        S.sourceBuf = ab;
        S.fileName = meta.fileName || name.replace(/\.rpaint$/i, '');
        setModel(root);
      }
      const warn = [];
      for (let i = 0; i < meta.sets.length; i++) {
        const ms = meta.sets[i];
        const s = painter.sets[i];
        if (!s || s.w !== ms.w || s.h !== ms.h) {
          warn.push(ms.name);
          continue;
        }
        const list = [];
        for (const ml of ms.layers) {
          const img = await decodeImage(zip.get(ml.file));
          const props = {};
          for (const k of ['name', 'visible', 'opacity', 'blend', 'lockAlpha', 'clip']) props[k] = ml[k];
          list.push({ props, rt: painter.rtFromImage(s, img) });
          img.close();
        }
        painter.restoreLayers(s, list, ms.active);
      }
      painter.resetHistory();
      const ms = meshes();
      (meta.hidden || []).forEach((h, i) => ms[i] && setMeshVisible(ms[i], !h));
      renderObjects();
      showSet(painter.sets[0] || null);
      updateUndoButtons();
      setStatus(warn.length ? `已開啟專案，但這些貼圖組對不上（略過）：${warn.join('、')}` : `已開啟專案「${S.fileName}」`, !!warn.length);
    } catch (err) {
      setStatus('開啟專案失敗：' + err.message, true);
    }
  }

  // ---------- PSD ----------
  $('btnExportPsd').onclick = () => {
    const s = S.current;
    if (!s) return;
    const layers = s.layers.map((L) => Object.assign(L.props(), { pixels: painter.layerPixels(s, L) }));
    const blob = RP.makePSD(s.w, s.h, layers, painter.readComp(s));
    download(blob, `${safe(S.fileName)}_${safe(s.name)}.psd`);
    setStatus(`已匯出 PSD（${s.name}，${layers.length} 個圖層）`);
  };

  // ---------- AO 烘焙 ----------
  bindRange('aoStrength', 'aoStrengthOut', () => {});
  bindRange('aoContrast', 'aoContrastOut', () => {});
  $('btnAO').onclick = () => {
    if (!model || !painter.sets.length) return;
    setStatus('AO 烘焙中…');
    // 讓狀態列先畫出來
    setTimeout(() => {
      try {
        const t0 = performance.now();
        const n = painter.bakeAO({
          scene,
          hide: [grid, wireGroup, decalOutline],
          dirs: Number($('aoDirs').value),
          strength: Number($('aoStrength').value) / 100,
          contrast: Number($('aoContrast').value) / 100,
          sets: $('aoOnlyCurrent').checked && S.current ? [S.current] : null,
        });
        updateUndoButtons();
        setStatus(`已烘焙 AO：${n} 組貼圖各加了一個「AO」圖層（色彩增值，${Math.round(performance.now() - t0)} ms）`);
      } catch (err) {
        setStatus('AO 烘焙失敗：' + err.message, true);
      }
    }, 30);
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
    if (f) openFile(f);
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
    tex.premultiplyAlpha = true; // 縮放取樣時不會把透明像素的顏色混進邊緣（白邊）
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    Object.assign(D, { tex, img, active: true, placed: false, hasPoint: false, rot: 0, flip: false, hover: null, dragging: null });
    $('decalRot').value = 0;
    $('decalRotOut').textContent = '0';
    $('decalPanel').hidden = false;
    $('btnImage').classList.add('on');
    cursor.style.display = 'none';
    // 沒有透明通道的圖片（截圖、JPG、AI 工具畫成棋盤格的「假透明」）自動去除背景
    D.srcImg = img;
    const alpha = imageHasAlpha(img);
    $('decalKey').checked = !alpha;
    $('decalKeyRow').hidden = alpha;
    decalHint();
    if (!alpha) updateDecalBackground(true);
  }

  // 依「去除背景」設定重做圖片貼圖
  function updateDecalBackground(auto) {
    if (!D.active) return;
    let src = D.srcImg;
    let msg = '';
    if ($('decalKey').checked) {
      const res = RP.removeBackground(D.srcImg, Number($('decalKeyTol').value) / 100);
      if (res.canvas) {
        src = res.canvas;
        const what = res.mode === 'checker' ? '假透明的棋盤格背景' : '白色背景';
        msg = `${auto ? '這張圖片沒有透明通道，' : ''}已去除${what}（${Math.round(res.removed * 100)}%）。不需要的話取消勾選「去除背景」。`;
      } else msg = '沒有在圖片邊緣找到白底或棋盤格背景，所以沒有去除。';
    }
    D.tex.image = src;
    D.tex.needsUpdate = true;
    D.dirty = true;
    if (msg) setStatus(msg, true);
  }

  // 圖片有沒有半透明或透明的像素（縮小後檢查）
  function imageHasAlpha(img) {
    try {
      const k = Math.min(1, 512 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
      return false;
    } catch (e) {
      return true;
    }
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
  $('decalKey').onchange = () => {
    $('decalKeyRow').hidden = !$('decalKey').checked;
    updateDecalBackground(false);
  };
  bindRange('decalKeyTol', 'decalKeyTolOut', () => {});
  $('decalKeyTol').addEventListener('change', () => updateDecalBackground(false));
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
    if (e.altKey && e.code === 'KeyH') {
      showAllMeshes();
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (k === 's') saveProject();
      else if (k === 'z' && !e.shiftKey) $('btnUndo').click();
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
    else if (k === 'g') setTool('fill');
    else if (k === 'h') hideMeshUnderCursor();
    else if (k === 'u') setTool('gradient');
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
  window.__rp = { S, painter, get camera() { return camera; }, setModel, showSet, scene, autosave };

  requestAnimationFrame(frame);
})();
