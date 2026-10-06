# rubicon_apng_gen — RUBICON PROTOCOL 文字動畫 APNG 產生器

在瀏覽器內製作 TRPG 用的文字動畫素材（APNG / WebP / PNG / PNG 序列 ZIP）：
「戰鬥開始」切入畫面、預告片式文字演出、地點與時間字幕。所有處理都在瀏覽器內完成，不上傳伺服器。

功能規格見 [docs/SPEC.md](docs/SPEC.md)。

## 執行

純靜態網站（原生 ES Modules），不需要建置。因為使用 ES Modules，必須透過 HTTP 開啟（直接雙擊 `index.html` 不行）：

```sh
python -m http.server 8765
# 打開 http://localhost:8765/
```

部署：把整個資料夾放到 GitHub Pages、Netlify 等任何靜態主機即可。

## 結構

```
index.html            頁面骨架
css/app.css           樣式（比照 RUBICON PROTOCOL 本體；預設深色、可切淺色、手機版）
js/app.js             應用程式本體：狀態、儲存、模板、預覽、輸出流程
js/controls.js        設定面板（宣告式 schema → UI）、效果卡片小預覽、字型挑選器
js/presets.js         初始值、模板、樣式預設、尺寸預設
js/i18n.js            介面文字（繁體中文）
js/fonts.js           Google Fonts 按需載入、使用者字型（IndexedDB）、後備字型
js/engine/layout.js   排版：橫排 / 直排、避頭尾換行、自動縮小、九宮格定位、分頁
js/engine/timeline.js 時間軸：每個字的登場 / 顯示 / 退場時間
js/engine/effects.js  登場 23 種、退場 18 種、顯示中 9 種效果
js/engine/render.js   描繪：字的 sprite、效果、裝飾、背景、陰影與外發光
js/exporter.js        輸出流程（分析 → 編碼）、裁切、取消
js/codec/png.js       PNG / APNG 編碼（CompressionStream）
js/codec/quantize.js  256 色調色盤（無損判定 + median cut）
js/codec/webp.js      動畫 WebP 組裝（VP8X + ANIM + ANMF）
js/codec/zip.js       ZIP（STORE，UTF-8 檔名）
```

## 瀏覽器支援

- APNG / PNG / ZIP 輸出需要 `CompressionStream`（Chrome / Edge / Firefox / Safari 16.4+）。
- WebP 輸出需要瀏覽器能用 canvas 編碼 WebP（Chrome / Edge / Firefox；Safari 不支援）。
- 模糊類效果使用 `CanvasRenderingContext2D.filter`，不支援的瀏覽器會略過模糊。
