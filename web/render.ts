/** 渲染层。**不实现任何产出规则** —— 屏幕上每一个数字都来自 `evaluate()`。
 *
 * 这条分工是架构的地基（GDD §1）。渲染层唯一被允许的"计算"是两次求值结果相减
 * （悬停预览），而那两次都是求值器算的。
 */
import { type Axial, key, disc } from "../src/hex.ts";
import { type BoardState, type Tile } from "../src/board.ts";
import { type Rules } from "../src/rules.ts";
import { type YieldTree, type Leaf } from "../src/evaluate.ts";
import { fmt, isZero, type Rat, cmp, sub, ZERO } from "../src/rational.ts";

// ── 六边形几何（尖顶，与文档里的 ASCII 地图行列一致）──────────────────
const SIZE = 30;
const SQ3 = Math.sqrt(3);
export const hexCenter = (p: Axial) => ({
  x: SIZE * SQ3 * (p.q + p.r / 2),
  y: SIZE * 1.5 * p.r,
});
const hexPoints = (cx: number, cy: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 90);
    pts.push(`${(cx + SIZE * Math.cos(a)).toFixed(1)},${(cy + SIZE * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
};

// ── 地形配色。只为可读性，不承载规则 ──────────────────────────────────
const TERRAIN_FILL: Record<string, string> = {
  TERRAIN_GRASS: "#4a7a3c", TERRAIN_GRASS_HILLS: "#3f6a33",
  TERRAIN_PLAINS: "#8a7a3e", TERRAIN_PLAINS_HILLS: "#776a34",
  TERRAIN_DESERT: "#b8a05c", TERRAIN_DESERT_HILLS: "#a08d50",
  TERRAIN_TUNDRA: "#7d8a7a", TERRAIN_TUNDRA_HILLS: "#6b776a",
  TERRAIN_SNOW: "#d8dde0", TERRAIN_SNOW_HILLS: "#c3c9cc",
  TERRAIN_COAST: "#3a6e94", TERRAIN_OCEAN: "#1e3f5c",
  TERRAIN_GRASS_MOUNTAIN: "#6b6b6b", TERRAIN_PLAINS_MOUNTAIN: "#726b5f",
  TERRAIN_DESERT_MOUNTAIN: "#8a7f68", TERRAIN_TUNDRA_MOUNTAIN: "#6e7370",
  TERRAIN_SNOW_MOUNTAIN: "#9aa0a3",
};
const FEATURE_MARK: Record<string, string> = {
  FEATURE_FOREST: "♣", FEATURE_JUNGLE: "❋", FEATURE_MARSH: "≈",
  FEATURE_FLOODPLAINS: "~", FEATURE_OASIS: "◉", FEATURE_ICE: "▨",
};
const YIELD_COLOR: Record<string, string> = {
  科技: "#5bb8e8", 文化: "#b57ae0", 金币: "#e0c04a",
  生产力: "#e08a4a", 信仰: "#e8e8f0", 粮食: "#7ad07a",
};
export const yieldColor = (y: string): string => YIELD_COLOR[y] ?? "#aaa";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;");

// ── 地图 ──────────────────────────────────────────────────────────────
export type MapOpts = {
  readonly selected?: Axial;
  readonly hovered?: Axial;
  /** 坐标键 → 该格的预览增量（悬停时算好传进来）。 */
  readonly preview?: ReadonlyMap<string, Rat>;
  readonly 预览产出?: string;
  /** 坐标键 → 不可放置的原因。置灰并显示原因，不做「可点但报错」。 */
  readonly blocked?: ReadonlyMap<string, string>;
};

export function renderMap(rules: Rules, b: BoardState, o: MapOpts = {}): string {
  const coords = [...b.tiles.keys()].map((k) => {
    const [q, r] = k.split(",").map(Number);
    return { q, r };
  });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of coords) {
    const c = hexCenter(p);
    minX = Math.min(minX, c.x - SIZE * SQ3 / 2);
    maxX = Math.max(maxX, c.x + SIZE * SQ3 / 2);
    minY = Math.min(minY, c.y - SIZE);
    maxY = Math.max(maxY, c.y + SIZE);
  }
  const pad = 8;
  const parts: string[] = [];
  for (const p of coords.sort((a, z) => a.r - z.r || a.q - z.q)) {
    const k = key(p);
    const t = b.tiles.get(k)!;
    const c = hexCenter(p);
    const fill = TERRAIN_FILL[t.地形] ?? "#555";
    const isSel = o.selected && key(o.selected) === k;
    const isHov = o.hovered && key(o.hovered) === k;
    const blockedWhy = o.blocked?.get(k);
    const cls = ["hex", blockedWhy ? "blocked" : "", isSel ? "sel" : "",
                 isHov ? "hov" : ""].filter(Boolean).join(" ");
    parts.push(`<g class="${cls}" data-xy="${k}">`);
    parts.push(`<polygon points="${hexPoints(c.x, c.y)}" fill="${fill}"/>`);
    if (t.河流边) {
      parts.push(`<circle cx="${(c.x).toFixed(1)}" cy="${(c.y + SIZE * 0.7).toFixed(1)}" r="3.5" class="river"/>`);
    }
    if (t.地貌 && FEATURE_MARK[t.地貌]) {
      parts.push(`<text x="${c.x.toFixed(1)}" y="${(c.y - 8).toFixed(1)}" class="feat">${FEATURE_MARK[t.地貌]}</text>`);
    }
    if (t.资源) {
      parts.push(`<circle cx="${(c.x + 14).toFixed(1)}" cy="${(c.y - 12).toFixed(1)}" r="4" class="res"/>`);
    }
    if (t.自然奇观 || t.世界奇观) {
      parts.push(`<text x="${(c.x - 16).toFixed(1)}" y="${(c.y - 10).toFixed(1)}" class="wonder">★</text>`);
    }
    if (t.区域) {
      const did = rules.effective(t.区域, b.文明);
      const nm = rules.name(did);
      const isCenter = did === "DISTRICT_CITY_CENTER";
      parts.push(`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${SIZE * 0.62}" class="dist ${isCenter ? "center" : ""}"/>`);
      parts.push(`<text x="${c.x.toFixed(1)}" y="${(c.y + 1).toFixed(1)}" class="dname">${esc(nm.slice(0, 2))}</text>`);
      if (nm.length > 2) {
        parts.push(`<text x="${c.x.toFixed(1)}" y="${(c.y + 13).toFixed(1)}" class="dname2">${esc(nm.slice(2, 5))}</text>`);
      }
      if ((t.建筑?.length ?? 0) > 0) {
        parts.push(`<text x="${c.x.toFixed(1)}" y="${(c.y + 24).toFixed(1)}" class="bcount">▪${t.建筑!.length}</text>`);
      }
    }
    const pv = o.preview?.get(k);
    if (pv !== undefined && !isZero(pv)) {
      const col = yieldColor(o.预览产出 ?? "科技");
      parts.push(`<text x="${c.x.toFixed(1)}" y="${(c.y + 4).toFixed(1)}" class="pv" fill="${col}">+${fmt(pv)}</text>`);
    }
    if (blockedWhy) {
      parts.push(`<polygon points="${hexPoints(c.x, c.y)}" class="veil"/>`);
      parts.push(`<title>${esc(blockedWhy)}</title>`);
    }
    parts.push(`</g>`);
  }
  return `<svg viewBox="${(minX - pad).toFixed(0)} ${(minY - pad).toFixed(0)} ${(maxX - minX + pad * 2).toFixed(0)} ${(maxY - minY + pad * 2).toFixed(0)}">${parts.join("")}</svg>`;
}

