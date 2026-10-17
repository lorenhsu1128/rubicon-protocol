// Coral 戰爭（RTS）R3 艾瑟立克的陣營機制（mixin，docs/rts-design.md 14.2；A 包）：
// - Coral 導管網（rtsPower*）：供電源＝蓋好的、定義有 conduit 的建築（根：研究中樞、汲取塔；節點：要接到 link 內有電的供電源）
//   ＋臨時導管（道具「攜帶式導管」）。rtsPowerRebuild 在供電源蓋好／被拆、主堡升級、研究導管增幅、臨時導管到期時重算
//   （不是每格）：根有電、節點廣度優先串回根；定義有 needPower 的建築中心不在任何有電的範圍裡＝停擺（e.bld.off）。
//   停擺的建築：生產、研究、升級暫停、防禦塔不開火、施工中的不長、不回血（rts.js 的 rtsBuildings）；人口上限照算。
//   導管上的加成（rtsPowerTick，每 0.5 秒）：己方單位在有電的範圍裡＝buff { src: 'grid', regen, speed, range（gridRange） }，
//   建築在有電的範圍裡、8 秒沒受傷＝每秒回復最大血量的 0.4%（研究「導管增幅」加倍）。只有陣營定義 grid 的隊伍。
// - 結晶護壁（rtsFactionAegis）：研究中樞的技能（rtsOrder 的建築技能 → rtsBldAbility）。
// - 實驗體融合（rtsFuse*）：rtsOrder 的 { k: 'fuse', recipe } → rtsFuseIssue 分組（宿主＋材料）→ 材料走向宿主
//   （mech-rts.js 的指令 'fuse'／'fuseTo' 轉給 rtsFuseStep）→ 到齊後 rtsFuseTick 扣 Coral、移除材料、宿主引導 →
//   rtsFuseFinish：宿主換成結果的新實體（模型直接用結果的定義建：嵌合體、原型體的模型與實驗體不同），選取與編隊跟著換。
// - 幻象（rtsIllusion*）：B 的投影、C 的英雄分身共用；不佔人口、擊破不給經驗與掉寶、不算戰績（rtsQuiet）、到期安靜移除。
import { SFX } from '../audio/audio.js';
import { RTS_AETH, RTS_FUSE } from '../data/rts-aetheric.js';
import { RTS_ABILS, RTS_DEFS, RTS_FACTIONS } from '../data/rts-units.js';
import { Game } from './game.js';
import { syncConduitLinks } from '../render/rts-aeth-models.js';

const ME = 0;
const hyp = Math.hypot;
const defOf = (it) => RTS_DEFS[(it && (it.rtsDef || it.def)) || ''];
const posOf = (it) => (it.pos ? it.pos : it);

