// 水面系統共用的 GLSL（docs/water-design.md）

// 地形高度貼圖（bakeTerrain：整張地圖＋遠景一圈，Float、最近取樣）：手動雙線性內插。
// terM＝(左下角 x, z, 一格的公尺數, 每邊的點數)
export const TER_GLSL = /* glsl */ `
uniform sampler2D tTer;
uniform vec4 terM;
float terH(vec2 p) {
  vec2 f = clamp((p - terM.xy) / terM.z, vec2(0.0), vec2(terM.w - 1.001));
  vec2 i = floor(f), u = f - i;
  float inv = 1.0 / terM.w;
  vec2 c = (i + 0.5) * inv;
  float a = texture2D(tTer, c).r, b = texture2D(tTer, c + vec2(inv, 0.0)).r;
  float d = texture2D(tTer, c + vec2(0.0, inv)).r, e = texture2D(tTer, c + vec2(inv, inv)).r;
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}
`;

// 全畫面的四邊形（模擬的各 pass）
export const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
