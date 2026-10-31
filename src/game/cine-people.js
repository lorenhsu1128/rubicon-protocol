// Game：過場動畫的人物（docs/cinematics.md 的「人物」）。
//  - human：一個人（GLB 骨架動畫，src/assets/people/ 與格納庫的 worker／crew／soldier），照劇本走、換動作、轉向
//  - people：一群人（人數、範圍、往哪裡走、各自錯開），遠景的可以用程式的小人（render/crowd-model.js）
//  位置與動作都由鏡頭時間 lt 直接算出來（不累積），所以暫停、跳時間、慢動作都一致。
//  人一律是真實尺寸（身高約 1.75 m，docs/world-scale.md），不跟著劇本座標的倍率放大；素材還沒載入時改用程式的小人。
import { makeRng } from '../core/math.js';
import { CrowdMesh } from '../render/crowd-model.js';
import { HA, PA, haChar } from '../render/hangar-assets.js';
import { Game } from './game.js';

const HUMAN_H = 1.75;
const WALK_V = 1.35; // 走路 m/s
const RUN_V = 3.8; // 跑步 m/s
const ONCE = new Set(['Death', 'HitRecieve', 'Standing', 'Sitting']); // 只播一次、停在最後
const D2R = Math.PI / 180;
// 格納庫的人物原本的身高（HA.glb 沒有量）
const H_HANGAR = { worker: 1.85, crew: 1.9, soldier: 1.85 };
// 沒有素材時程式小人的顏色（上衣、褲子；線性值）
const LOOK = {
  biz: [0x1a1c24, 0x14161c],
  suitw: [0x101014, 0x101014],
  mansuit: [0x1c2030, 0x161820],
  hoodie: [0x6a5a9a, 0x2a3a5a],
  farmer: [0x5a6a8a, 0x5a3a20],
  casual: [0x8a8a80, 0x1a2228],
  hooded: [0x4a2a14, 0x1a1a1a],
  pilot: [0x1a5a7a, 0x101418],
  man: [0x6a4a3a, 0x2a2a3a],
  woman: [0x2a1418, 0x14182a],
  womanc: [0x7a6a5a, 0x2a2a34],
  worker: [0x8a7a10, 0x2a2a30],
  crew: [0xc0c4c8, 0xa0a4a8],
  soldier: [0x22262a, 0x22262a],
};
const SKIN = [0xb08060, 0x8a5a3a, 0xd0a080, 0x5a3a24];
const hasGlb = (who) => !!(HA.glb[who] && (PA.h[who] || H_HANGAR[who]));

