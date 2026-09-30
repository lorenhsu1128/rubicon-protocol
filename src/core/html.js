// 把字串跳脫成可安全放進 innerHTML 的文字（暱稱、房名等遠端資料一律要經過這裡）
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
