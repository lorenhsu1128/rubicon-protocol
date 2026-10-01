RUBICON PROTOCOL 區網伺服器 v1.0（Windows）
=========================================
使用方式
1. 把 rubicon-server.exe 與 rubicon-protocol.html 放在同一個資料夾。
2. 雙擊 rubicon-server.exe。Windows 防火牆詢問時請按「允許」（私人網路）。
3. 瀏覽器會自動開啟控制台 http://localhost:8090/ ；遊戲伺服器預設用 port 80 自動啟動。
   - 控制台可以啟動／停止／重啟、更改 port（80 被佔用時改 8080 等）、看房間與日誌、觀戰任一房間。
   - 控制台不限本機，區網內任何人開 http://<這台IP>:8090/ 都能進。
4. 其他玩家用瀏覽器開控制台顯示的位址（例如 http://192.168.1.10/ ，可掃 QR），即可玩單機或進「多人連線」建房／搜尋／觀戰。
5. rubicon-protocol.html 仍可直接雙擊單獨執行（單機或方式 2 連線）。
6. 模型庫（選用）：把 model-library.html 也放在同一個資料夾，就能用 http://<這台IP>/models 或遊戲標題畫面的「模型庫」按鈕
   檢視所有 3D 模型、尺寸（公尺），並檢查替換用的 GLB 檔是否符合規格（docs/glb-spec.md）。

檔案
- rubicon-server.exe   伺服器（免安裝 Node.js）
- rubicon-protocol.html 遊戲本體（伺服器啟動時讀取此檔）
- model-library.html    模型庫（選用，也可以直接雙擊開啟）
- rubicon-server.json   設定（port、自動啟動），第一次啟動後自動產生
- server.js             伺服器原始碼（有裝 Node.js 時可用 npm start 執行）

注意
- 若 Windows SmartScreen 阻擋，按「其他資訊」→「仍要執行」。
- 關閉黑色主控台視窗即停止伺服器。

開發（原始碼版本，需要 Node.js）
- 遊戲原始碼在 src/，npm run build 產生 dist/rubicon-protocol.html 與 dist/model-library.html。
- npm run build:exe 產生 dist/rubicon-server.exe；發佈時提供 dist/ 裡的 exe 與 HTML 即可（模型庫選用）。
