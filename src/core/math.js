// ---------------- utils ----------------
export let RNG = Math.random;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp = (a, b, t) => a + (b - a) * t,
  rnd = (a, b) => a + RNG() * (b - a),
  rndi = (a, b) => Math.floor(rnd(a, b + 1)),
  pick = (a) => a[Math.floor(RNG() * a.length)];
export function withRng(seed, fn) {
  const prev = RNG;
  RNG = makeRng(seed);
  try {
    return fn();
  } finally {
    RNG = prev;
  }
}
export function angLerp(a, b, t) {
  let d = ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}
// seeded rng (for multiplayer-deterministic level props)
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
// seeded value noise
export function makeNoise(seed) {
  let s = seed >>> 0;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const g = [];
  for (let i = 0; i < 256; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      xf = x - xi,
      yf = y - yi;
    const h = (a, b) => g[(a * 73 + b * 151 + a * b * 7) & 255];
    const u = xf * xf * (3 - 2 * xf),
      v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
  };
}
