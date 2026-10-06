// 快速姿勢（只影響顯示，存檔一律是拉直靜止姿勢）：手臂張開（肩，向外）、手肘彎曲（向前）、腿張開（髖，向外）、
// 膝蓋彎曲（向後）。組裝調整頁、檢視窗的組合預覽、GLB 編輯器的全身參考共用；呼叫前先 restPose(rig)。
const D2R = Math.PI / 180;
export const QUICK_POSE = [
  ['arm', '手臂張開', 0, 120],
  ['elbow', '手肘彎曲', 0, 150],
  ['leg', '腿張開', 0, 60],
  ['knee', '膝蓋彎曲', 0, 120],
];
// A pose：手臂往外約 40°、手肘微彎、腿微開（對照常見的機甲設定圖）
export const A_POSE = { arm: 40, elbow: 8, leg: 6, knee: 0 };
export const NO_POSE = { arm: 0, elbow: 0, leg: 0, knee: 0 };
export const poseActive = (q) => !!q && QUICK_POSE.some(([k]) => q[k]);

export function applyQuick(rig, q) {
  if (!rig || !q) return;
  for (const a of Object.values(rig.arms || {})) {
    const s = Math.sign(a.mount.position.x) || 1;
    a.up.rotation.z = s * q.arm * D2R;
    a.fore.rotation.x = q.elbow * D2R;
  }
  if (rig.type === 'biped' || rig.type === 'reverse')
    for (const L of rig.legs) {
      const s = Math.sign(L.thigh.parent.position.x) || 1;
      L.thigh.rotation.z = s * q.leg * D2R;
      L.knee.rotation.x = -q.knee * D2R;
    }
  rig.group.updateMatrixWorld(true);
}
