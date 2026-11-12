'use strict';
const { nativeImage } = require('electron');

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideRoundRect(x, y, r) {
  // 单位正方形内的圆角矩形
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

/** 程序化绘制图标（蓝色圆角方块 + 白色对勾），避免依赖外部图片文件 */
function drawBitmap(size) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 3;
  const check = [
    [0.27, 0.53],
    [0.43, 0.69],
    [0.74, 0.34],
  ];
  const half = 0.055;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (!insideRoundRect(x, y, 0.22)) continue;
          a++;
          const onCheck =
            distToSegment(x, y, check[0][0], check[0][1], check[1][0], check[1][1]) <= half ||
            distToSegment(x, y, check[1][0], check[1][1], check[2][0], check[2][1]) <= half;
          if (onCheck) {
            r += 255;
            g += 255;
            b += 255;
          } else {
            r += 79;
            g += 124;
            b += 255;
          }
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      // BGRA，预乘 alpha
      buf[i] = Math.round(b / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(r / n);
      buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return buf;
}

function createWindowIcon() {
  return nativeImage.createFromBitmap(drawBitmap(64), { width: 64, height: 64 });
}

function createTrayIcon() {
  return nativeImage.createFromBitmap(drawBitmap(32), { width: 32, height: 32, scaleFactor: 2 });
}

module.exports = { createWindowIcon, createTrayIcon };
