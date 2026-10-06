# rubicon_paint

在 GLB 上直接繪圖的編輯器（RUBICON PROTOCOL 機甲用），目前是技術驗證版。

直接用瀏覽器開 `index.html`（file:// 也可以），按「開啟 GLB」或「範例模型」。

- three.js 固定 r128（`lib/three/`，和 rubicon-protocol 相同版本、相同的全域 `THREE` 寫法，之後要併進模型庫）。
- `js/paint-core.js`：繪圖核心（UV 空間投影繪圖、筆畫緩衝、合成與接縫外擴、復原）。
- `js/app.js`：介面、相機、輸入、匯出。
- `js/demo-model.js`：範例模型。

操作：滑鼠左鍵畫、右鍵旋轉、Shift＋右鍵或中鍵平移、滾輪縮放；平板用筆畫、單指旋轉、雙指縮放。
B 筆、E 橡皮擦、I／Alt 滴管、[ ] 筆刷大小、Ctrl+Z／Ctrl+Y、F 全部顯示、數字鍵 1／3／7／5 視角。
