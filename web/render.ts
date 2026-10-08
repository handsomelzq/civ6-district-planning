/** 渲染层。**不实现任何产出规则** —— 屏幕上每一个数字都来自 `evaluate()`。
 *
 * 这条分工是架构的地基（GDD §1）。渲染层唯一被允许的"计算"是两次求值结果相减
 * （悬停预览），而那两次都是求值器算的。
 */
import { type Axial, key, distance, DIRS } from "../src/hex.ts";
import { cityTerritoryOwner, type BoardState, type Tile } from "../src/board.ts";
import { type Rules } from "../src/rules.ts";
import { type YieldTree, type Leaf } from "../src/evaluate.ts";
import { fmt, isZero, type Rat, cmp, sub, add, ZERO } from "../src/rational.ts";
import { localIconSrc } from "./local_icons.ts";

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

const hexCorners = (cx: number, cy: number): { x: number; y: number }[] => {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 90);
    pts.push({ x: cx + SIZE * Math.cos(a), y: cy + SIZE * Math.sin(a) });
  }
  return pts;
};

/** `河流边=true` 是配置里的压缩字段；渲染时将一组相邻河流格画成一条连续折线。 */
const riverComponents = (b: BoardState): Axial[][] => {
  const marked = new Set([...b.tiles.entries()]
    .filter(([, tile]) => tile.河流边)
    .map(([id]) => id));
  const components: Axial[][] = [];
  while (marked.size) {
    const startId = marked.values().next().value as string;
    marked.delete(startId);
    const queue = [startId];
    const ids = [startId];
    while (queue.length) {
      const [q, r] = queue.shift()!.split(",").map(Number);
      for (const dir of DIRS) {
        const nextId = key({ q: q + dir.q, r: r + dir.r });
        if (!marked.has(nextId)) continue;
        marked.delete(nextId);
        queue.push(nextId);
        ids.push(nextId);
      }
    }
    components.push(ids.map((id) => {
      const [q, r] = id.split(",").map(Number);
      return { q, r };
    }));
  }
  return components;
};

const riverPath = (component: Axial[]): Axial[] | undefined => {
  if (component.length < 2) return component;
  const ids = new Set(component.map(key));
  const neighbors = (p: Axial): Axial[] => DIRS
    .map((dir) => ({ q: p.q + dir.q, r: p.r + dir.r }))
    .filter((next) => ids.has(key(next)));
  const degree = new Map(component.map((p) => [key(p), neighbors(p).length]));
  // 分叉水系需要多条支流，不能强行压成一条错误的路径；预设河道是线性水系。
  if ([...degree.values()].some((n) => n > 2)) return undefined;
  const start = component.find((p) => degree.get(key(p)) === 1) ?? component[0];
  const path: Axial[] = [];
  let current = start;
  let previous: Axial | undefined;
  const visited = new Set<string>();
  while (!visited.has(key(current))) {
    visited.add(key(current));
    path.push(current);
    const next = neighbors(current).find((candidate) =>
      key(candidate) !== (previous ? key(previous) : ""));
    if (!next) break;
    previous = current;
    current = next;
  }
  return path.length === component.length ? path : undefined;
};

/** 将中心路径偏移到六边格边界附近，避免每段河流各自绘制而产生视觉断点。 */
const riverPolyline = (path: Axial[]): string => path.map((p, index) => {
  const here = hexCenter(p);
  const prev = path[index - 1] ? hexCenter(path[index - 1]) : undefined;
  const next = path[index + 1] ? hexCenter(path[index + 1]) : undefined;
  const from = prev ?? here;
  const to = next ?? here;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const offset = SIZE * 0.92;
  const x = here.x - (dy / len) * offset;
  const y = here.y + (dx / len) * offset;
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}).join(" ");

