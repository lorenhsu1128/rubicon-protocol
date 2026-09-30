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

檔案
- rubicon-server.exe   伺服器（免安裝 Node.js）
- rubicon-protocol.html 遊戲本體（伺服器啟動時讀取此檔）
- rubicon-server.json   設定（port、自動啟動），第一次啟動後自動產生
- server.js             伺服器原始碼（有裝 Node.js 時可用 node server.js 執行）

注意
- 若 Windows SmartScreen 阻擋，按「其他資訊」→「仍要執行」。
- 關閉黑色主控台視窗即停止伺服器。
