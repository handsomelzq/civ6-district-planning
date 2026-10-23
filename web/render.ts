/** 渲染层。**不实现任何产出规则** —— 屏幕上每一个数字都来自 `evaluate()`。
 *
 * 这条分工是架构的地基（GDD §1）。渲染层唯一被允许的"计算"是两次求值结果相减
 * （悬停预览），而那两次都是求值器算的。
 */
import { type Axial, key, distance, DIRS } from "../src/hex.ts";
import { cityTerritoryOwners, type BoardState, type Tile } from "../src/board.ts";
import { type Rules } from "../src/rules.ts";
import { type YieldTree, type Leaf } from "../src/evaluate.ts";
import { fmt, isZero, type Rat, cmp, sub, add, ZERO } from "../src/rational.ts";
import { localIconSrc } from "./local_icons.ts";
import { terrainArtFor, TERRAIN_ART_INSTALLED } from "./terrain_art.ts";

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

/** 压缩临河标记没有记录具体哪条边。沿临河片区的真实外边界选一条开放路线，
 *  不偏移中心线、不穿格、不画封闭水圈，也不凭空补接彼此分离的片区。
 *  这是旧配置的显示适配，不是文明 VI 河流方向数据或完整水系模拟。 */
const riverPolyline = (component: Axial[]): string | undefined => {
  const boundary = new Map<string, [string, string]>();
  const points = new Map<string, { x: number; y: number }>();
  for (const p of component) {
    const c = hexCenter(p);
    const corners = hexCorners(c.x, c.y).map((v) => {
      // 与多边形使用同样的精度；去掉 -0，确保共享顶点是同一个图节点。
      const rounded = { x: Number(v.x.toFixed(1)), y: Number(v.y.toFixed(1)) };
      const id = `${rounded.x},${rounded.y}`;
      points.set(id, rounded);
      return id;
    });
    for (let i = 0; i < 6; i++) {
      const a = corners[i], z = corners[(i + 1) % 6];
      const id = [a, z].sort().join("|");
      // 两格共享的内边不属于片区外轮廓。
      if (boundary.has(id)) boundary.delete(id);
      else boundary.set(id, [a, z]);
    }
  }
  const graph = new Map<string, string[]>();
  for (const [a, z] of boundary.values()) {
    graph.set(a, [...(graph.get(a) ?? []), z]);
    graph.set(z, [...(graph.get(z) ?? []), a]);
  }
  const vertices = [...graph.keys()].sort((a, z) =>
    points.get(a)!.x - points.get(z)!.x || points.get(z)!.y - points.get(a)!.y);
  const start = vertices[0];
  const maxX = points.get(vertices[vertices.length - 1])!.x;
  const end = vertices.find((id) => points.get(id)!.x === maxX)!;
  const previous = new Map<string, string | undefined>([[start, undefined]]);
  const queue = [start];
  for (let i = 0; i < queue.length && !previous.has(end); i++) {
    const here = queue[i];
    for (const next of graph.get(here) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, here);
      queue.push(next);
    }
  }
  if (!previous.has(end)) return undefined;
  const path: string[] = [];
  for (let here: string | undefined = end; here !== undefined; here = previous.get(here)) {
    path.push(here);
  }
  return path.length >= 3 ? path.reverse().join(" ") : undefined;
};

const riverEdges = (b: BoardState): string[] => {
  if (b.河道 !== undefined) return b.河道.map((path) => path.map((v) =>
    `${(v.x * SIZE * SQ3 / 2).toFixed(1)},${(v.y * SIZE / 2).toFixed(1)}`).join(" "));
  return riverComponents(b).map(riverPolyline).filter((path): path is string => path !== undefined);
};

