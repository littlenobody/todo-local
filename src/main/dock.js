'use strict';

/*
 * 便笺贴边收起的几何计算。纯函数，不依赖 electron，方便单元测试。
 * 矩形一律是 { x, y, width, height }；显示器是 { id, bounds, workArea }。坐标单位与 Electron 的 DIP 一致。
 * 只支持左、右、上三条边（下边通常是任务栏）。
 */

const SNAP = 12; // 窗口离工作区边缘不超过这个距离，就算“拖到了边缘”
const SLIVER = 6; // 收起后留在屏幕内的宽度，鼠标移到这里就会展开
const EDGES = ['left', 'right', 'top'];

function intersectArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 窗口主要落在哪块显示器上（与 screen.getDisplayMatching 的思路一致） */
function matchDisplay(bounds, displays) {
  let best = displays[0];
  let bestArea = -1;
  for (const d of displays) {
    const area = intersectArea(bounds, d.bounds);
    if (area > bestArea) {
      best = d;
      bestArea = area;
    }
  }
  return best;
}

/** 窗口贴齐某条边时的展开位置 */
function expandedRect(edge, b, area) {
  if (edge === 'left') return { ...b, x: area.x };
  if (edge === 'right') return { ...b, x: area.x + area.width - b.width };
  return { ...b, y: area.y };
}

/** 收起后的位置：只留 sliver 宽度在工作区内 */
function collapsedRect(edge, expanded, area, sliver = SLIVER) {
  if (edge === 'left') return { ...expanded, x: area.x - expanded.width + sliver };
  if (edge === 'right') return { ...expanded, x: area.x + area.width - sliver };
  return { ...expanded, y: area.y - expanded.height + sliver };
}

/**
 * 判断窗口是否靠在可贴边的边缘上。
 * 如果收起后藏起来的那部分会落进相邻的显示器，这条边不可用，否则窗口会“漏”到隔壁屏幕上。
 * 返回 { edge, area, expanded }（expanded 为贴齐边缘后的展开位置），不贴边时返回 null。
 */
function detectDock(bounds, displays, snap = SNAP, sliver = SLIVER) {
  if (!displays || !displays.length) return null;
  const display = matchDisplay(bounds, displays);
  const area = display.workArea;
  const others = displays.filter((d) => d !== display);
  const gap = {
    left: bounds.x - area.x,
    right: area.x + area.width - (bounds.x + bounds.width),
    top: bounds.y - area.y,
  };
  let best = null;
  for (const edge of EDGES) {
    if (gap[edge] > snap) continue;
    const hidden = collapsedRect(edge, expandedRect(edge, bounds, area), area, sliver);
    if (others.some((d) => intersectArea(hidden, d.bounds) > 0)) continue;
    if (!best || gap[edge] < best.gap) best = { edge, gap: gap[edge] };
  }
  if (!best) return null;
  return { edge: best.edge, area, expanded: expandedRect(best.edge, bounds, area) };
}

function pointInRect(p, r, margin = 0) {
  return p.x >= r.x - margin && p.x < r.x + r.width + margin && p.y >= r.y - margin && p.y < r.y + r.height + margin;
}

/** 收起状态下，鼠标是否落在露出的那一条上（沿边缘方向必须在窗口范围内） */
function inHotZone(p, edge, expanded, area, sliver = SLIVER) {
  const reach = sliver + 2; // 比可见的那条稍宽一点，容忍缩放取整造成的偏差
  if (edge === 'left') return p.y >= expanded.y && p.y < expanded.y + expanded.height && p.x < area.x + reach;
  if (edge === 'right') return p.y >= expanded.y && p.y < expanded.y + expanded.height && p.x >= area.x + area.width - reach;
  return p.x >= expanded.x && p.x < expanded.x + expanded.width && p.y < area.y + reach;
}

module.exports = { SNAP, SLIVER, matchDisplay, expandedRect, collapsedRect, detectDock, pointInRect, inHotZone };
