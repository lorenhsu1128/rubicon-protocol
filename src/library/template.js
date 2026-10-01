// 範本 GLB：把程式模型照 docs/glb-spec.md 的規格匯出（+Z 為正面、×1 製作尺寸、節點與材質依規格命名），
// 讓美術直接匯入建模軟體當作比例、原點與節點命名的參考；也用來自我驗證 GLB 流程（匯出後再匯入應全部通過）
import { flipToGame } from '../render/glb.js';
import { isFxMaterial } from '../render/measure.js';

const firstGroup = (n) => n && n.children.find((c) => c.isGroup);

// 完整機甲：依 rig 欄位命名節點
function nameMechRig(rig) {
  rig.legsG.name = 'legs';
  rig.torso.name = 'torso';
  rig.head.name = 'head';
  for (const s of ['r', 'l']) {
    const a = rig.arms[s];
    if (!a) continue;
    a.sh.name = `arm_${s}_shoulder`;
    a.up.name = `arm_${s}_upper`;
    a.fore.name = `arm_${s}_fore`;
    a.hand.name = `arm_${s}_hand`;
    a.weapon.name = `mount_weapon_${s}`;
    a.back.name = `mount_back_${s}`;
  }
  const quadKey = (L) => (L.sz < 0 ? 'f' : 'b') + (L.side < 0 ? 'l' : 'r');
  for (const L of rig.legs) {
    const k = rig.type === 'quad' ? quadKey(L) : L.side < 0 ? 'l' : 'r';
    L.thigh.name = `leg_${k}_thigh`;
    L.knee.name = `leg_${k}_knee`;
    L.foot.name = `leg_${k}_foot`;
  }
  rig.nozzles.forEach((n, i) => (n.name = i ? 'nozzle_r' : 'nozzle_l'));
  if (rig.type !== 'biped') rig.legsG.userData.legType = rig.type;
}
// 手臂部件：肩 → 上臂 → 前臂 → 手 → 武器掛點
function nameArm(sh) {
  const up = firstGroup(sh),
    fore = firstGroup(up),
    hand = firstGroup(fore),
    wm = firstGroup(hand);
  if (up) up.name = 'arm_upper';
  if (fore) fore.name = 'arm_fore';
  if (hand) hand.name = 'arm_hand';
  if (wm) wm.name = 'mount_weapon';
}
// 腳部部件（二足／逆關節）：髖部樞紐 → 大腿 → 膝 → 腳
function nameLegs(legsG) {
  for (const L of legsG.children.filter((c) => c.isGroup)) {
    const thigh = firstGroup(L),
      knee = firstGroup(thigh),
      foot = firstGroup(knee);
    if (!thigh || !knee || !foot) continue;
    const k = L.position.x < 0 ? 'l' : 'r';
    thigh.name = `leg_${k}_thigh`;
    knee.name = `leg_${k}_knee`;
    foot.name = `leg_${k}_foot`;
  }
}

export function exportTemplate(entry, palKey) {
  return new Promise((resolve, reject) => {
    if (!THREE.GLTFExporter) return reject(new Error('GLTFExporter 未載入'));
    const b = entry.build(palKey || entry.pal);
    if (entry.cat === 'mech' && b.rig) nameMechRig(b.rig);
    const part = b.obj.children[0];
    if (entry.cat === 'arms' && part) nameArm(part);
    if (entry.cat === 'legs' && part) nameLegs(part);
    // 製作尺寸：武器保留掛點縮放（以遊戲內實際尺寸製作），其他一律 ×1
    if (entry.cat !== 'weapon' && entry.cat !== 'back') b.scaleNode.scale.set(1, 1, 1);
    // 去掉描邊外殼與發光特效（遊戲載入時會自動補描邊）
    const drop = [];
    b.obj.traverse((o) => {
      if (o.isMesh && (o.material.type === 'ShaderMaterial' || isFxMaterial(o.material))) drop.push(o);
      else if (o.isLineSegments) drop.push(o);
    });
    for (const o of drop) o.parent.remove(o);
    // 幾何先複製（部分幾何是共用快取），再轉成 glTF 座標（+Z 為正面）
    b.obj.traverse((o) => {
      if (o.isMesh) o.geometry = o.geometry.clone();
    });
    const root = new THREE.Group();
    root.name = entry.id.replace('/', '_');
    root.add(b.obj);
    flipToGame(root);
    new THREE.GLTFExporter().parse(root, (res) => resolve(res), { binary: true, onlyVisible: true });
  });
}
