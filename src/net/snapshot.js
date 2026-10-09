// ============================================================
//  狀態序列化（房主 → 客機 快照）
// ============================================================
export function serEnt(e) {
  const w = e.weapons;
  const ws = ['rarm', 'larm', 'rback', 'lback'].map((s) => [
    w[s].ammo,
    w[s].mag,
    +w[s].reloadT.toFixed(2),
    w[s].dropped ? 1 : 0,
    w[s].charging ? 1 : 0,
  ]);
  return {
    i: e.id,
    p: [+e.pos.x.toFixed(2), +e.pos.y.toFixed(2), +e.pos.z.toFixed(2)],
    v: [+e.vel.x.toFixed(2), +e.vel.y.toFixed(2), +e.vel.z.toFixed(2)],
    y: +e.yaw.toFixed(3),
    a: +e.aimYaw.toFixed(3),
    ap: +e.aimPitch.toFixed(2),
    h: Math.round(e.hp),
    ac: Math.round(e.acs),
    st: +e.staggerT.toFixed(2),
    g: e.grounded ? 1 : 0,
    hv: e.hover ? 1 : 0,
    b: e.boost ? 1 : 0,
    q: e.qbT > 0 ? 1 : 0,
    d: e.dead ? 1 : 0,
    dn: e.downed ? 1 : 0,
    dt: e.downed ? +e.downT.toFixed(1) : 0,
    m: e.melee.active ? [e.melee.slot, e.melee.stage, +e.melee.t.toFixed(2)] : 0,
    w: ws,
    k: e.kits,
    lx: +(e.leanX || 0).toFixed(2),
    lz: +(e.leanZ || 0).toFixed(2),
    f: e.flying ? 1 : 0,
    l: e.lock ? e.lock.id : -1,
    ai: e.aiControlled ? 1 : 0,
    en: Math.round(e.en),
    kl: e.kills || 0,
    de: e.deaths || 0,
    rs: e.respawnT !== undefined ? +e.respawnT.toFixed(1) : -1,
    ...serSpecial(e),
  };
}
// 特殊敵人與 Boss 的顯示狀態（mech-special.js、mech-boss.js）：
// sx＝[護盾 %, 連線目標 id, 旗標（1 強化、2 混亂、4 電磁封鎖）, 連線種類, Boss 顯示狀態]；gn＝離場；
// bx＝第三批 Boss 的數值陣列（電磁砲／浮游砲的瞄準點、衛星砲的光柱位置…，mech-boss2.js）
function serSpecial(e) {
  const fl = (e.buffT > 0 ? 1 : 0) | (e.confuseT > 0 ? 2 : 0) | (e.empLockT > 0 ? 4 : 0);
  const o = {};
  if (e.domeFrac > 0 || e.linkId >= 0 || fl || e.bossVis)
    o.sx = [Math.round(e.domeFrac * 100), e.linkId, fl, e.linkKind || 0, e.bossVis || 0];
  if (e.gone) o.gn = 1;
  if (e.bx) o.bx = e.bx;
  return o;
}
export function applyEnt(e, s, g) {
  e.kills = s.kl || 0;
  e.deaths = s.de || 0;
  e.respawnT = s.rs !== undefined && s.rs >= 0 ? s.rs : undefined;
  e.hp = s.h;
  e.acs = s.ac;
  e.staggerT = s.st;
  e.grounded = !!s.g;
  e.hover = !!s.hv;
  e.boost = !!s.b;
  e.qbT = s.q ? 0.1 : 0;
  e.flying = !!s.f;
  e.kits = s.k;
  e.leanX = s.lx;
  e.leanZ = s.lz;
  e.aimPitch = s.ap;
  e.en = s.en;
  e.aiControlled = !!s.ai;
  const slots = ['rarm', 'larm', 'rback', 'lback'];
  s.w.forEach((ws, i) => {
    const w = e.weapons[slots[i]];
    if (!w) return;
    w.ammo = ws[0];
    w.mag = ws[1];
    w.reloadT = ws[2];
    w.charging = !!ws[4];
    if (ws[3] && !w.dropped) {
      e.dropWeapon(slots[i]);
    }
  });
  if (s.m) {
    const [slot, stage, t] = s.m;
    if (!e.melee.active || e.melee.stage !== stage || e.melee.slot !== slot) {
      e.melee.active = true;
      e.melee.slot = slot;
      e.melee.stage = stage;
      e.melee.t = t;
      const d = e.weapons[slot].def;
      const st = d.combo && d.combo[stage];
      if (st) e.swing = st.spin ? { l: 1, r: 1 } : { l: st.mirror ? 1 : -0.3, r: st.mirror ? -0.3 : 1 };
    }
    e.melee.t = s.m[2];
  } else if (e.melee.active) {
    e.melee.active = false;
    e.melee.stage = 0;
    e.swing = { l: 0, r: 0 };
  }
  e.lock = s.l >= 0 ? g.entById(s.l) : null;
  if (s.dn && !e.downed) {
    e.downed = true;
    e.downT = s.dt;
    e.knockSide = 1;
  }
  if (!s.dn && e.downed) {
    e.downed = false;
  }
  const sx = s.sx || [0, -1, 0, 0, 0];
  e.domeFrac = sx[0] / 100;
  e.linkId = sx[1];
  e.sxFlags = sx[2];
  e.linkKind = sx[3];
  e.bossVis = sx[4];
  e.bx = s.bx || null;
  if (sx[2] & 4) e.empLockT = Math.max(e.empLockT || 0, 0.25); // 客機自己的機體：移動預測也封鎖 QB 與懸浮
  if (s.gn && !e.dead) e.depart();
  else if (s.d && !e.dead) {
    e.dieVisual();
  }
}
