// Boss 改版（docs/boss-design.md 第 3 節）：每隻 Boss 的專屬內容，純資料。鍵＝MechEntity.boss3Key()
// （kind，沒有 kind 的用名稱開頭 JUGGERNAUT／STRIDER／BALTEUS）。
// 欄位（都可以省略，省略時用 mech-boss-tier.js 的共用版本）：
//   star：刁鑽度 1～2 只偵測的那一種習慣（'air'／'close'／'far'／'cover'）
//   habits：刁鑽度 3～4 偵測的兩種（第一個是 star）
//   parts：部位 [{ id, name, off: [x, y, z]（Boss 身高的倍數，Boss 的座標：+Z 往前）, stops: [招式 id], back, expose }]
//   reflect：可以打掉的彈體種類（Projectile 的 kind：'missile'／'shell'／'grenade'…）
//   open2／open1：有破綻的大招（刁鑽度 3～4／5～8）
//   big：[第一型態, 第二型態]（第三型態＝mech-boss3.js 的 SPECIALS）的 [名稱, fn]——放在 mech-boss-tier.js
//   field：{ 2: 'cover'|'fire'|'smoke'|…, 3: … }（換型態的場地）
// 第 3～5 期依 docs/boss-design.md 逐隻補上。

// 刁鑽度 1～2 的應對（設計文件標★的那一種；沒有標的依 Boss 的打法）
export const C_STAR = {
  artillery: 'close',
  worm: 'air',
  JUGGERNAUT: 'close',
  railgun: 'cover',
  heli: 'close',
  rampart: 'far',
  train: 'close',
  furnace: 'air',
  STRIDER: 'close',
  phantom: 'far',
  ibis: 'far',
  spider: 'air',
  trinity: 'far',
  hunter: 'air',
  orbital: 'cover',
  flagship: 'far',
  fortress: 'close',
  interceptor: 'air',
  duo: 'cover',
  funnel: 'cover',
  mirror: 'close',
  BALTEUS: 'far',
};
export const HABITS = ['air', 'close', 'far', 'cover'];
export const HABIT_NAMES = { air: '空中', close: '貼身', far: '遠距', cover: '掩體' };

export const BOSS_KIT = {};
export function bossKitOf(key) {
  return BOSS_KIT[key] || null;
}
