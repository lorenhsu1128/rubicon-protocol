# 人形素材整理（現在用的＋之後可以用的）

2026-10-30 整理。給之後的「小人」（`docs/world-scale.md` 的人的尺寸：身高 1.75 m）、格納庫的技師、過場動畫的人物用。
授權以各來源頁面為準，**用之前再看一次授權頁**（尤其是有「已變更授權」傳聞的 Quaternius，見下方）。

## 專案的條件（挑素材時看這幾點）

- **授權**：最好 CC0（不用標示、可以改、可以內嵌散布）。`dist/` 與 `src/assets/` 都提交進 git，素材會被原樣散布，所以**禁止再散布原始檔的授權（Mixamo 等）不適合**。CC-BY 可以，但要寫進 `CREDITS.txt`。
- **格式**：three.js r128 的 GLTFLoader 讀 GLB／glTF；FBX 要先用 Blender 轉。骨架動畫用 `THREE.SkeletonUtils.clone`（`render/hangar-assets.js` 的 `haChar`）。
- **大小**：外部素材打包進 `dist/lib/hangar-assets.js`（目前約 19 MB）。人物一隻 1～1.5 MB（減面＋WebP 貼圖、只留需要的動畫）是目前的水準；場上要放很多個時三角形要更少（數千面）。
- **風格**：機甲和地圖是程式模型（低多邊形、頂點色），所以低多邊形、風格化的人物比寫實的配。
- **動畫**：小人至少要 Idle／Walk／Run／Interact（操作、維修）；骨架相同的素材可以共用動畫。

## 一、現在用的

