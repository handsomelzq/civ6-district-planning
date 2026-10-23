/** 测试独立观察真实格边；不使用生产river图来计算期望河岸。 */
import { type Tile, type RiverPath, type RiverVertex } from "../src/board.ts";
import { parseKey } from "../src/hex.ts";

export const randomFor = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
};
export const water = (t: Tile): boolean => Boolean(t.湖泊) || ["TERRAIN_COAST", "TERRAIN_OCEAN"].includes(t.地形);
export const vid = (v: RiverVertex): string => `${v.x},${v.y}`;
export const eid = (a: RiverVertex, b: RiverVertex): string => [vid(a), vid(b)].sort().join("|");

export function observe(tiles: ReadonlyMap<string, Tile>) {
  const edges = new Map<string, string[]>(), incident = new Map<string, string[]>();
  for (const id of tiles.keys()) {
    const { q, r } = parseKey(id);
    const corners = [[0, -2], [1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1]]
      .map(([x, y]) => ({ x: 2 * q + r + x, y: 3 * r + y }));
    for (let i = 0; i < 6; i++) {
      const v = vid(corners[i]);
      incident.set(v, [...(incident.get(v) ?? []), id]);
      const e = eid(corners[i], corners[(i + 1) % 6]);
      edges.set(e, [...(edges.get(e) ?? []), id]);
    }
  }
  return { edges, incident };
}

export function macroDeviation(path: RiverPath): number {
  const a = path[0], z = path[path.length - 1];
  const dx = Math.sqrt(3) * (z.x - a.x), dy = z.y - a.y;
  return Math.max(...path.map((v) => Math.abs(dx * (v.y - a.y) - dy * Math.sqrt(3) * (v.x - a.x)) / Math.hypot(dx, dy)));
}
