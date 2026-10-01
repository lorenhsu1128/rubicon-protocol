# 遊戲模型（GLB）

把通過模型庫檢查的 GLB 放在這裡，建置時會自動內嵌進遊戲與模型庫。

- 檔名＝模型槽位 id：`src/assets/models/<槽位 id>.glb`，例如 `head/h_std.glb`、`arms/a_std/r_fore.glb`、`weapon/w_rifle/l.glb`。
- 機甲是一塊塊區塊（手臂左右各上臂／前臂／手，腳分襠部與左右大腿／小腿／腳掌，武器分左右），完整機甲不接受整台的 GLB。
- 槽位 id 顯示在模型庫每一格的名稱下方，檢視窗也會寫出要放的路徑。
- 製作規格見 `docs/glb-spec.md`。沒有 GLB 的槽位會繼續使用程式模型。