Object.assign(Game.prototype, {
  // ---------- 導管網 ----------
  // 這一隊有沒有導管網（陣營的 grid）
  rtsPowerTeam(teamId) {
    const T = this.rts && this.rts.teams[teamId];
    return !!(T && RTS_FACTIONS[T.faction] && RTS_FACTIONS[T.faction].grid);
  },
  // 供電源的半徑（研究「導管增幅」+6 m；臨時導管不加）
  rtsPowerR(teamId, D) {
    return D.conduit.r + (this.rtsResLv(teamId, 'r_grid') ? RTS_AETH.gridAdd : 0);
  },
  // 計算供電：blds＝建築（實體，或 rtsFogKnown 這類 { def, x, z } 的紀錄）、temp＝臨時導管、excl＝當作不存在的建築。
  // 回傳供電源 [{ e, x, z, r, root, link, on, par }]（par＝讓它有電的供電源；根與臨時導管沒有）
  rtsPowerCompute(teamId, blds, temp, excl) {
    const out = [];
    for (const it of blds) {
      if (it === excl || it.dead) continue;
      const D = defOf(it);
      if (!D || !D.conduit) continue;
      if (it.bld && it.bld.progress < 1) continue; // 施工中不傳電、不供電
      const p = posOf(it);
      out.push({
        e: it,
        x: p.x,
        z: p.z,
        r: this.rtsPowerR(teamId, D),
        root: !!D.conduit.root,
        link: D.conduit.link || RTS_AETH.link,
        on: !!D.conduit.root,
        par: null,
      });
    }
    for (const t of temp || [])
      out.push({ e: null, temp: t, x: t.x, z: t.z, r: t.r, root: true, link: 0, on: true, par: null });
    // 廣度優先：節點接到 link 內有電的供電源（節點通常 < 30 個，O(n²)）
    const q = out.filter((s) => s.on);
    while (q.length) {
      const a = q.shift();
      for (const s of out) {
        if (s.on || s.root) continue;
        if (hyp(s.x - a.x, s.z - a.z) <= s.link) {
          s.on = true;
          s.par = a;
          q.push(s);
        }
      }
    }
    return out;
  },
  // 重算這一隊的供電與停擺（docs 14.2）。info＝{ newOff（這次變成停擺的建築數）, newOn, off（停擺中的合計） }
  rtsPowerRebuild(teamId) {
    const R = this.rts,
      T = R && R.teams[teamId];
    if (!T) return null;
    const P = T.power || (T.power = { srcs: [], temp: [], ver: 0, deps: null });
    const blds = R.units.filter((e) => !e.dead && e.bld && e.rtsTeam === teamId);
    P.srcs = this.rtsPowerCompute(teamId, blds, P.temp, null);
    P.ver++;
    P.deps = null;
    let newOff = 0,
      newOn = 0,
      off = 0;
    for (const b of blds) {
      const D = RTS_DEFS[b.rtsDef];
      if (!D) continue;
      let o = false, // 停擺（只有要電的建築）
        dark = false; // 外觀沒電（停擺的建築、沒接上的節點）
      if (D.needPower) o = dark = !this.rtsPowerAt(teamId, b.pos.x, b.pos.z);
      else if (D.conduit && !D.conduit.root) {
        const s = P.srcs.find((x) => x.e === b);
        dark = s ? !s.on : !this.rtsPowerNear(teamId, b.pos.x, b.pos.z, D.conduit.link || RTS_AETH.link);
      }
      if (o !== !!b.bld.off) {
        if (o) newOff++;
        else newOn++;
      }
      b.bld.off = o;
      b.bld.unp = dark;
      if (o) off++;
      if (b.bld.pw !== !dark) {
        b.bld.pw = !dark;
        if (b.model && b.model.setPower) b.model.setPower(!dark); // B 包：發光熄滅、斷電標示
      }
    }
    const info = { ver: P.ver, newOff, newOn, off };
    syncConduitLinks(this, teamId); // B 包：導管連線（一隊一個網格）
    // E 包：範圍圈與連線重畫、斷電的事件（同一次斷電只發一次）；還沒有時 A 自己提示
    if (this.rtsHudPower) this.rtsHudPower(teamId, info);
    else if (teamId === ME && newOff && R.t > 0) this.rtsSay(`導管中斷：${newOff} 座建築停擺`);
    return info;
  },
  // 涵蓋 (x, z)、有電的供電源（最近的）；沒有＝null
  rtsPowerAt(teamId, x, z) {
    const T = this.rts && this.rts.teams[teamId];
    if (!T || !T.power) return null;
    let best = null,
      bd = 1e9;
    for (const s of T.power.srcs) {
      if (!s.on) continue;
      const d = hyp(s.x - x, s.z - z);
      if (d <= s.r && d < bd) ((bd = d), (best = s));
    }
    return best;
  },
  // r 內有沒有有電的供電源（導管節點的位置）
  rtsPowerNear(teamId, x, z, r) {
    const T = this.rts && this.rts.teams[teamId];
    if (!T || !T.power) return null;
    for (const s of T.power.srcs) if (s.on && hyp(s.x - x, s.z - z) <= r) return s;
    return null;
  },
  // 建造的限制（rtsPlace、建造預覽、rtsAutoSpot）：'' 或原因
  rtsPowerWhy(teamId, defId, x, z) {
    const D = RTS_DEFS[defId];
    if (!D || D.kind !== 'bld') return '';
    if (D.needPower && !this.rtsPowerAt(teamId, x, z)) return '要蓋在導管範圍內';
    if (D.conduit && !D.conduit.root) {
      const L = D.conduit.link || RTS_AETH.link;
      if (!this.rtsPowerNear(teamId, x, z, L)) return `導管節點要在有電的導管 ${L} m 內`;
    }
    return '';
  },
  // 這個供電源被拆掉時會停擺幾座建築（F 包的進攻目標）。blds＝改用這份建築清單（電腦對手：記得的敵方建築，
  // rtsFogKnown 的紀錄 { def, x, z } 或實體）；沒給時用實際的狀態（結果快取到下一次重算）
  rtsPowerDeps(b, blds = null) {
    const R = this.rts;
    if (!R || !b) return 0;
    const D = defOf(b);
    if (!D || !D.conduit) return 0;
    const teamId = b.rtsTeam !== undefined ? b.rtsTeam : b.team;
    const T = R.teams[teamId];
    if (!T) return 0;
    const P = T.power;
    if (!blds && P.deps && P.deps.has(b)) return P.deps.get(b);
    const list = blds || R.units.filter((e) => !e.dead && e.bld && e.rtsTeam === teamId);
    const temp = blds ? [] : P.temp;
    const a = this.rtsPowerCompute(teamId, list, temp, null);
    const c = this.rtsPowerCompute(teamId, list, temp, b);
    const cov = (srcs, it) => {
      const p = posOf(it);
      return srcs.some((s) => s.on && hyp(s.x - p.x, s.z - p.z) <= s.r);
    };
    let n = 0;
    for (const it of list) {
      if (it === b || it.dead) continue;
      const E = defOf(it);
      if (E && E.needPower && cov(a, it) && !cov(c, it)) n++;
    }
    if (!blds) (P.deps || (P.deps = new Map())).set(b, n);
    return n;
  },
  // 有電與沒電的範圍（E 包畫範圍圈）：[{ x, z, r, on }]
  rtsPowerFields(teamId) {
    const T = this.rts && this.rts.teams[teamId];
    return T && T.power ? T.power.srcs.map((s) => ({ x: s.x, z: s.z, r: s.r, on: s.on, root: s.root })) : [];
  },
  // 導管的連線（B 包畫貼地的發光管）：[[a, b, on]]，a／b＝{ x, z }；有電的節點連到讓它有電的供電源，
  // 沒電的節點連到 link 內最近的供電源（沒有就不連）
  rtsPowerLinks(teamId) {
    const T = this.rts && this.rts.teams[teamId];
    if (!T || !T.power) return [];
    const out = [];
    for (const s of T.power.srcs) {
      if (s.root) continue;
      let p = s.par;
      if (!p) {
        let bd = 1e9;
        for (const o of T.power.srcs) {
          if (o === s) continue;
          const d = hyp(o.x - s.x, o.z - s.z);
          if (d <= s.link && d < bd) ((bd = d), (p = o));
        }
      }
      if (p) out.push([{ x: p.x, z: p.z }, { x: s.x, z: s.z }, !!s.on]);
    }
    return out;
  },
  // 臨時導管（道具「攜帶式導管」，C 包）：一個沒有實體的根，sec 秒後到期（到期時重算，沒有其他供電的建築停擺）
  rtsPowerAddTemp(teamId, x, z, r, sec) {
    const R = this.rts,
      T = R && R.teams[teamId];
    if (!T) return null;
    const t = { x, z, r, t: R.t + sec };
    T.power.temp.push(t);
    this.rtsPowerRebuild(teamId);
    return t;
  },
  // 停擺中（斷電或電磁脈衝）：HUD、商店（C 包）用
  rtsBldOff(b) {
    return !!(b && b.bld && (b.bld.off || b.bld.empT > ((this.rts && this.rts.t) || 0)));
  },
  // 每格：每 0.5 秒臨時導管到期、導管上的加成（單位的 buff、建築的回血）
  rtsPowerTick(dt) {
    const R = this.rts;
    R.powT -= dt;
    if (R.powT > 0) return;
    const tick = RTS_AETH.tick;
    R.powT += tick;
    if (R.powT < 0) R.powT = tick;
    for (const T of R.teams) {
      if (!T || !T.power) continue;
      const P = T.power;
      if (P.temp.length && P.temp.some((t) => t.t <= R.t)) {
        P.temp = P.temp.filter((t) => t.t > R.t);
        this.rtsPowerRebuild(T.id);
      }
    }
    for (const e of R.units) {
      if (e.dead || e.rtsInv) continue;
      const tm = e.rtsTeam;
      if (!this.rtsPowerTeam(tm)) continue;
      const up = this.rtsResLv(tm, 'r_grid') ? 1 : 0;
      if (!this.rtsPowerAt(tm, e.pos.x, e.pos.z)) continue;
      if (e.bld) {
        // 建築：在有電的範圍裡、8 秒沒受傷才回血（停擺的本來就不在範圍裡）
        if (e.bld.progress < 1 || e.hp >= e.maxHp) continue;
        if (R.t - (e.rtsHurtT !== undefined ? e.rtsHurtT : -1e9) < RTS_AETH.calm) continue;
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * RTS_AETH.bldRegen[up] * tick);
        continue;
      }
      const D = RTS_DEFS[e.rtsDef] || {};
      const b = { src: 'grid', regen: RTS_AETH.regen[up], speed: RTS_AETH.speed[up] };
      // 共振砲：站在導管上射程 +16（研究共振校準 +24）
      if (D.gridRange) b.range = D.gridRange + (this.rtsResLv(tm, 'r_reson') ? RTS_AETH.resonAdd : 0);
      this.rtsBuff(e, b, tick + 0.1);
    }
  },

  // ---------- 建築的技能（rtsOrder 的 ability 對選取中的建築） ----------
  // 回傳 true＝施放了
  rtsBldAbility(b, ab, o = {}) {
    if (ab === 'ab_aegis') return this.rtsFactionAegis(b);
    // 維爾威（rts-veer.js，docs 15.3）：緊急補給（地點）、收起／展開、物流交易（卡片另外有 pack／trade 的動作）
    if (ab === 'ab_supply') return !!(this.rtsVeerSupply && this.rtsVeerSupply(b, o.x, o.z));
    if (ab === 'ab_pack') return !!(this.rtsPack && b && b.bld && !b.bld.packed && this.rtsPack(b));
    if (ab === 'ab_trade') return !!(this.rtsTrade && b && this.rtsTrade(b.rtsTeam, o.dir || 'buy'));
    // 聖域（rts-sancta.js，docs 16.2）：避難警報、解除避難（瞭望塔與避難屋的「放出工人」只放出那一座的）
    if (ab === 'ab_shelter') return !!(this.rtsShelter && this.rtsShelter(b));
    if (ab === 'ab_unshelter') return !!(this.rtsUnshelter && (this.rtsUnshelter(b), true));
    return !!(b && b.rtsAethAb && b.rtsAethAb(ab, o)); // 其他建築技能（B 包）
  },
  // 結晶護壁不能施放的原因（''＝可以）
  rtsFactionAegisWhy(hq) {
    const R = this.rts;
    if (!R || !hq || hq.dead || !hq.bld) return '沒有研究中樞';
    const A = RTS_DEFS[hq.rtsDef];
    if (!A || !(A.abil || []).includes('ab_aegis')) return '這座建築不能施放';
    if (hq.bld.progress < 1) return '建築還沒蓋好';
    const cd = hq.rtsCd && hq.rtsCd.ab_aegis;
    if (cd > R.t) return `冷卻中（${Math.ceil(cd - R.t)} 秒）`;
    const cost = RTS_ABILS.ab_aegis.coral || 0;
    if ((R.teams[hq.rtsTeam].coral || 0) < cost) return 'Coral 不足';
    return '';
  },
  // 結晶護壁：36 m 內（到佔地邊緣）的己方建築 15 秒受到的傷害減半（buff 的 taken）
  rtsFactionAegis(hq) {
    const R = this.rts;
    const why = this.rtsFactionAegisWhy(hq);
    if (why) {
      if (hq && hq.rtsTeam === ME) this.rtsSay('結晶護壁：' + why);
      return false;
    }
    const A = RTS_ABILS.ab_aegis;
    const G = RTS_AETH.aegis;
    R.teams[hq.rtsTeam].coral -= A.coral || 0;
    (hq.rtsCd || (hq.rtsCd = {})).ab_aegis = R.t + (A.cd || 0);
    let n = 0;
    for (const b of R.units) {
      if (b.dead || !b.bld || b.rtsTeam !== hq.rtsTeam) continue;
      const d = Math.max(0, hyp(b.pos.x - hq.pos.x, b.pos.z - hq.pos.z) - Math.max(b.bld.w, b.bld.d) / 2);
      if (d > G.r) continue;
      this.rtsBuff(b, { src: 'aegis', taken: G.taken }, G.t);
      b.rtsAegisT = R.t + G.t; // B 包的外觀（結晶外殼）可以看這個
      n++;
      if (this.rtsFxOk(b.pos)) this.fx.flash(b.center(), Math.max(b.bld.w, b.bld.d) * 0.4, 0x8fd8ff, 0.4);
    }
    if (this.rtsFxOk(hq.pos)) this.fx.ring(hq.pos.clone().setY(hq.pos.y + 0.4), G.r, 0x8fd8ff);
    SFX.play('door', 0.5, 1.4, 0.05, 0.03, hq.center());
    if (hq.rtsTeam === ME) this.rtsSay(`結晶護壁：${n} 座建築 ${G.t} 秒受到的傷害減半`, 0x8fd8ff);
    return true;
  },

  // ---------- 實驗體融合（docs 14.2） ----------
  // 融合不能進行的原因（''＝可以）：需求；units 給了時另外看夠不夠一組、Coral
  rtsFuseWhy(teamId, recipeId, units = null) {
    const F = RTS_FUSE[recipeId];
    if (!F) return '沒有這個配方';
    const why = this.rtsReqWhy(teamId, F);
    if (why) return why;
    if (units) {
      const n = units.filter(
        (e) => e && !e.dead && e.rtsDef === F.from && !e.rtsIllus && !e.rtsTemp && !e.rtsFusing,
      ).length;
      if (n < F.n) return `需要 ${F.n} 隻${(RTS_DEFS[F.from] || {}).name || ''}（選了 ${n} 隻）`;
    }
    const T = this.rts.teams[teamId];
    if ((T.coral || 0) < F.coral) return 'Coral 不足';
    return '';
  },
  // 選取中可以分成幾組（HUD 的說明）：{ groups: [[實體…]…], left（多出來的） }
  rtsFuseGroups(units, recipeId) {
    const F = RTS_FUSE[recipeId];
    if (!F) return { groups: [], left: [] };
    const pool = units.filter(
      (e) => e && !e.dead && e.rtsDef === F.from && !e.rtsIllus && !e.rtsTemp && !e.rtsFusing,
    );
    const groups = [],
      left = [];
    // 貪婪：每次取「最邊緣」的一台（離全部的重心最遠），配上離它最近的 n−1 台；組內最遠兩台超過上限就留下它
    while (pool.length >= F.n) {
      let cx = 0,
        cz = 0;
      for (const e of pool) ((cx += e.pos.x), (cz += e.pos.z));
      cx /= pool.length;
      cz /= pool.length;
      let si = 0,
        sd = -1;
      pool.forEach((e, i) => {
        const d = hyp(e.pos.x - cx, e.pos.z - cz);
        if (d > sd) ((sd = d), (si = i));
      });
      const seed = pool[si];
      const near = pool
        .filter((e) => e !== seed)
        .sort(
          (a, b) =>
            hyp(a.pos.x - seed.pos.x, a.pos.z - seed.pos.z) - hyp(b.pos.x - seed.pos.x, b.pos.z - seed.pos.z),
        )
        .slice(0, F.n - 1);
      const g = [seed, ...near];
      let far = 0;
      for (const a of g) for (const b of g) far = Math.max(far, hyp(a.pos.x - b.pos.x, a.pos.z - b.pos.z));
      if (far > RTS_AETH.fuseGroup) {
        left.push(seed);
        pool.splice(si, 1);
        continue;
      }
      groups.push(g);
      for (const e of g) pool.splice(pool.indexOf(e), 1);
    }
    left.push(...pool);
    return { groups, left };
  },
  // 下融合指令（rtsOrder 的 { k: 'fuse', recipe }）：分組、每組離重心最近的一台是宿主（指令 { k: 'fuse', recipe, mats, fid }），
  // 其他走向宿主（{ k: 'fuseTo', id, fid }）。回傳組數
  rtsFuseIssue(units, recipeId) {
    const R = this.rts,
      F = RTS_FUSE[recipeId];
    if (!R || !F || !units.length) return 0;
    const team = units[0].rtsTeam;
    const me = team === ME;
    const why = this.rtsReqWhy(team, F);
    if (why) return (me && this.rtsSay('融合：' + why), 0);
    const { groups, left } = this.rtsFuseGroups(units, recipeId);
    const name = (RTS_DEFS[F.from] || {}).name || '';
    if (!groups.length) {
      if (me) this.rtsSay(`融合：需要 ${F.n} 隻${name}（還差 ${F.n - (left.length % F.n)} 隻）`);
      return 0;
    }
    for (const g of groups) {
      let cx = 0,
        cz = 0;
      for (const e of g) ((cx += e.pos.x), (cz += e.pos.z));
      cx /= g.length;
      cz /= g.length;
      let host = g[0],
        bd = 1e9;
      for (const e of g) {
        const d = hyp(e.pos.x - cx, e.pos.z - cz);
        if (d < bd) ((bd = d), (host = e));
      }
      const mats = g.filter((e) => e !== host);
      const fid = ++R.fuseN;
      const ho = { k: 'fuse', recipe: recipeId, mats: mats.map((e) => e.id), fid };
      R.fuses.push({ id: fid, team, recipe: recipeId, host, mats, st: 'gather', t0: R.t, ho, hpK: 1 });
      host.rtsFusing = fid;
      this.rtsSetOrders(host, [ho]);
      for (const m of mats) {
        m.rtsFusing = fid;
        this.rtsSetOrders(m, [{ k: 'fuseTo', id: host.id, fid }]);
      }
    }
    if (me && left.length)
      this.rtsSay(
        `融合：${groups.length} 組；剩下 ${left.length} 隻${name}不夠一組（還差 ${F.n - (left.length % F.n)} 隻）`,
        0xffd070,
      );
    return groups.length;
  },
  rtsFuseOf(fid) {
    return (this.rts && this.rts.fuses.find((f) => f.id === fid)) || null;
  },
  // 指令的執行（mech-rts.js 的 'fuse'／'fuseTo'）：宿主原地等（引導中不動）、材料走向宿主；回傳 true＝指令結束
  rtsFuseStep(e, o, dt) {
    const f = this.rtsFuseOf(o.fid);
    if (!f || f.done) return true;
    if (o.k === 'fuseTo') {
      const h = f.host;
      if (!h || h.dead) return true;
      const r = RTS_AETH.fuseR + (h.radius || 1) + (e.radius || 1) - 0.6;
      if (hyp(h.pos.x - e.pos.x, h.pos.z - e.pos.z) > r) e.rtsGo(h.pos.x, h.pos.z, r * 0.7, dt, null, false);
      return false;
    }
    return false; // 宿主：等材料、引導
  },
  // 每格：集合（10 秒內沒到齊＝取消、不扣款）→ 引導（宿主受到的傷害 ×1.25、被擊破＝全部損失）→ 完成
  rtsFuseTick() {
    const R = this.rts;
    if (!R.fuses.length) return;
    for (const f of R.fuses.slice()) {
      const F = RTS_FUSE[f.recipe];
      const me = f.team === ME;
      const h = f.host;
      if (f.st === 'gather') {
        const quit = (why) => {
          this.rtsFuseDrop(f);
          if (me && why) this.rtsSay('融合取消：' + why);
        };
        if (!h || h.dead) {
          quit('宿主被擊破');
          continue;
        }
        if (h.orders[0] !== f.ho) {
          quit('');
          continue;
        }
        if (f.mats.some((m) => m.dead || !m.orders[0] || m.orders[0].fid !== f.id)) {
          quit(f.mats.some((m) => m.dead) ? '材料被擊破' : '');
          continue;
        }
        if (R.t - f.t0 > RTS_AETH.fuseWait) {
          quit('材料沒有到齊');
          continue;
        }
        const near = f.mats.every(
          (m) =>
            hyp(m.pos.x - h.pos.x, m.pos.z - h.pos.z) <= RTS_AETH.fuseR + (h.radius || 1) + (m.radius || 1),
        );
        if (!near) continue;
        // 開始引導：扣 Coral、材料移除（不給經驗、不算陣亡）、宿主不能移動、受到的傷害 ×1.25
        if (!this.rtsPay(f.team, { coral: F.coral })) {
          quit('Coral 不足');
          continue;
        }
        const all = [h, ...f.mats];
        f.hpK = all.reduce((a, e) => a + Math.max(0, e.hp) / Math.max(1, e.maxHp), 0) / all.length;
        for (const m of f.mats) {
          m.rtsQuiet = true;
          m.rtsFusing = null;
          m.die(null);
        }
        R.stats[f.team].fused += f.mats.length + 1;
        h.rtsPopFuse = (RTS_DEFS[F.to] || {}).pop || 0;
        this.rtsBuff(h, { src: 'fuse', taken: RTS_AETH.fuseTaken }, F.time + 1);
        f.st = 'chan';
        f.end = R.t + F.time;
        this.rtsRecount();
        if (h.rtsAethFuseFx)
          h.rtsAethFuseFx(F, F.time); // B 包：引導的特效與動作
        else if (this.rtsFxOk(h.pos)) this.fx.ring(h.pos.clone().setY(h.pos.y + 0.3), 4, 0x8fd8ff);
        continue;
      }
      // 引導中
      if (!h || h.dead) {
        f.done = true;
        R.fuses.splice(R.fuses.indexOf(f), 1);
        if (me && this.rtsEvent) this.rtsEvent(h ? h.pos.x : 0, h ? h.pos.z : 0, '融合失敗：宿主被擊破');
        continue;
      }
      if (h.orders[0] !== f.ho) this.rtsSetOrders(h, [f.ho]); // 引導中不接其他指令
      if (R.t >= f.end) this.rtsFuseFinish(f);
    }
  },
  // 取消一組（集合中）：清掉指令與標記
  rtsFuseDrop(f) {
    const R = this.rts;
    f.done = true;
    const i = R.fuses.indexOf(f);
    if (i >= 0) R.fuses.splice(i, 1);
    for (const e of [f.host, ...f.mats]) {
      if (!e || e.dead || e.rtsFusing !== f.id) continue;
      e.rtsFusing = null;
      if (e.orders[0] && e.orders[0].fid === f.id) this.rtsSetOrders(e, []);
    }
  },
  // 完成（引導結束，或 C 包 CURATOR 的「催化」：傳宿主實體立刻完成）：宿主換成結果的新實體。回傳新的實體
  rtsFuseFinish(f) {
    const R = this.rts;
    if (f && f.rtsDef !== undefined) f = R.fuses.find((x) => x.host === f && x.st === 'chan');
    if (!f || f.done) return null;
    f.done = true;
    R.fuses.splice(R.fuses.indexOf(f), 1);
    return this.rtsFuseMake(f.team, f.recipe, [f.host], { hpK: f.hpK, free: true });
  },
  // 直接產生融合的結果（rtsFuseFinish；C 包的「群體融合」：免費、沒有引導、不看需求）：mats 全部安靜移除，
  // 結果出現在宿主（第一台）的位置；o.hpK＝血量比例（沒給時取材料的平均）、o.free＝不扣 Coral。回傳新的實體
  rtsFuseMake(teamId, recipeId, mats, o = {}) {
    const R = this.rts,
      F = RTS_FUSE[recipeId];
    if (!R || !F || !mats.length) return null;
    if (!o.free && !this.rtsPay(teamId, { coral: F.coral })) return null;
    const h = mats[0];
    const hpK =
      o.hpK !== undefined
        ? o.hpK
        : mats.reduce((a, e) => a + Math.max(0, e.hp) / Math.max(1, e.maxHp), 0) / mats.length;
    const x = h.pos.x,
      z = h.pos.z,
      yaw = h.yaw;
    for (const m of mats) {
      m.rtsQuiet = true;
      m.rtsFusing = null;
      if (!m.dead) m.die(null);
    }
    if (o.hpK === undefined) R.stats[teamId].fused += mats.length;
    const e = this.rtsSpawn(teamId, F.to, x, z, yaw);
    if (!e) return null;
    R.stats[teamId].made--; // 融合不算生產
    e.hp = Math.max(1, e.maxHp * Math.max(0.05, Math.min(1, hpK)));
    e.rtsFusedFrom = recipeId;
    // 選取與編隊：換成新的實體
    const swap = (L) => {
      if (!L) return;
      let put = false;
      for (let i = L.length - 1; i >= 0; i--)
        if (mats.includes(L[i])) {
          if (!put) ((L[i] = e), (put = true));
          else L.splice(i, 1);
        }
    };
    swap(R.sel);
    for (const k in R.groups) swap(R.groups[k]);
    this.rtsRecount();
    const c = e.center();
    if (this.rtsFxOk(c)) {
      this.fx.flash(c, 3, 0x8fd8ff, 0.3);
      this.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), 5, 0x8fd8ff);
    }
    if (teamId === ME) {
      const txt = '融合完成：' + ((RTS_DEFS[F.to] || {}).name || F.to);
      if (this.rtsEvent) this.rtsEvent(x, z, txt);
      this.rtsSay(txt, 0x8fd8ff);
    }
    if (this.rtsHudDirty !== undefined) this.rtsHudDirty = true;
    return e;
  },

  // ---------- 幻象（docs 14.2：B 的投影、C 的英雄分身共用） ----------
  // src 的定義 rtsSpawn 一台同外觀的實體；o＝{ sec（秒，預設 15）, dmg（傷害倍率，0＝只有外觀）, taken（受到的傷害）,
  // hp（指定最大血量：投影＝1）, team（預設 src 的隊伍） }。回傳實體（e.rtsIllus＝{ t 到期, dmg, taken, src }）
  rtsIllusion(src, x, z, o = {}) {
    const R = this.rts;
    if (!R || !src || src.bld || !src.rtsDef) return null;
    const team = o.team !== undefined ? o.team : src.rtsTeam;
    const e = this.rtsSpawn(team, src.rtsDef, x, z, src.yaw);
    if (!e) return null;
    R.stats[team].made--;
    e.rtsQuiet = true; // 擊破不給經驗、不掉寶、不算戰績
    const dmg = o.dmg !== undefined ? o.dmg : 0;
    const taken = o.taken !== undefined ? o.taken : 1;
    e.rtsIllus = { t: R.t + (o.sec !== undefined ? o.sec : 15), dmg, taken, src: src.id };
    if (o.hp) e.rtsBase.hp = o.hp;
    e.rtsMods.buff.push({ src: 'illus', dmg, taken }); // 沒有 t＝不會過期
    this.rtsModsApply(e);
    e.hp = e.maxHp;
    if (this.rtsHeroIllusionInit) this.rtsHeroIllusionInit(e, src); // C 包：英雄的幻象套回等級的數值
    const L = R.illus[team] || (R.illus[team] = []);
    L.push(e);
    while (L.length > RTS_AETH.illusMax) this.rtsIllusionEnd(L.shift());
    for (let i = L.length - 1; i >= 0; i--) if (L[i].dead) L.splice(i, 1);
    this.rtsRecount();
    return e;
  },
  // 幻象消失（到期、超過上限、被打掉都一樣：安靜移除）
  rtsIllusionEnd(e) {
    if (!e || e.dead) return;
    e.rtsQuiet = true;
    const c = e.center();
    if (this.rtsFxOk(c)) this.fx.flash(c, 1.4, 0x8fd8ff, 0.2);
    e.die(null);
  },
  // 這一隊的幻象（活著的）
  rtsIllusionsOf(teamId) {
    const L = this.rts && this.rts.illus[teamId];
    return L ? L.filter((e) => !e.dead) : [];
  },
});