const territoryClass = (id: string): string =>
  `territory-border-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/** 领土内部不画线；外边界按所属城市着色；两城共享边只输出一次。 */
const territoryBorders = (
  b: BoardState, owners: ReadonlyMap<string, string>,
): string[] => {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const [id, owner] of owners) {
    const p = id.split(",").map(Number);
    const center = hexCenter({ q: p[0], r: p[1] });
    const corners = hexCorners(center.x, center.y);
    for (let i = 0; i < DIRS.length; i++) {
      const nextId = key({ q: p[0] + DIRS[i].q, r: p[1] + DIRS[i].r });
      const nextOwner = owners.get(nextId);
      if (nextOwner === owner) continue;
      const edgeId = [id, nextId].sort().join("|");
      if (seen.has(edgeId)) continue;
      seen.add(edgeId);
      // 尖顶六边形方向0..5对应右上、上、左上、左下、下、右下共享边。
      const edgeCorners = [[1, 2], [0, 1], [5, 0], [4, 5], [3, 4], [2, 3]][i];
      const a = corners[edgeCorners[0]], z = corners[edgeCorners[1]];
      lines.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" ` +
        `x2="${z.x.toFixed(1)}" y2="${z.y.toFixed(1)}" ` +
        `class="territory-border ${territoryClass(owner)}"/>`);
    }
  }
  return lines;
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
  /** Optional presentation override; default comes from installed local assets at build time. */
  readonly terrainArt?: boolean;
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
  const clips: string[] = [];
  const useArt = o.terrainArt ?? TERRAIN_ART_INSTALLED;
  const territoryOwners = cityTerritoryOwners(b);
  const borders = territoryBorders(b, territoryOwners).join("");
  const rivers = riverEdges(b).map((points) =>
    `<polyline points="${points}" class="river-edge"/>`).join("");
  for (const p of coords.sort((a, z) => a.r - z.r || a.q - z.q)) {
    const k = key(p);
    const t = b.tiles.get(k)!;
    const c = hexCenter(p);
    const fill = TERRAIN_FILL[t.地形] ?? "#555";
    const art = useArt ? terrainArtFor(t, p) : undefined;
    const isSel = o.selected && key(o.selected) === k;
    const isHov = o.hovered && key(o.hovered) === k;
    const blockedWhy = o.blocked?.get(k);
    const territory = territoryOwners.get(k);
    const neutral = b.城市?.length && !territory;
    const cls = ["hex", neutral ? "neutral" : "", territory ? `territory-${territory}` : "",
                 blockedWhy ? "blocked" : "", isSel ? "sel" : "",
                 isHov ? "hov" : ""].filter(Boolean).join(" ");
    parts.push(`<g class="${cls}" data-xy="${k}"${territory ? ` data-city-territory="${esc(territory)}"` : ""}>`);
    parts.push(`<polygon points="${hexPoints(c.x, c.y)}" fill="${fill}"/>`);
    if (art) {
      const signed = (v: number) => `${v < 0 ? "n" : "p"}${Math.abs(v)}`;
      const clipId = `terrain-clip-${signed(p.q)}-${signed(p.r)}`;
      clips.push(`<clipPath id="${clipId}"><polygon points="${hexPoints(c.x, c.y)}"/></clipPath>`);
      parts.push(`<g class="terrain-art-group" clip-path="url(#${clipId})" pointer-events="none">`);
      parts.push(`<image class="terrain-base" href="${art.base}" x="${(c.x - 27).toFixed(1)}" y="${(c.y - 31).toFixed(1)}" width="54" height="62" preserveAspectRatio="none"/>`);
      if (art.relief) {
        const hill = art.relief.kind === "hill";
        parts.push(`<image class="terrain-sprite ${art.relief.kind}" href="${art.relief.href}" x="${(c.x - (hill ? 22 : 30)).toFixed(1)}" y="${(c.y - (hill ? 14 : 30)).toFixed(1)}" width="${hill ? 44 : 60}" height="${hill ? 32 : 60}" preserveAspectRatio="xMidYMid meet"/>`);
      }
      if (art.feature) parts.push(`<image class="terrain-sprite feature" href="${art.feature}" x="${(c.x - 30).toFixed(1)}" y="${(c.y - 30).toFixed(1)}" width="60" height="60"/>`);
      parts.push(`</g><polygon class="hex-outline" points="${hexPoints(c.x, c.y)}" fill="none" pointer-events="none"/>`);
    }
    if (t.湖泊 && !art) parts.push(`<polygon points="${hexPoints(c.x, c.y)}" class="lake-surface"/>`);
    const terrainIcon = localIconSrc(t.地形);
    if (terrainIcon && !art) {
      parts.push(`<image class="terrain-icon" href="${terrainIcon}" aria-label="${esc(rules.name(t.地形))}" x="${(c.x - 24).toFixed(1)}" y="${(c.y + 6).toFixed(1)}" width="16" height="16"/>`);
    }
    if (t.地貌 && !art?.feature && !t.湖泊) {
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
  const riverLayer = `<g class="river-layer">${rivers}</g>`;
  const territoryLayer = `<g class="territory-border-layer">${borders}</g>`;
  return `<svg viewBox="${(minX - pad).toFixed(0)} ${(minY - pad).toFixed(0)} ${(maxX - minX + pad * 2).toFixed(0)} ${(maxY - minY + pad * 2).toFixed(0)}"><defs>${clips.join("")}</defs>${parts.join("")}${territoryLayer}${riverLayer}</svg>`;
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
