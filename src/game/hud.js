// Game：HUD 繪製與訊息提示
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { clamp } from '../core/math.js';
import { CONSUMABLES } from '../data/parts.js';
import { PICKUP_DEFS } from '../world/map-extras.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  drawSpectateHud(dt) {
    const c = this.hctx;
    const W = innerWidth,
      H = innerHeight;
    c.clearRect(0, 0, W, H);
    const p = this.player;
    if (!p) return;
    document.getElementById('hudTop').innerHTML =
      `<div><b>觀戰</b>　${escHtml(this.levelName)}</div><div id="objective">殘存敵軍 ${this.clientAlive || 0}${this.clientWaves ? ' （尚有增援）' : ''} ｜ ${this.missionT.toFixed(0)}s</div><div class="dim" style="font-size:11px">鏡頭 <b>${{ follow: '跟隨', director: '導演', all: '全景', free: '自由', boss: '魔王' }[this.specMode || 'follow']}</b>　V：第一人稱　C／1–5：切換模式　Tab／點擊玩家：換人　滾輪：縮放　D：${this.specDetail ? '隱藏' : '顯示'}細節</div>`;
    document.getElementById('hudBottom').style.display = 'none';
    document.getElementById('weapons').style.display = 'none';
    document.getElementById('lockHint').textContent =
      this.specMode === 'all'
        ? '全景'
        : this.specMode === 'free'
          ? '自由視角（拖曳平移）'
          : `${this.specMode === 'director' ? '導演' : this.specMode === 'boss' ? '魔王' : '跟隨'} ▸ ${p.name}`;
    // 敵人血條 / 名牌（沿用）
    for (const e of [...this.enemies, ...this.allies]) {
      if (e.dead || e.noLock) continue;
      const s = this.proj(e.center());
      if (!s.in) continue;
      const r = 22 * (e.scale || 1);
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(0,0,0,.5)';
      c.beginPath();
      c.arc(s.x, s.y - r - 6, r * 0.9, Math.PI * 1.1, Math.PI * 1.9);
      c.stroke();
      c.strokeStyle = e.team === 'ally' ? '#80ffb0' : '#fff';
      c.beginPath();
      c.arc(
        s.x,
        s.y - r - 6,
        r * 0.9,
        Math.PI * 1.1,
        Math.PI * 1.1 + Math.PI * 0.8 * clamp(e.hp / e.maxHp, 0, 1),
      );
      c.stroke();
      c.font = '11px Chakra Petch';
      c.fillStyle = 'rgba(255,255,255,.8)';
      c.textAlign = 'center';
      c.fillText(e.name, s.x, s.y - r - 14);
    }
    // 玩家列表與名牌
    let y = 118;
    c.textAlign = 'left';
    for (const q of this.players) {
      const col = this.net.slotColor(q.slot);
      const foc = q === p;
      c.fillStyle = foc ? 'rgba(255,176,32,.25)' : 'rgba(8,12,18,.55)';
      c.fillRect(16, y - 14, this.specDetail ? 300 : 190, this.specDetail ? 62 : 32);
      c.font = 'bold 13px Chakra Petch';
      c.fillStyle = col;
      c.fillText(
        (foc ? '▶ ' : '') +
          q.name +
          (q.dead ? '  ✖' : q.downed ? '  倒地 ' + Math.ceil(q.downT) + 's' : q.aiControlled ? '  (AI)' : ''),
        22,
        y,
      );
      c.fillStyle = 'rgba(0,0,0,.5)';
      c.fillRect(22, y + 5, 170, 6);
      c.fillStyle = q.downed ? '#ff4d4d' : col;
      c.fillRect(22, y + 5, 170 * clamp(q.hp / q.maxHp, 0, 1), 6);
      if (this.specDetail) {
        c.font = '10px Chakra Petch';
        c.fillStyle = '#cfd6e0';
        const w = q.weapons;
        const wl = ['rarm', 'larm', 'rback', 'lback']
          .map((s) => {
            const d = w[s].def;
            if (d.type === 'none') return null;
            return d.name.split(' ')[0] + (d.mag < 99 ? ` ${w[s].mag}/${w[s].ammo}` : '');
          })
          .filter(Boolean)
          .join('  ');
        c.fillText(
          `AP ${Math.round(q.hp)}/${q.maxHp}  EN ${Math.round(q.en)}  ACS ${Math.round(q.acs)}/${q.acsMax}  套件 ${q.kits}`,
          22,
          y + 24,
        );
        c.fillText(wl, 22, y + 38);
        c.fillText(
          `鎖定：${q.lock ? q.lock.name : '—'}　${q.melee.active ? '近戰 ' + (q.melee.stage + 1) + ' 段' : q.boost ? '推進' : q.hover ? '懸浮' : q.moving ? '移動' : '待機'}`,
          22,
          y + 52,
        );
      }
      y += this.specDetail ? 72 : 40;
      const s = this.proj(q.center());
      if (s.in && !q.dead) {
        c.font = 'bold 12px Chakra Petch';
        c.textAlign = 'center';
        c.fillStyle = col;
        c.fillText(q.name, s.x, s.y - 40);
        c.textAlign = 'left';
      }
    }
    // 傷害數字
    for (const q of this.popups) {
      const s = this.proj(q.pos);
      if (!s.in) continue;
      c.font = (q.melee ? 'bold 22px' : q.val >= 400 ? 'bold 16px' : 'bold 12px') + ' Chakra Petch';
      c.textAlign = 'center';
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(0,0,0,.7)';
      c.strokeText(String(q.val), s.x, s.y);
      c.fillStyle = q.onPlayer ? '#ff5a5a' : q.melee ? '#ff9a3c' : q.val >= 400 ? '#ffb020' : '#fff';
      c.fillText(String(q.val), s.x, s.y);
    }
    if (this.bosses && this.bosses.length) {
      const hp = this.bosses.reduce((a, b) => a + Math.max(0, b.hp), 0),
        mx = this.bosses.reduce((a, b) => a + b.maxHp, 0);
      document.getElementById('bossHp').style.width = clamp((hp / mx) * 100, 0, 100) + '%';
    }
  },
  flashMsg(txt, color = 0xffb020, dur = 1.4) {
    this.netEv({ t: 'msg', txt, c: color, d: dur });
    const m = document.getElementById('msg');
    m.textContent = txt;
    m.style.color = '#' + color.toString(16).padStart(6, '0');
    m.classList.add('on');
    clearTimeout(this._mt);
    this._mt = setTimeout(() => m.classList.remove('on'), dur * 1000);
  },
  flashAlert(txt) {
    this.netEv({ t: 'alert', txt });
    SFX.alert();
    const a = document.getElementById('alert');
    a.textContent = txt;
    a.classList.add('on');
    clearTimeout(this._at);
    this._at = setTimeout(() => a.classList.remove('on'), 1500);
  },
  popDamage(pos, val, onPlayer, stag, melee, combo, targetId, impact) {
    this.popups.push({ pos: pos.clone(), val, life: melee ? 1.0 : 0.8, onPlayer, stag, melee, combo });
    if (targetId !== undefined)
      this.netEv({
        t: 'pop',
        p: [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)],
        v: val,
        s: !!stag,
        m: !!melee,
        c: combo || 0,
        i: targetId,
        im: impact || 0,
      });
  },

  // ---------- HUD ----------
  renderWeaponHud(force) {
    const p = this.player;
    const el = document.getElementById('weapons');
    const keys = this.padActive
        ? {
            rarm: this.padLabel(this.padmap.fireR),
            larm: this.padLabel(this.padmap.fireL),
            rback: this.padLabel(this.padmap.backR),
            lback: this.padLabel(this.padmap.backL),
          }
        : {
            rarm: this.keyLabel(this.keymap.fireR),
            larm: this.keyLabel(this.keymap.fireL),
            rback: this.keyLabel(this.keymap.backR),
            lback: this.keyLabel(this.keymap.backL),
          },
      labels = { rarm: '右手', larm: '左手', rback: '右背', lback: '左背' };
    if (force || !el.children.length) {
      el.innerHTML =
        ['larm', 'rarm', 'lback', 'rback']
          .map(
            (s) =>
              `<div class="wslot" id="ws_${s}"><b>${labels[s]}</b><em>—</em><span class="k">${keys[s]}</span><div class="rl"></div></div>`,
          )
          .join('') +
        ['c1', 'c2']
          .map(
            (s, i) =>
              `<div class="wslot cs" id="ws_${s}"><b>消耗品</b><em>—</em><span class="k">${this.keyLabel(this.keymap[s === 'c1' ? 'cs1' : 'cs2'])}</span><div class="rl"></div></div>`,
          )
          .join('');
    }
    for (const s of ['larm', 'rarm', 'lback', 'rback']) {
      const w = p.weapons[s];
      const d = document.getElementById('ws_' + s);
      if (!d) continue;
      d.classList.toggle('empty', w.def.type === 'none');
      let txt;
      if (w.def.type === 'none') txt = '—';
      else if (w.def.type === 'melee')
        txt =
          p.melee.active && p.melee.slot === s
            ? `連擊 ${p.melee.stage + 1}/${w.def.combo.length}`
            : `${w.def.combo.length} 段連擊`;
      else if (w.def.type === 'shield') txt = '盾 (被動)';
      else if (w.def.type === 'emp') txt = w.cd > 0 ? `冷卻 ${Math.ceil(w.cd)}s` : '就緒';
      else if (w.def.type === 'empbeam')
        txt = p.empLock ? '過載 (等 EN 回滿)' : w.firing ? '發射中' : 'EN 供能';
      else if (w.def.mag >= 99)
        txt = w.charging ? '蓄力 ' + Math.round(clamp(w.charge / w.def.chargeT, 0, 1) * 100) + '%' : '∞';
      else txt = (w.reloadT > 0 ? '裝填中' : w.mag) + ' / ' + w.ammo;
      d.querySelector('b').textContent = labels[s] + ' ' + w.def.name.split(' ')[0];
      d.querySelector('em').textContent = txt;
      d.querySelector('.rl').style.width =
        (w.reloadT > 0 ? (1 - w.reloadT / w.def.reload) * 100 : w.cd > 0 ? (1 - w.cd / w.def.rof) * 100 : 0) +
        '%';
    }
    for (const s of ['c1', 'c2']) {
      const d = document.getElementById('ws_' + s);
      if (!d) continue;
      const id = this.save.asm[s];
      const def = CONSUMABLES.find((c) => c.id === id);
      const n = (this.save.items && this.save.items[id]) || 0;
      d.classList.toggle('empty', !def || id === 'cs_none' || n <= 0);
      d.querySelector('b').textContent = def && id !== 'cs_none' ? def.name.split(' ')[0] : '消耗品';
      d.querySelector('em').textContent = def && id !== 'cs_none' ? '×' + n : '—';
      const cd = (this.csCd && this.csCd[s]) || 0;
      d.querySelector('.rl').style.width = (cd > 0 ? (cd / 4) * 100 : 0) + '%';
    }
  },
  proj(v) {
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((-p.y + 1) / 2) * innerHeight, in: p.z < 1 && p.z > -1 };
  },
  drawHud(dt) {
    const p = this.player,
      c = this.hctx,
      W = innerWidth,
      H = innerHeight;
    c.clearRect(0, 0, W, H);
    // bars
    document.getElementById('hpBar').style.width = clamp((p.hp / p.maxHp) * 100, 0, 100) + '%';
    document.getElementById('hpTxt').textContent = `${Math.max(0, Math.round(p.hp))} / ${p.maxHp}`;
    document.getElementById('enBar').style.width = clamp((p.en / p.enMax) * 100, 0, 100) + '%';
    const acsBar = document.getElementById('acsBar');
    acsBar.style.width = clamp((p.acs / p.acsMax) * 100, 0, 100) + '%';
    acsBar.classList.toggle('guard', p.stagGuardT > 0); // 失衡後保護中
    document.getElementById('kits').innerHTML =
      `修復套件 <b>${'▮'.repeat(p.kits)}${'▯'.repeat(Math.max(0, (p.kitsMax || 3) - p.kits))}</b>　<span class="dim">[R]</span>`;
    const alive = this.isClient ? this.clientAlive || 0 : this.enemies.filter((e) => !e.dead).length;
    const wavesLeft = this.isClient ? this.clientWaves || 0 : this.waves.length;
    document.getElementById('hudTop').innerHTML =
      `<b>${this.isBossLevel ? '決戰任務' : '任務'} ${String(this.save.level).padStart(2, '0')}</b> ｜ ${escHtml(this.levelName)}<div id="objective">殘存敵軍 ${alive}${wavesLeft ? ' （尚有增援）' : ''} ｜ ${this.missionT.toFixed(0)}s</div><div style="color:var(--acc)">COAM ${this.save.coam.toLocaleString()} <span class="dim">（本次 +${(this.missionEarned || 0).toLocaleString()}）</span></div>`;
    if (this.bountyPops.length) {
      c.textAlign = 'left';
      c.font = (innerHeight < 540 ? 'bold 11px' : 'bold 16px') + ' Chakra Petch';
      for (let i = this.bountyPops.length - 1; i >= 0; i--) {
        const q = this.bountyPops[i];
        q.life -= dt;
        if (q.life <= 0) {
          this.bountyPops.splice(i, 1);
          continue;
        }
        c.globalAlpha = clamp(q.life, 0, 1);
        c.lineWidth = 3;
        c.strokeStyle = 'rgba(0,0,0,.7)';
        const by = document.body.classList.contains('vpad') ? (innerHeight < 540 ? 150 : 200) : 110;
        c.strokeText(q.txt, 18, by + i * 20 - (2.2 - q.life) * 10);
        c.fillStyle = '#ffb020';
        c.fillText(q.txt, 18, by + i * 20 - (2.2 - q.life) * 10);
      }
      c.globalAlpha = 1;
    }
    if (this.padActive !== this.padActiveHud) {
      this.padActiveHud = this.padActive;
      this.renderWeaponHud(true);
    }
    this.renderWeaponHud(false);
    for (const v of this.vehicles) {
      if (v.dead) continue;
      const s = this.proj(v.center());
      if (!s.in) continue;
      c.fillStyle = 'rgba(0,0,0,.5)';
      c.fillRect(s.x - 30, s.y - 44, 60, 6);
      c.fillStyle = '#ffd070';
      c.fillRect(s.x - 30, s.y - 44, 60 * clamp(v.hp / v.maxHp, 0, 1), 6);
      c.font = 'bold 11px Chakra Petch';
      c.textAlign = 'center';
      c.fillStyle = '#ffd070';
      c.fillText(v.name + ' — 擊破可獲補給', s.x, s.y - 50);
    }
    for (const pk of this.pickups) {
      if (pk.dead) continue;
      const s = this.proj(pk.pos);
      if (!s.in) continue;
      const d = PICKUP_DEFS[pk.kind];
      c.font = 'bold 11px Chakra Petch';
      c.textAlign = 'center';
      c.fillStyle = '#' + d.color.toString(16).padStart(6, '0');
      c.fillText(d.name + (pk.life < 10 ? ` ${Math.ceil(pk.life)}s` : ''), s.x, s.y - 26);
    }
    if (this.bosses && this.bosses.length) {
      const hp = this.bosses.reduce((a, b) => a + Math.max(0, b.hp), 0),
        mx = this.bosses.reduce((a, b) => a + b.maxHp, 0);
      document.getElementById('bossHp').style.width = clamp((hp / mx) * 100, 0, 100) + '%';
    }
    // 隊友列表與方位箭頭
    if (this.net && this.net.role && this.players && this.players.length > 1) {
      let y = document.body.classList.contains('vpad') ? (innerHeight < 540 ? 170 : 250) : 170;
      c.font = 'bold 12px Chakra Petch';
      c.textAlign = 'left';
      for (const q of this.players) {
        if (q === p) continue;
        const col = this.net.slotColor(q.slot);
        c.fillStyle = 'rgba(8,12,18,.55)';
        c.fillRect(16, y - 12, 180, 30);
        c.fillStyle = col;
        c.fillText(
          q.name +
            (q.dead
              ? '  ✖ 退場'
              : q.downed
                ? '  倒地 ' + Math.ceil(q.downT) + 's'
                : q.aiControlled
                  ? '  (AI)'
                  : ''),
          22,
          y,
        );
        c.fillStyle = 'rgba(0,0,0,.5)';
        c.fillRect(22, y + 5, 160, 6);
        c.fillStyle = q.downed ? '#ff4d4d' : col;
        c.fillRect(22, y + 5, 160 * clamp(q.hp / q.maxHp, 0, 1), 6);
        y += 36;
        const s = this.proj(q.center());
        if (!q.dead && (!s.in || s.x < 0 || s.x > W || s.y < 0 || s.y > H)) {
          const cx = W / 2,
            cy = H / 2;
          let dx = s.x - cx,
            dy = s.y - cy;
          if (!s.in) {
            dx = -dx;
            dy = -dy;
          }
          const ang = Math.atan2(dy, dx);
          const m = 44;
          const k = Math.min(
            Math.abs((W / 2 - m) / (Math.cos(ang) || 1e-6)),
            Math.abs((H / 2 - m - 60) / (Math.sin(ang) || 1e-6)),
          );
          const ax = cx + Math.cos(ang) * k,
            ay = cy + Math.sin(ang) * k;
          c.save();
          c.translate(ax, ay);
          c.rotate(ang);
          c.fillStyle = col;
          c.strokeStyle = 'rgba(0,0,0,.7)';
          c.lineWidth = 3;
          c.beginPath();
          c.moveTo(14, 0);
          c.lineTo(-8, -9);
          c.lineTo(-3, 0);
          c.lineTo(-8, 9);
          c.closePath();
          c.stroke();
          c.fill();
          c.restore();
          c.font = 'bold 11px Chakra Petch';
          c.textAlign = 'center';
          c.fillStyle = col;
          c.fillText(
            q.name + ' ' + Math.round(q.pos.distanceTo(p.pos)) + 'm',
            clamp(ax, 60, W - 60),
            ay + (ay < H / 2 ? 30 : -20),
          );
        }
        if (q.downed && !q.dead) {
          const pts = [];
          for (let i = 0; i <= 40; i++) {
            const a2 = (i / 40) * Math.PI * 2;
            pts.push(
              this.proj(
                new THREE.Vector3(q.pos.x + Math.cos(a2) * 5, q.pos.y + 0.1, q.pos.z + Math.sin(a2) * 5),
              ),
            );
          }
          const inR = !p.dead && !p.downed && q.pos.distanceTo(p.pos) < 5;
          c.strokeStyle = inR ? '#7ee081' : 'rgba(126,224,129,.45)';
          c.lineWidth = inR ? 3 : 2;
          c.setLineDash([8, 6]);
          c.beginPath();
          pts.forEach((s3, i) => (i ? c.lineTo(s3.x, s3.y) : c.moveTo(s3.x, s3.y)));
          c.stroke();
          c.setLineDash([]);
          const s2 = this.proj(q.center());
          c.font = 'bold 14px Chakra Petch';
          c.textAlign = 'center';
          c.fillStyle = inR ? '#7ee081' : 'rgba(126,224,129,.7)';
          c.fillText(
            inR
              ? `按 ${this.keyLabel(this.keymap.kit)} 救援`
              : `進入圓圈按 ${this.keyLabel(this.keymap.kit)} 救援`,
            s2.x,
            s2.y - 40,
          );
        }
      }
      if (p.downed) {
        c.font = 'bold 22px Chakra Petch';
        c.textAlign = 'center';
        c.fillStyle = '#ff4d4d';
        c.fillText(`倒地 — 等待救援 ${Math.ceil(p.downT)}s`, W / 2, H * 0.3);
      }
    }
    {
      let hTxt = '';
      if (p.lock) {
        const dy = p.center().y - p.lock.center().y;
        hTxt =
          dy > 1.5
            ? `　▲ 高度優勢 +${Math.round(Math.min(45, dy * 7))}%`
            : dy < -1.5
              ? `　▼ 高度劣勢 −${Math.round(Math.min(45, -dy * 7))}%`
              : '';
      }
      document.getElementById('lockHint').textContent = p.lock
        ? `LOCK ▸ ${p.lock.name}  ${Math.round(p.lock.pos.distanceTo(p.pos))}m${hTxt}`
        : '無鎖定目標';
      document.getElementById('lockHint').style.color = hTxt.includes('▲')
        ? '#7ee081'
        : hTxt.includes('▼')
          ? '#ff8a8a'
          : '';
      if (this.camMode === 'wide')
        document.getElementById('lockHint').textContent += `　⤢ ${this.camZoom.toFixed(1)}×`;
      else if (this.camMode === 'melee') document.getElementById('lockHint').textContent += '　⤡ 近戰視角';
    }
    if (p.melee.active) {
      const d = p.weapons[p.melee.slot].def;
      c.font = 'bold 22px Chakra Petch';
      c.textAlign = 'center';
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(0,0,0,.7)';
      const txt = `${d.combo[p.melee.stage].name}  ${p.melee.stage + 1}/${d.combo.length}`;
      c.strokeText(txt, W / 2, H * 0.68);
      c.fillStyle = '#ff7a30';
      c.fillText(txt, W / 2, H * 0.68);
    }
    // reticle at mouse
    if (this.pvp) this.drawPvpHud(c, W, H, p);
    if (this.fp) {
      this.drawFpHud(c, W, H, p);
    } else {
      let rx = this.mouse.x,
        ry = this.mouse.y;
      if (this.padActive) {
        const s = this.proj(this.mouseWorld);
        rx = s.x;
        ry = s.y;
      }
      c.strokeStyle = 'rgba(255,255,255,.75)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(rx, ry, 10, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.moveTo(rx - 16, ry);
      c.lineTo(rx - 6, ry);
      c.moveTo(rx + 6, ry);
      c.lineTo(rx + 16, ry);
      c.stroke();
    }
    // player ring shadow
    // enemies: hp+acs arcs above head (like reference), lock box
    for (const a of this.allies) {
      if (a.dead) continue;
      const top = a.center();
      top.y = a.pos.y + a.model.height + 0.6;
      const s = this.proj(top);
      if (!s.in) continue;
      const R = 20;
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(0,0,0,.45)';
      c.beginPath();
      c.arc(s.x, s.y + R, R, -Math.PI * 0.85, -Math.PI * 0.15);
      c.stroke();
      c.strokeStyle = '#80ffb0';
      c.beginPath();
      c.arc(s.x, s.y + R, R, -Math.PI * 0.85, -Math.PI * 0.85 + Math.PI * 0.7 * clamp(a.hp / a.maxHp, 0, 1));
      c.stroke();
      c.fillStyle = '#80ffb0';
      c.font = '11px Chakra Petch';
      c.textAlign = 'center';
      c.fillText(a.name + ' ' + Math.max(0, Math.ceil(a.allyT)) + 's', s.x, s.y - 4);
    }
    p.lockT = (p.lockT || 0) + dt;
    const tt = this.time;
    for (const e of this.hostilesOfEnt(p)) {
      if (e.dead || e.noLock) continue; // 迷彩中、分離中、在隧道裡的 Boss 不顯示名牌與畫面外指示
      const top = e.center();
      top.y = e.pos.y + e.model.height + 0.6;
      const s = this.proj(top);
      const isLock = e === p.lock;
      if (!s.in || s.x < 0 || s.x > W || s.y < 0 || s.y > H) {
        // off-screen: edge arrow with name+distance
        const cx = W / 2,
          cy = H / 2;
        let dx = s.x - cx,
          dy = s.y - cy;
        if (!s.in) {
          dx = -dx;
          dy = -dy;
        }
        const ang = Math.atan2(dy, dx);
        const m = 44;
        const tx = clamp(cx + Math.cos(ang) * 9999, m, W - m),
          ty = clamp(cy + Math.sin(ang) * 9999, m + 30, H - m - 90);
        const k = Math.min((tx - cx) / (Math.cos(ang) || 1e-6), (ty - cy) / (Math.sin(ang) || 1e-6));
        const ax = cx + Math.cos(ang) * Math.abs(k),
          ay = cy + Math.sin(ang) * Math.abs(k);
        const col = isLock ? '#ffb020' : e.isBoss ? '#ff4d4d' : '#ffffff';
        const sz = isLock ? 18 : 12;
        c.save();
        c.translate(ax, ay);
        c.rotate(ang);
        c.fillStyle = col;
        c.strokeStyle = 'rgba(0,0,0,.7)';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(sz, 0);
        c.lineTo(-sz * 0.6, -sz * 0.7);
        c.lineTo(-sz * 0.25, 0);
        c.lineTo(-sz * 0.6, sz * 0.7);
        c.closePath();
        c.stroke();
        c.fill();
        c.restore();
        {
          const dist = Math.round(e.pos.distanceTo(p.pos));
          const label = `${e.name} ${dist}m`;
          c.font = 'bold 12px Chakra Petch';
          c.textAlign = 'center';
          const lx = clamp(ax, 70, W - 70),
            ly = ay + (ay < H / 2 ? 32 : -22);
          c.fillStyle = 'rgba(0,0,0,.6)';
          c.fillRect(lx - 58, ly - 12, 116, 17);
          c.fillStyle = col;
          c.fillText(label, lx, ly);
        }
        continue;
      }
      const R = e.isBoss ? 34 : 22;
      const hp = clamp(e.hp / e.maxHp, 0, 1),
        acs = clamp(e.acs / e.acsMax, 0, 1);
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(0,0,0,.45)';
      c.beginPath();
      c.arc(s.x, s.y + R, R, -Math.PI * 0.85, -Math.PI * 0.15);
      c.stroke();
      c.strokeStyle = e.isBoss ? '#ff5a5a' : '#ffffff';
      c.beginPath();
      c.arc(s.x, s.y + R, R, -Math.PI * 0.85, -Math.PI * 0.85 + Math.PI * 0.7 * hp);
      c.stroke();
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(0,0,0,.45)';
      c.beginPath();
      c.arc(s.x, s.y + R, R + 7, -Math.PI * 0.8, -Math.PI * 0.2);
      c.stroke();
      c.strokeStyle = e.staggerT > 0 ? '#ff2a2a' : '#ffb020';
      c.beginPath();
      c.arc(s.x, s.y + R, R + 7, -Math.PI * 0.8, -Math.PI * 0.8 + Math.PI * 0.6 * (e.staggerT > 0 ? 1 : acs));
      c.stroke();
      if (e.staggerT > 0) {
        c.fillStyle = '#ff2a2a';
        c.font = 'bold 11px Chakra Petch';
        c.textAlign = 'center';
        c.fillText('STAGGER', s.x, s.y - 4);
      }
      if (isLock) {
        const cs = this.proj(e.center());
        const base = (e.isBoss ? 56 : 34) * Math.min(1.6, e.scale || 1);
        const bx = base * (1 + Math.max(0, 0.5 - p.lockT) * 1.2);
        const L = bx * 0.45; // animated shrink-in lock box
        c.save();
        c.shadowColor = 'rgba(0,0,0,.8)';
        c.shadowBlur = 4;
        c.strokeStyle = '#ffb020';
        c.lineWidth = 3.5;
        c.beginPath();
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          c.moveTo(cs.x + sx * bx, cs.y + sy * bx - sy * L);
          c.lineTo(cs.x + sx * bx, cs.y + sy * bx);
          c.lineTo(cs.x + sx * bx - sx * L, cs.y + sy * bx);
        }
        c.stroke();
        c.lineWidth = 1.5;
        c.strokeStyle = 'rgba(255,176,32,.55)';
        c.beginPath();
        c.arc(cs.x, cs.y, bx * 1.25, tt * 2, tt * 2 + Math.PI * 0.5);
        c.stroke();
        c.beginPath();
        c.arc(cs.x, cs.y, bx * 1.25, tt * 2 + Math.PI, tt * 2 + Math.PI * 1.5);
        c.stroke();
        c.fillStyle = '#ffb020';
        c.font = 'bold 13px Chakra Petch';
        c.textAlign = 'left';
        c.fillText(e.name + '  ' + Math.round(e.pos.distanceTo(p.pos)) + 'm', cs.x + bx + 8, cs.y - bx + 12);
        c.restore();
      }
    }
    // lock direction pointer around player when lock is off-screen
    if (p.lock) {
      const ls = this.proj(p.lock.center());
      if (!ls.in || ls.x < 0 || ls.x > W || ls.y < 0 || ls.y > H) {
        const ps = this.proj(p.center());
        const d = p.lock.pos.clone().sub(p.pos);
        const sp = this.proj(p.center().add(d.normalize().multiplyScalar(5)));
        const ang = Math.atan2(sp.y - ps.y, sp.x - ps.x);
        c.save();
        c.translate(ps.x + Math.cos(ang) * 70, ps.y + Math.sin(ang) * 70);
        c.rotate(ang);
        c.fillStyle = '#ffb020';
        c.strokeStyle = 'rgba(0,0,0,.7)';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(14, 0);
        c.lineTo(-8, -9);
        c.lineTo(-3, 0);
        c.lineTo(-8, 9);
        c.closePath();
        c.stroke();
        c.fill();
        c.restore();
      }
    }
    // damage popups
    c.textAlign = 'center';
    for (const q of this.popups) {
      const s = this.proj(q.pos);
      if (!s.in) continue;
      const big = q.val >= 400 || q.melee;
      const ph = innerHeight < 540;
      c.font =
        (q.melee
          ? ph
            ? 'bold 16px'
            : 'bold 26px'
          : big
            ? ph
              ? 'bold 13px'
              : 'bold 20px'
            : ph
              ? 'bold 9px'
              : 'bold 13px') + ' Chakra Petch';
      c.globalAlpha = clamp(q.life / 0.4, 0, 1);
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(0,0,0,.6)';
      c.strokeText(q.val, s.x, s.y);
      c.fillStyle = q.onPlayer
        ? '#ff6060'
        : q.melee
          ? '#ff7a30'
          : q.stag
            ? '#ffd060'
            : big
              ? '#ffb020'
              : '#ffffff';
      c.fillText(q.val, s.x, s.y);
      if (q.melee && !q.onPlayer && q.combo > 0) {
        c.font = 'bold 14px Chakra Petch';
        c.strokeText('HIT ×' + q.combo, s.x, s.y + 18);
        c.fillStyle = '#ffe0a0';
        c.fillText('HIT ×' + q.combo, s.x, s.y + 18);
      }
    }
    c.globalAlpha = 1;
    if (this.meleeHitFlash > 0) {
      this.meleeHitFlash -= dt;
      c.fillStyle = 'rgba(255,140,60,' + this.meleeHitFlash * 1.2 + ')';
      c.fillRect(0, 0, W, H);
    }
    // player stagger warning
    if (p.staggerT > 0) {
      c.fillStyle = 'rgba(255,40,40,.12)';
      c.fillRect(0, 0, W, H);
    }
  },
});