| 名稱                    | 檔案                                      | 來源                                                         | 授權 | 用在哪裡                                                                         | 動畫                                     |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------------ | ---- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| crew（太空服技師）      | `src/assets/hangar/crew.glb`（1.5 MB）    | Quaternius「Astronaut」，經 [Poly Pizza](https://poly.pizza) | CC0  | 船艙格納庫的主要技師（`render/hangar.js` 的 `buildCrewChar` → `haChar('crew')`） | Idle、Walk、Interact、Idle_Neutral、Wave |
| soldier（SWAT）         | `src/assets/hangar/soldier.glb`（1.2 MB） | Quaternius「SWAT」，經 Poly Pizza                            | CC0  | 野戰帳篷的人物（`haChar('soldier')`，野戰帳篷 4 人裡 3 人）                      | 同上                                     |
| worker（工人）          | `src/assets/hangar/worker.glb`（1.0 MB）  | Quaternius「Worker」，經 Poly Pizza                          | CC0  | 格納庫的主要技師（基地格納庫 4 人裡 3 人）                                       | 同上                                     |
| 程式的技師人偶          | `render/hangar.js`（程式模型）            | 自製                                                         | —    | 外部素材還沒載入或載不到時的替代                                                 | 程式動作                                 |
| 過場動畫的人物（11 隻） | `src/assets/people/*.glb`（共約 6.6 MB）  | Quaternius，經 Poly Pizza（2026-10-31 下載）                 | CC0  | 過場動畫的演員 `human`／`people`（`game/cine-people.js`，`docs/cinematics.md`）  | 見下                                     |

- **過場動畫的人物**（`src/assets/people/CREDITS.txt`）：和格納庫同一套骨架的 biz（西裝）、suitw（女性西裝，換白色當白袍）、hoodie、farmer、casual、hooded（斗篷，拿掉劍）、pilot（科幻駕駛服，拿掉手槍），留 Idle、Idle_Neutral、Walk、Run、Interact、Wave、Death、HitRecieve、Idle_Gun_Pointing；另一套低面數骨架（約 2000 面）的 man、woman、womanc、mansuit，留 Idle、Walk、Run、Sitting、Standing、Clapping、Death。處理：用 gltf-transform 拿掉其他動畫與武器網格、去重、頂點量化（KHR_mesh_quantization，r128 的 GLTFLoader 支援），大小約原檔的一半。建置成 `dist/lib/people-assets.js`。**注意**：骨架網格的外框是綁定姿勢的公分，身高要用骨頭量（`loadPeopleAssets`）。
- Poly Pizza 上 Quaternius 的人物頁面（`poly.pizza/m/<id>`）裡有 GLB 的直接網址（`static.poly.pizza/<uuid>.glb`）；Ultimate Animated Character Pack 只有一部分在 Poly Pizza 上（找得到的見 CREDITS.txt），其他要從 quaternius.com 下載 FBX 再轉。
- 來源與授權記在 `src/assets/hangar/CREDITS.txt`；建置時由 `scripts/build.js` 寫成 `dist/lib/hangar-assets.js`（`window.RUBICON_HANGAR`）。
- 在格納庫裡人物縮成 `HU`＝1/MS（`docs/world-scale.md`）。
- 這三隻是 Quaternius 早期的動畫人物（和「Ultimate Animated Character Pack」同一套骨架），所以那一包裡的其他人物可以直接共用這些動畫。

## 二、之後可以用的（依推薦順序）

### 1. KayKit（Kay Lousberg）——最推薦給「小人」

- **[KayKit Character Pack: Adventurers](https://kaylousberg.itch.io/kaykit-adventurers)**：低多邊形風格化人物，免費版 4 隻（付費版多 2 隻），附 75 個動畫。FBX／glTF。CC0（[Godot 素材庫](https://Godotengine.org/asset-library/asset/2129)也標 CC0）。
- **[KayKit Character Animations](https://kaylousberg.itch.io/kaykit-character-animations)**：約 161 個人形動畫（一般、移動、近戰、遠程、模擬（操作、搬運）、特殊、工具），FBX／glTF，CC0。分 Rig_Medium、Rig_Large 兩種骨架，**所有 KayKit 人物共用**。
- 其他 KayKit 人物包見 [KayKit 總頁](https://kaylousberg.itch.io/kaykit)（骨架相同，動畫通用）。
- 為什麼適合：glTF 直接可用、動畫多（有「工具／模擬」類，適合技師維修、搬東西）、骨架統一、風格和程式模型接近。注意作者不鼓勵原樣轉售。

### 2. Quaternius（現在用的來源）

- **[Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html)**（2025-08，[itch.io](https://quaternius.itch.io/universal-base-characters)）：6 個基本人體（超級英雄／一般／少年 × 男女）、20 種髮型。FBX／glTF。CC0。平均約 13k 三角形，**放很多隻時偏重**，要減面。
- **[Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html)**（＋[第 2 包](https://quaternius.com/packs/universalanimationlibrary2.html)）：120 個以上的動畫（8 方向移動、慢跑、衝刺、推、爬、游泳、坐、死亡、戰鬥與持槍、表情）。FBX／GLB。CC0。和 Universal Base Characters 同骨架。
- **[Modular Character Outfits - Fantasy](https://quaternius.com/packs/modularcharacteroutfitsfantasy.html)**：12 套服裝、62 個零件，套在 Universal Base Characters 上。CC0。目前只有奇幻風，沒找到科幻服裝包。
- **[Ultimate Animated Character Pack](https://quaternius.com/packs/ultimatedanimatedcharacter.html)**：52 隻動畫人物，**和現在用的 worker／crew／soldier 同一套**。只有 FBX／OBJ／Blend，要自己轉 GLB。頁面標 CC0。
- **[Animated Mech Pack](https://opengameart.org/node/126992)**：4 台會動的機甲（CC0），不是人形，但可以當背景或參考。
- 授權的注意：有第三方網站（[Cinevva](https://app.cinevva.com/guides/free-rigged-3d-character-models)）寫 Quaternius 改用自己的「QAL v1.0」授權，但 Quaternius 官方頁面目前都還標 CC0，我也查不到 QAL 的原文。**下載時以下載頁上寫的為準**，並把下載日期記進 `CREDITS.txt`。

### 3. Kenney

- **Animated Characters**：Protagonists、Retro、[Survivors](https://kenney.nl/assets/animated-characters-survivors) 三包，有骨架與動畫（待機、跳、跑），CC0，有 GLB。
- **Blocky Characters／Mini Characters**：沒有動畫，要自己綁骨架。
- 適合：方塊、玩具風，動畫少。和本專案的風格不太合，可以當遠景的小人或測試用。

### 4. Polygonal Mind「100 Avatars」

- [官方發佈頁](https://github.com/PolygonalMind/initiative-opensource-release)：R1 73 隻＋R2 94 隻，FBX／VRM。[GitHub](https://github.com/gfodor/100avatars) 標 glTF／VRM；VRM 版也在 [open-source-avatars](https://github.com/toxsam/open-source-avatars)。
- 授權：頁面連到 CC0，但 repo 裡執行長另外寫「不要沒大改就賣」，和純 CC0 有落差。
- 人形比例、相容 Mixamo 的動畫。風格很雜，比較像 VRChat 的頭像，不適合統一的技師與士兵。

### 5. 其他單隻（OpenGameArt）

- [Low poly fighter pilot（rigged）](https://opengameart.org/content/low-poly-fighter-pilot-rigged)：飛行員，CC0，2011 年的舊模型，動畫要自己補。**唯一找到的「駕駛員」造型**，過場動畫的駕駛員可以參考。
- [Low poly soldier with weapons](https://opengameart.org/content/low-poly-soldier-with-weapons)：士兵＋武器，CC0。
- [Rigged and animated humanoid](https://opengameart.org/content/rigged-and-animated-humanoid)：1000 面以下，CC0，骨架品質普通。
- [Animated human low poly](https://opengameart.org/content/animated-human-low-poly)（Quaternius）：走路、出拳，CC0。

### 不建議

- **Mixamo（Adobe）**：可以用在遊戲裡，但禁止散布原始檔與再授權（[Adobe 社群的整理](https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400)）。本專案把素材原樣放在 git 和 `dist/lib/`，等於散布，所以**不要用 Mixamo 的人物與動畫**。
- Sketchfab、CGTrader 上的「免費」人物大多是 CC-BY 或各自的授權（不是 CC0），要一隻一隻確認；付費包（例如 Dystopia Soldiers Pack）不考慮。

## 三、建議的用法

1. **小人（地圖上的人）**：KayKit 的人物＋KayKit Character Animations（同一副骨架，動畫多，有工具與搬運）。數量多時先減面、共用一份骨架動畫，遠處改成看板或不畫。
2. **格納庫、作戰室的技師**：維持現在的 Quaternius 三隻；要更多種時，從 Ultimate Animated Character Pack 轉 GLB（同骨架，現在的動畫直接共用）。
3. **過場動畫的駕駛員、角色特寫**：Universal Base Characters＋Universal Animation Library（比例好、可以換髮型、動畫最多），需要減面。
4. 匯入流程照現在格納庫的做法：Blender 轉 GLB → 減面 → 貼圖轉 WebP → 只留用得到的動畫 → 放進 `src/assets/hangar/`（或之後另開資料夾）→ 記進 `CREDITS.txt`。
