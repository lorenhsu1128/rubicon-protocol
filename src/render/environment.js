// 程式產生的攝影棚環境貼圖（天空漸層＋暗色地面＋金屬反光用的燈板），遊戲與模型庫共用
export function makeStudioEnv() {
  // procedural studio cubemap: gradient sky, dark floor, bright light panels for metal speculars
  const S = 128;
  const faces = []; // order: +x,-x,+y,-y,+z,-z
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (let f = 0; f < 6; f++) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const img = x.createImageData(S, S);
    const d = img.data;
    for (let j = 0; j < S; j++)
      for (let i = 0; i < S; i++) {
        const u = ((i + 0.5) / S) * 2 - 1,
          v = ((j + 0.5) / S) * 2 - 1;
        let dir;
        switch (f) {
          case 0:
            dir = [1, -v, -u];
            break;
          case 1:
            dir = [-1, -v, u];
            break;
          case 2:
            dir = [u, 1, v];
            break;
          case 3:
            dir = [u, -1, -v];
            break;
          case 4:
            dir = [u, -v, 1];
            break;
          default:
            dir = [-u, -v, -1];
        }
        const L = Math.hypot(...dir);
        const nx = dir[0] / L,
          ny = dir[1] / L,
          nz = dir[2] / L;
        let r, g, b;
        if (ny > 0) {
          const t = Math.min(1, ny * 1.4);
          r = 0.55 + 0.25 * t;
          g = 0.6 + 0.28 * t;
          b = 0.68 + 0.32 * t;
        } else {
          const t = Math.min(1, -ny * 3);
          r = 0.5 - 0.24 * t;
          g = 0.52 - 0.26 * t;
          b = 0.55 - 0.3 * t;
        }
        // light panels
        const panel = (px, py, pz, size, ir, ig, ib) => {
          const dot = nx * px + ny * py + nz * pz;
          if (dot > size) {
            const k = (dot - size) / (1 - size);
            r += ir * k;
            g += ig * k;
            b += ib * k;
          }
        };
        panel(-0.55, 0.7, 0.45, 0.93, 1.6, 1.5, 1.3);
        panel(0.7, 0.5, -0.5, 0.95, 0.9, 1.0, 1.3);
        panel(0.0, -0.25, 0.97, 0.985, 0.6, 0.55, 0.45);
        const k = (j * S + i) * 4;
        d[k] = Math.min(255, r * 255);
        d[k + 1] = Math.min(255, g * 255);
        d[k + 2] = Math.min(255, b * 255);
        d[k + 3] = 255;
      }
    x.putImageData(img, 0, 0);
    faces.push(c);
  }
  const cube = new THREE.CubeTexture(faces);
  cube.needsUpdate = true;
  cube.encoding = THREE.sRGBEncoding;
  cube.mapping = THREE.CubeReflectionMapping;
  cube.generateMipmaps = true;
  cube.minFilter = THREE.LinearMipmapLinearFilter;
  return cube;
}