// ── 产出汇总 ──────────────────────────────────────────────────────────
export function renderTotals(tree: YieldTree, 高亮?: string): string {
  const rows = [...tree.合计.entries()]
    .filter(([, v]) => !isZero(v))
    .sort((a, z) => cmp(z[1], a[1]));
  if (rows.length === 0) return `<div class="muted">还没有任何产出</div>`;
  return rows.map(([y, v]) =>
    `<div class="tot ${y === 高亮 ? "hi" : ""}" data-yield="${esc(y)}">
       <span class="dot" style="background:${yieldColor(y)}"></span>
       <span class="yname">${esc(y)}</span><b>${fmt(v)}</b></div>`).join("");
}

// ── 拆解面板：固定四层，不可折叠为三层（SDD-自由模式 §3.3）────────────
export function renderBreakdown(tree: YieldTree, 只看?: string): string {
  const out: string[] = [];
  for (const y of tree.产出) {
    if (只看 && y.产出类型 !== 只看) continue;
    if (isZero(y.合计) && !只看) continue;
    out.push(`<div class="bd-yield"><div class="bd-h">
      <span class="dot" style="background:${yieldColor(y.产出类型)}"></span>
      ${esc(y.产出类型)} <b>${fmt(y.合计)}</b></div>`);
    for (const s of y.来源) {
      const pos = s.位置 ? ` @ (${s.位置.q},${s.位置.r})` : "";
      out.push(`<div class="bd-src"><div class="bd-sh">${esc(s.来源)}${pos}
        <b>${fmt(s.合计)}</b></div>`);
      for (const l of [...s.叶子].sort((a, z) => cmp(z.增量, a.增量))) {
        out.push(renderLeaf(l));
      }
      out.push(`</div>`);
    }
    out.push(`</div>`);
  }
  if (out.length === 0) return `<div class="muted">选一种产出，或先放一个区域</div>`;
  return out.join("");
}

function renderLeaf(l: Leaf): string {
  // 增量为 0 的规则**灰显但保留**（求值器边界 E1）：
  // 「为什么没有加成」与「有多少加成」是同等重要的信息。
  const dim = isZero(l.增量) ? " dim" : "";
  const flag = l.未生效 ? `<span class="tag">${esc(l.未生效)}</span>` : "";
  return `<div class="bd-leaf${dim}">
    <span class="lt">${esc(l.说明)}${flag}</span>
    <span class="lv">${isZero(l.增量) ? "—" : "+" + fmt(l.增量)}</span>
    <span class="lid" title="${esc(l.规则id)}">${esc(l.规则id)}</span></div>`;
}

/** 悬停预览：两次求值结果的差。**渲染层唯一被允许的"计算"**。 */
export const deltaOf = (before: Rat, after: Rat): Rat => sub(after, before);
export { ZERO };
