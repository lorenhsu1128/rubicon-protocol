// 機甲動作的彈簧：二階阻尼彈簧取代固定比例的 lerp，動作有加速、過衝與回彈（動漫風格：快、俐落、有一點過衝）。
// 速度存在 WeakMap（以 Euler／Vector3 物件為鍵），不寫進 userData（GLTFExporter 會把 userData 寫進檔案）。
// IK 每格開頭把關節還原成動作層的結果（ikRestore），彈簧從那裡接著算，所以速度不受 IK 影響。
const VEL = new WeakMap();
const AX = { x: 0, y: 1, z: 2 };

// obj[key] 以角頻率 w（rad/s）、阻尼比 z 往 to 前進 dt 秒（半隱式尤拉，每步最多 1/90 秒）
export function spring(obj, key, to, w, z, dt) {
  if (!(dt > 0)) return;
  let v = VEL.get(obj);
  if (!v) VEL.set(obj, (v = [0, 0, 0]));
  const i = AX[key];
  let x = obj[key],
    vv = v[i];
  if (!Number.isFinite(x) || !Number.isFinite(vv)) ((x = to), (vv = 0));
  const n = Math.min(12, Math.ceil(dt * 90)),
    h = dt / n,
    w2 = w * w,
    c = 2 * z * w;
  for (let k = 0; k < n; k++) {
    vv += (w2 * (to - x) - c * vv) * h;
    x += vv * h;
  }
  obj[key] = x;
  v[i] = vv;
}

// 給彈簧一個衝量（速度加 dv）：開火的後座、受擊
export function kick(obj, key, dv) {
  let v = VEL.get(obj);
  if (!v) VEL.set(obj, (v = [0, 0, 0]));
  v[AX[key]] += dv;
}

// 清掉速度（模型庫的動作編輯器從頭模擬時）
export function springClear(obj) {
  VEL.delete(obj);
}

// 依機體重量（0 輕～1 重）調整的彈簧參數 [w, z]：重的慢一點、過衝稍大
export function springSet(heavy) {
  const k = 1 - 0.3 * heavy;
  return {
    leg: [26 * k, 0.72], // 腿：快、過衝小（腳要踩穩）
    legS: [15 * k, 0.75], // 腿的外展、偏航
    hip: [11 * k, 0.62], // 下半身偏航（上下半身分離）
    torso: [17 * k, 0.48], // 軀幹：比較有彈性
    pos: [16 * k, 0.5], // 起伏與蹲低
    arm: [24 * k, 0.55],
    head: [15 * k, 0.6],
    snap: [44, 0.42], // 近戰揮擊：爆發、明顯過衝
    clip: [70, 0.62], // 近戰的關鍵影格：緊跟著片段
    sec: [10, 0.28], // 附加晃動（背包）：慢、會晃
  };
}