Object.assign(Game.prototype, {
  // 演員 A 已經有 id／spec／t0；pos＝劇本的位置（世界座標）
  cineHumAdd(A, spec, pos) {
    const c = this.cine;
    const K = (c.set && c.set.k) || 1;
    const fyaw = (c.set && c.set.yaw) || 0;
    const root = new THREE.Group();
    root.position.copy(pos);
    this.scene.add(root);
    A.obj = root;
    A.hum = [];
    const rng = makeRng(spec.seed || 1 + spec.id.length * 97);
    const whoList = [].concat(spec.who || 'man');
    const n = spec.k === 'people' ? spec.n || 8 : 1;
    // 遠景或沒有素材：程式的小人（一個 InstancedMesh 組）
    const far = spec.far || !whoList.some(hasGlb);
    if (far) {
      A.cm = new CrowdMesh(n);
      this.scene.add(A.cm.group);
    }
    const area = spec.r != null ? spec.r : 3;
    for (let i = 0; i < n; i++) {
      const who = whoList[Math.floor(rng() * whoList.length)];
      let x = 0,
        z = 0;
      if (spec.k === 'people') {
        if (spec.box) {
          x = (rng() - 0.5) * spec.box[0];
          z = (rng() - 0.5) * spec.box[1];
        } else {
          const a = rng() * Math.PI * 2,
            r = Math.sqrt(rng()) * area;
          x = Math.cos(a) * r;
          z = Math.sin(a) * r;
        }
      }
      // 劇本座標 → 世界（沿鐵路的場景會旋轉）
      const rx = (u, v) => (fyaw ? u * Math.cos(fyaw) + v * Math.sin(fyaw) : u),
        rz = (u, v) => (fyaw ? -u * Math.sin(fyaw) + v * Math.cos(fyaw) : v);
      const p0 = new THREE.Vector3(pos.x + rx(x * K, z * K), pos.y, pos.z + rz(x * K, z * K));
      // 路線：一群人＝整群往 go 位移；一個人＝劇本 s 裡的 go（從那一刻的位置走過去）
      const legs = [];
      const sp = (spec.speed || 1) * (spec.k === 'people' ? 0.85 + rng() * 0.3 : 1);
      if (spec.k === 'people' && spec.go) {
        const d = new THREE.Vector3(
          rx(spec.go[0] * K, spec.go[1] * K),
          0,
          rz(spec.go[0] * K, spec.go[1] * K),
        );
        legs.push({
          t: (spec.stagger || 0) * rng() + (spec.goT || 0),
          to: p0.clone().add(d),
          run: !!spec.run,
        });
      }
      for (const st of spec.s || [])
        if (st.go) {
          const g = this.cinePt({ g: st.go, h: 0 });
          legs.push({ t: st.t, to: new THREE.Vector3(g.x, pos.y, g.z), run: !!st.run });
        }
      const yaw0 =
        spec.k === 'people' && spec.face === 'rnd'
          ? rng() * Math.PI * 2
          : (spec.yaw || 0) * D2R + fyaw + (spec.k === 'people' ? (rng() - 0.5) * (spec.yawRnd || 0.6) : 0);
      const anims = [].concat(spec.anim || 'Idle');
      const H = {
        who,
        p0,
        legs,
        sp,
        yaw: yaw0,
        y: p0.y,
        anim: anims[Math.floor(rng() * anims.length)],
        ph: rng(),
        cur: '',
        i,
      };
      if (far) {
        A.cm.setLook(i, {
          shirt: (LOOK[who] || LOOK.man)[0],
          pants: (LOOK[who] || LOOK.man)[1],
          skin: SKIN[Math.floor(rng() * SKIN.length)],
          hat: null,
        });
      } else {
        const name = hasGlb(who) ? who : whoList.find(hasGlb);
        const ch = haChar(name);
        H.ch = ch;
        const h0 = PA.h[name] || H_HANGAR[name] || 1.8;
        ch.g.scale.setScalar(((spec.scale || 1) * HUMAN_H * (0.94 + rng() * 0.1)) / h0);
        this.cineHumLook(ch, spec);
        this.scene.add(ch.g);
      }
      A.hum.push(H);
    }
    // 頭部（鏡頭的 { a: id } 對準這裡）：第一個人的頭
    A.head = new THREE.Object3D();
    this.scene.add(A.head);
    this.cineHumTick(A, 0, 0);
  },
  // 外觀：tint＝{ 材質名稱: 顏色 }、dark＝剪影（0～1，逆光、看不清楚臉）
  cineHumLook(ch, spec) {
    if (!spec.tint && !spec.dark) return;
    const cache = new Map();
    ch.g.traverse((o) => {
      if (!o.isMesh) return;
      const one = (m) => {
        if (cache.has(m)) return cache.get(m);
        const n = m.clone();
        if (spec.tint && spec.tint[m.name] != null) n.color.setHex(spec.tint[m.name]);
        if (spec.dark) n.color.lerp(new THREE.Color(0x030304), spec.dark);
        cache.set(m, n);
        return n;
      };
      o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
    });
  },
  // 每格：位置、朝向、動作（lt＝這個演員出現後的秒數；dt 只給動作的混合）
  cineHumTick(A, dt, lt) {
    const w = this.world;
    const spec = A.spec;
    let hy = 0;
    for (const H of A.hum) {
      // 依時間走完每一段路線
      const p = H.p0.clone();
      let moving = false,
        run = false,
        dir = null;
      for (let j = 0; j < H.legs.length; j++) {
        const L = H.legs[j];
        if (lt <= L.t) break;
        const next = H.legs[j + 1];
        const until = next ? Math.min(lt, next.t) : lt;
        const v = (L.run ? RUN_V : WALK_V) * H.sp;
        const d = new THREE.Vector3(L.to.x - p.x, 0, L.to.z - p.z);
        const len = d.length();
        const go = Math.min(len, v * (until - L.t));
        if (len > 1e-3) {
          d.multiplyScalar(1 / len);
          p.addScaledVector(d, go);
          if (until === lt && go < len - 1e-3) {
            moving = true;
            run = L.run;
            dir = d;
          } else if (len > 0.05) dir = d;
        }
      }
      // 貼地（高台、橋面上的也照樣站在上面：從劇本給的高度往下找）；ground: false＝照劇本的高度（掛勾自己建的場景）
      if (w && spec.ground !== false) H.y = w.groundAt(p.x, p.z, H.p0.y + 3);
      else H.y = H.p0.y;
      p.y = H.y;
      if (dir) H.yaw = Math.atan2(dir.x, dir.z);
      // 轉向：face 步驟（演員或點）
      const face = this.cineHumFace(A, lt);
      if (face && !moving) H.yaw = Math.atan2(face.x - p.x, face.z - p.z);
      const anim = moving ? (run ? 'Run' : 'Walk') : this.cineHumAnim(A, H, lt);
      if (H.ch) {
        const g = H.ch.g;
        g.position.copy(p);
        // A.turn／A.headTurn：掛勾設定的轉身與轉頭（弧度，例如第 5 章的會議桌轉頭看鏡頭）
        g.rotation.y = H.yaw + (A.turn || 0);
        if (anim !== H.cur) {
          H.ch.act(anim, H.cur ? 0.3 : 0);
          const a = H.ch.acts[anim];
          if (a) {
            if (ONCE.has(anim)) {
              a.setLoop(THREE.LoopOnce, 1);
              a.clampWhenFinished = true;
            } else if (!H.cur) a.time = H.ph * a.getClip().duration; // 一群人的動作錯開
          }
          H.cur = anim;
        }
        H.ch.mixer.update(dt);
        if (A.headTurn) {
          if (H.head === undefined) H.head = H.ch.bone('Head') || null;
          if (H.head) H.head.rotateY(A.headTurn); // 骨頭的 Y 軸沿著脖子：繞它轉＝轉頭
        }
        g.visible = A.obj.visible;
      } else if (A.cm) {
        const t = lt * (run ? 2.6 : 1.8) + H.ph * 6;
        A.cm.pose(
          H.i,
          {
            x: p.x,
            y: p.y,
            z: p.z,
            yaw: H.yaw,
            sw: moving ? Math.sin(t * Math.PI) : 0,
            run: run ? 1 : 0,
            crouch: anim === 'Sitting' ? 0.6 : 0,
            work: anim === 'Interact' ? 1 : 0,
            wave: anim === 'Wave' ? 1 : 0,
            aim: anim === 'Idle_Gun_Pointing' ? 1 : 0,
            lean: 0,
          },
          false,
        );
      }
      if (H.i === 0) {
        A.head.position.set(p.x, p.y + HUMAN_H * 0.92 * (spec.scale || 1), p.z);
        hy = p.y;
      }
    }
    if (A.cm) {
      A.cm.commit(A.hum.length);
      A.cm.group.visible = A.obj.visible;
    }
    A.obj.position.y = hy;
  },
  // 目前的動作：劇本 s 裡最後一個 anim（沒有就用 spec.anim）
  cineHumAnim(A, H, lt) {
    let a = H.anim;
    for (const st of A.spec.s || []) if (st.t <= lt && st.anim) a = st.anim;
    return a;
  },
  cineHumFace(A, lt) {
    let f = null;
    for (const st of A.spec.s || []) if (st.t <= lt && st.face !== undefined) f = st.face;
    if (f == null) return null;
    if (typeof f === 'string') return this.cineAimPt(f);
    return this.cinePt(f.length === 3 ? f : { g: f, h: 0 }); // [x, z]＝地面上的點、[x, y, z]＝劇本座標
  },
  cineHumDrop(A) {
    for (const H of A.hum || []) if (H.ch) this.scene.remove(H.ch.g);
    if (A.cm) {
      this.scene.remove(A.cm.group);
      A.cm.dispose();
    }
    if (A.head) this.scene.remove(A.head);
  },
});