const riverEdges = (b: BoardState): string[] => {
  const paths: string[] = [];
  for (const component of riverComponents(b)) {
    const path = riverPath(component);
    if (path) {
      paths.push(riverPolyline(path));
      continue;
    }
    // 编辑器允许临时画出分叉水系：退化为逐条相邻边，但不会影响正式预设的连续河道。
    const seen = new Set<string>();
    for (const p of component) for (let i = 0; i < DIRS.length; i += 1) {
      const next = { q: p.q + DIRS[i].q, r: p.r + DIRS[i].r };
      const nextId = key(next);
      if (!b.tiles.get(nextId)?.河流边) continue;
      const edgeKey = [key(p), nextId].sort().join("|");
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      const here = hexCenter(p);
      const target = hexCenter(next);
      paths.push(`${here.x.toFixed(1)},${here.y.toFixed(1)} ${target.x.toFixed(1)},${target.y.toFixed(1)}`);
    }
  }
  return paths;
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
const ALL_YIELDS = ["科技", "文化", "金币", "生产力", "信仰", "粮食"];
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
  readonly selectedCity?: string;
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
  const rivers = riverEdges(b).map((points) =>
    `<polyline points="${points}" class="river-edge"/>`).join("");
  for (const p of coords.sort((a, z) => a.r - z.r || a.q - z.q)) {
    const k = key(p);
    const t = b.tiles.get(k)!;
    const c = hexCenter(p);
    const fill = TERRAIN_FILL[t.地形] ?? "#555";
    const isSel = o.selected && key(o.selected) === k;
    const isHov = o.hovered && key(o.hovered) === k;
    const blockedWhy = o.blocked?.get(k);
    const territory = cityTerritoryOwner(b, p);
    const neutral = b.城市?.length && !territory;
    const cls = ["hex", neutral ? "neutral" : "", territory ? `territory-${territory}` : "",
                 blockedWhy ? "blocked" : "", isSel ? "sel" : "",
                 isHov ? "hov" : ""].filter(Boolean).join(" ");
    parts.push(`<g class="${cls}" data-xy="${k}"${territory ? ` data-city-territory="${esc(territory)}"` : ""}>`);
    parts.push(`<polygon points="${hexPoints(c.x, c.y)}" fill="${fill}"/>`);
    if (t.湖泊) parts.push(`<polygon points="${hexPoints(c.x, c.y)}" class="lake-surface"/>`);
    const terrainIcon = localIconSrc(t.地形);
    if (terrainIcon) {
      parts.push(`<image class="terrain-icon" href="${terrainIcon}" aria-label="${esc(rules.name(t.地形))}" x="${(c.x - 24).toFixed(1)}" y="${(c.y + 6).toFixed(1)}" width="16" height="16"/>`);
    }
    if (t.地貌) {
      const featureIcon = localIconSrc(t.地貌);
      if (featureIcon) parts.push(`<image class="feature-icon" href="${featureIcon}" aria-label="${esc(rules.name(t.地貌))}" x="${(c.x - 22).toFixed(1)}" y="${(c.y - 24).toFixed(1)}" width="22" height="22"/>`);
      else parts.push(`<text x="${c.x.toFixed(1)}" y="${(c.y - 8).toFixed(1)}" class="feat">${FEATURE_MARK[t.地貌]}</text>`);
    }
    if (t.资源) {
      const resourceIcon = localIconSrc(t.资源);
      if (resourceIcon) {
        parts.push(`<image class="resource-icon" href="${resourceIcon}" x="${(c.x + 6).toFixed(1)}" y="${(c.y - 22).toFixed(1)}" width="22" height="22"/>`);
      } else {
        parts.push(`<circle cx="${(c.x + 14).toFixed(1)}" cy="${(c.y - 12).toFixed(1)}" r="4" class="res"/>`);
      }
    }
    if (t.自然奇观 || t.世界奇观) {
      const wonderIcon = localIconSrc(t.世界奇观 ?? t.自然奇观 ?? "");
      if (wonderIcon) parts.push(`<image href="${wonderIcon}" x="${(c.x - 24).toFixed(1)}" y="${(c.y - 25).toFixed(1)}" width="22" height="22"/>`);
      else parts.push(`<text x="${(c.x - 16).toFixed(1)}" y="${(c.y - 10).toFixed(1)}" class="wonder">★</text>`);
    }
    if (t.区域) {
      const did = rules.effective(t.区域, b.文明);
      const nm = rules.name(did);
      const isCenter = did === "DISTRICT_CITY_CENTER";
      const chosen = isCenter && t.所属城市 === o.selectedCity;
      parts.push(`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${SIZE * 0.62}" class="dist ${isCenter ? "center" : ""} ${chosen ? "chosen" : ""}"/>`);
      const districtIcon = localIconSrc(did);
      if (districtIcon) {
        parts.push(`<image href="${districtIcon}" x="${(c.x - 17).toFixed(1)}" y="${(c.y - 19).toFixed(1)}" width="34" height="34"/>`);
        parts.push(`<text x="${c.x.toFixed(1)}" y="${(c.y + 20).toFixed(1)}" class="dname2">${esc(nm.slice(0, 5))}</text>`);
      } else {
        parts.push(`<text x="${c.x.toFixed(1)}" y="${(c.y + 1).toFixed(1)}" class="dname">${esc(nm.slice(0, 2))}</text>`);
        if (nm.length > 2) parts.push(`<text x="${c.x.toFixed(1)}" y="${(c.y + 13).toFixed(1)}" class="dname2">${esc(nm.slice(2, 5))}</text>`);
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
  return `<svg viewBox="${(minX - pad).toFixed(0)} ${(minY - pad).toFixed(0)} ${(maxX - minX + pad * 2).toFixed(0)} ${(maxY - minY + pad * 2).toFixed(0)}"><g class="river-layer">${rivers}</g>${parts.join("")}</svg>`;
}

// ── 产出汇总 ──────────────────────────────────────────────────────────
export function renderTotals(tree: YieldTree, 高亮?: string): string {
  const rows = ALL_YIELDS.map((y): [string, Rat] => [y, tree.合计.get(y) ?? ZERO])
    .sort((a, z) => cmp(z[1], a[1]));
  return rows.map(([y, v]) =>
    `<div class="tot ${y === 高亮 ? "hi" : ""}" data-yield="${esc(y)}">
       <span class="dot" style="background:${yieldColor(y)}"></span>
       <span class="yname">${esc(y)}</span><b>${fmt(v)}</b></div>`).join("");
}

// ── 拆解面板：按地图区块汇集区域、建筑与各产出，仅展示非零贡献 ──────
export function renderBreakdown(tree: YieldTree, 只看?: string, 显示规则id = false): string {
  type Entry = { yieldType: string; source: string; leaf: Leaf };
  const groups = new Map<string, { pos?: Axial; total: Map<string, Rat>; entries: Entry[] }>();
  for (const y of tree.产出) {
    if (只看 && y.产出类型 !== 只看) continue;
    for (const s of y.来源) for (const leaf of s.叶子) {
      if (isZero(leaf.增量)) continue;
      const k = s.位置 ? key(s.位置) : `global:${s.来源id}`;
      const group = groups.get(k) ?? { pos: s.位置, total: new Map<string, Rat>(), entries: [] };
      group.total.set(y.产出类型, add(group.total.get(y.产出类型) ?? ZERO, leaf.增量));
      group.entries.push({ yieldType: y.产出类型, source: s.来源, leaf });
      groups.set(k, group);
    }
  }
  if (!groups.size) return `<div class="muted">当前没有生效的加成</div>`;
  return [...groups].sort(([a], [b]) => a.localeCompare(b, "zh-CN", { numeric: true }))
    .map(([id, group]) => {
      const title = group.pos ? `区块 (${group.pos.q}, ${group.pos.r})` : "全局加成";
      const sums = [...group.total].filter(([, v]) => !isZero(v)).map(([y, v]) =>
        `<span class="bd-sum" style="--yield:${yieldColor(y)}">${esc(y)} ${v.n > 0 ? "+" : ""}${fmt(v)}</span>`).join("");
      const entries = group.entries.map(({ yieldType, source, leaf }) =>
        `<div class="bd-entry"><div class="bd-entry-top"><span>${esc(source)} · ${esc(yieldType)}</span><b style="color:${yieldColor(yieldType)}">${leaf.增量.n > 0 ? "+" : ""}${fmt(leaf.增量)}</b></div>
        <div class="bd-explain">${esc(leaf.说明)}</div>
        ${显示规则id ? `<div class="bd-rule" title="${esc(leaf.规则id)}">${esc(leaf.规则id)}</div>` : ""}</div>`).join("");
      return `<article class="bd-tile" data-xy="${esc(id)}"><div class="bd-tile-head"><b>${title}</b><div class="bd-sums">${sums}</div></div>${entries}</article>`;
    }).join("");
}

/** 悬停预览：两次求值结果的差。**渲染层唯一被允许的"计算"**。 */
export const deltaOf = (before: Rat, after: Rat): Rat => sub(after, before);
export { ZERO };
