// 模型來源掛勾：建模函式先問這裡有沒有取代程式模型的 GLB（依槽位 id），沒有就照常建立程式模型。
// - 遊戲：單人模式的本地模型庫（game/local-lib.js 設定）
// - 模型庫：組合預覽時暫時掛上瀏覽器暫存的 GLB（library/stage.js）
// 沒有設定時一律回傳 null，建模函式維持純函式的行為
let provider = null;
// 設定來源，回傳原本的來源（暫時掛上時用來還原）
export function setModelProvider(fn) {
  const prev = provider;
  provider = fn;
  return prev;
}
// slot：槽位 id；pal：配色（null＝不換色）；unique：每個實例各自一份材質（會受擊閃光的模型）
export const providedModel = (slot, pal = null, unique = false) =>
  provider ? provider(slot, pal, unique) || null : null;
