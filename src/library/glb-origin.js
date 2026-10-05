// 區塊的原點（旋轉中心）寫回 GLB：在場景根部包一個名為 rubicon_origin 的節點，它的矩陣（glTF 座標）把模型移到
// 以關節為原點的位置。只改寫 GLB 的 JSON 區塊，頂點與貼圖的二進位資料原封不動，所以很快、也不會損失品質。
// 載入時 GLTFLoader 照一般節點處理（flipToGame 逐節點轉座標），遊戲不需要知道這個節點；
// GLB 編輯器存檔時（bakeScene）會把它的變換寫進頂點。
const NAME = 'rubicon_origin';
const MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a; // 'JSON'

function readJson(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC || dv.getUint32(16, true) !== JSON_CHUNK)
    throw new Error('不是 glTF 二進位檔（GLB）');
  const len = dv.getUint32(12, true);
  return { json: JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len))), end: 20 + len };
}
const sceneOf = (json) => (json.scenes || [])[json.scene || 0];
// 目前的原點節點矩陣（glTF 的欄優先 16 個數字，可直接給 Matrix4.fromArray）；沒有時為 null
export function readOrigin(buf) {
  try {
    const { json } = readJson(buf);
    const sc = sceneOf(json);
    const n = sc && sc.nodes && sc.nodes.length === 1 ? json.nodes[sc.nodes[0]] : null;
    return n && n.name === NAME && n.matrix ? n.matrix.slice() : null;
  } catch (e) {
    return null;
  }
}
// 回傳寫入原點節點矩陣 m 之後的新 GLB（ArrayBuffer）；已有原點節點時直接改它的矩陣
export function writeOrigin(buf, m) {
  const { json, end } = readJson(buf);
  const sc = sceneOf(json);
  if (!sc) throw new Error('GLB 沒有場景');
  json.nodes = json.nodes || [];
  const roots = sc.nodes || [];
  const cur = roots.length === 1 ? json.nodes[roots[0]] : null;
  const matrix = Array.from(m, (v) => Math.round(v * 1e6) / 1e6 + 0);
  if (cur && cur.name === NAME) cur.matrix = matrix;
  else {
    json.nodes.push({ name: NAME, matrix, children: roots });
    sc.nodes = [json.nodes.length - 1];
  }
  // JSON 區塊以空白補到 4 的倍數；後面的區塊（BIN）照原樣接上
  let text = JSON.stringify(json);
  while (new TextEncoder().encode(text).length % 4) text += ' ';
  const jb = new TextEncoder().encode(text);
  const rest = new Uint8Array(buf, end);
  const out = new ArrayBuffer(20 + jb.length + rest.length);
  const dv = new DataView(out);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.byteLength, true);
  dv.setUint32(12, jb.length, true);
  dv.setUint32(16, JSON_CHUNK, true);
  const u = new Uint8Array(out);
  u.set(jb, 20);
  u.set(rest, 20 + jb.length);
  return out;
}
