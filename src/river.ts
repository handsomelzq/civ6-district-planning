/** 精确格边与河岸派生；不生成地图、不计算产出、不依赖SVG尺寸。 */
import { parseKey, type Axial } from "./hex.ts";
import { type BoardState, type Tile, type RiverVertex, type RiverPath } from "./board.ts";

export type RiverEdge = {
  readonly a: RiverVertex; readonly b: RiverVertex; readonly tiles: readonly string[];
};
export type RiverGraph = {
  readonly vertices: ReadonlyMap<string, RiverVertex>;
  readonly edges: ReadonlyMap<string, RiverEdge>;
  readonly adjacent: ReadonlyMap<string, readonly string[]>;
  readonly incidentTiles: ReadonlyMap<string, readonly string[]>;
};

export const vertexKey = (v: RiverVertex): string => `${v.x},${v.y}`;
export const edgeKey = (a: RiverVertex, b: RiverVertex): string =>
  [vertexKey(a), vertexKey(b)].sort().join("|");
export const tileVertices = (p: Axial): readonly RiverVertex[] =>
  [[0, -2], [1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1]]
    .map(([x, y]) => ({ x: 2 * p.q + p.r + x, y: 3 * p.r + y }));

export const isWaterTile = (t: Tile): boolean =>
  t.湖泊 === true || t.地形 === "TERRAIN_COAST" || t.地形 === "TERRAIN_OCEAN";

export function buildRiverGraph(tiles: ReadonlyMap<string, Tile>): RiverGraph {
  const vertices = new Map<string, RiverVertex>();
  const edges = new Map<string, RiverEdge>();
  const incident = new Map<string, Set<string>>();
  for (const id of tiles.keys()) {
    const corners = tileVertices(parseKey(id));
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length];
      const v = vertexKey(a);
      vertices.set(v, a);
      if (!incident.has(v)) incident.set(v, new Set());
      incident.get(v)!.add(id);
      const e = edgeKey(a, b), old = edges.get(e);
      edges.set(e, { a, b, tiles: [...(old?.tiles ?? []), id] });
    }
  }
  const adjacent = new Map<string, string[]>();
  for (const [id, e] of edges) for (const v of [e.a, e.b]) {
    const k = vertexKey(v);
    adjacent.set(k, [...(adjacent.get(k) ?? []), id]);
  }
  return {
    vertices, edges, adjacent,
    incidentTiles: new Map([...incident].map(([k, v]) => [k, [...v]])),
  };
}

export function riverBankKeys(
  tiles: ReadonlyMap<string, Tile>, paths: readonly RiverPath[],
): ReadonlySet<string> {
  const graph = buildRiverGraph(tiles);
  const banks = new Set<string>();
  for (const path of paths) {
    if (path.length < 3) throw new Error("河道至少需要两段相连河段");
    const seen = new Set<string>();
    for (const v of path) {
      const id = vertexKey(v);
      if (!Number.isInteger(v.x) || !Number.isInteger(v.y) || seen.has(id)) {
        throw new Error(`河道顶点非法或重复：${id}`);
      }
      seen.add(id);
    }
    for (let i = 1; i < path.length; i++) {
      const e = graph.edges.get(edgeKey(path[i - 1], path[i]));
      if (!e || e.tiles.length !== 2) throw new Error("河段必须位于两个地图格的共享边");
      for (const id of e.tiles) if (!isWaterTile(tiles.get(id)!)) banks.add(id);
    }
  }
  return banks;
}

export function syncRiverBanks(b: BoardState): BoardState {
  if (b.河道 === undefined) return b;
  const banks = riverBankKeys(b.tiles, b.河道);
  const tiles = new Map(b.tiles);
  for (const [id, t] of tiles) {
    const marked = banks.has(id);
    if (Boolean(t.河流边) === marked) continue;
    const { 河流边: _old, ...rest } = t;
    tiles.set(id, marked ? { ...rest, 河流边: true } : rest);
  }
  return { ...b, tiles };
}
