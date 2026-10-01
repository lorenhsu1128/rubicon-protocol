// 範本 GLB：把程式模型照 docs/glb-spec.md 的規格匯出（+Z 為正面、×1 製作尺寸、原點在旋轉中心、材質依規格命名），
// 讓美術直接匯入建模軟體當作比例與原點的參考；也用來自我驗證 GLB 流程（匯出後再匯入應全部通過）。
// 完整機甲匯出整台組合（每個區塊一個節點，以槽位命名），只當參考，不能載回模型庫。
import { flipToGame } from '../render/glb.js';
import { isFxMaterial } from '../render/measure.js';

export function exportTemplate(entry, palKey) {
  return new Promise((resolve, reject) => {
    if (!THREE.GLTFExporter) return reject(new Error('GLTFExporter 未載入'));
    const b = entry.build(palKey || entry.pal);
    b.scaleNode.scale.set(1, 1, 1);
    // 去掉描邊外殼與發光特效（遊戲載入時會自動補描邊），區塊以槽位命名
    const drop = [];
    b.obj.traverse((o) => {
      if (o.isMesh && (o.material.type === 'ShaderMaterial' || isFxMaterial(o.material))) drop.push(o);
      else if (o.isLineSegments) drop.push(o);
      if (o.userData.slot) o.name = o.userData.slot.replace(/\//g, '_');
    });
    for (const o of drop) o.parent.remove(o);
    // 幾何先複製（部分幾何是共用快取），再轉成 glTF 座標（+Z 為正面）
    b.obj.traverse((o) => {
      if (o.isMesh) o.geometry = o.geometry.clone();
    });
    const root = new THREE.Group();
    root.name = entry.id.replace(/\//g, '_');
    root.add(b.obj);
    flipToGame(root);
    new THREE.GLTFExporter().parse(root, (res) => resolve(res), { binary: true, onlyVisible: true });
  });
}
