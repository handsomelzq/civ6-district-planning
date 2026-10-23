/** Demo的地势引导水系：不是文明VI引擎或真实水动力学模拟。 */
import { key, neighbors, parseKey, distance } from "../src/hex.ts";
import { type Tile, type RiverPath, type RiverVertex } from "../src/board.ts";
import {
  buildRiverGraph, vertexKey, isWaterTile, type RiverGraph,
} from "../src/river.ts";

export type RandomRiverResult = {
  readonly tiles: ReadonlyMap<string, Tile>;
  readonly paths: readonly RiverPath[];
  readonly mouthLand: ReadonlySet<string>;
};
/** 随机模板原有的城址候选半径；水系需经过其中一片可用河岸。 */
export const RANDOM_PLANNING_RADIUS = 5;
const relief = (t: Tile): boolean => /_(HILLS|MOUNTAIN)$/.test(t.地形);
const physical = (v: RiverVertex) => ({ x: Math.sqrt(3) * v.x, y: v.y });
const separation = (a: RiverVertex, b: RiverVertex): number => {
  const p = physical(a), q = physical(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

/** 正代价Dijkstra；禁用水边顶点作为中间节点，不靠画线掩盖不可达输入。 */
function route(
  graph: RiverGraph, tiles: ReadonlyMap<string, Tile>, start: string, end: string,
  costs: ReadonlyMap<string, number>, blocked: ReadonlySet<string>,
): string[] | undefined {
  const heap: { id: string; cost: number }[] = [];
  const push = (item: { id: string; cost: number }) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].cost <= item.cost) break;
      heap[i] = heap[parent]; i = parent;
    }
    heap[i] = item;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (2 * i + 1 < heap.length) {
        let child = 2 * i + 1;
        if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
        if (last.cost <= heap[child].cost) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  const dist = new Map([[start, 0]]), previous = new Map<string, string>();
  push({ id: start, cost: 0 });
  while (heap.length) {
    const here = pop();
    if (here.cost !== dist.get(here.id)) continue;
    if (here.id === end) {
      const path = [end];
      while (path.at(-1) !== start) path.push(previous.get(path.at(-1)!)!);
      return path.reverse();
    }
    for (const id of graph.adjacent.get(here.id) ?? []) {
      const e = graph.edges.get(id)!;
      if (e.tiles.length !== 2 || e.tiles.some((k) => isWaterTile(tiles.get(k)!)) ||
        e.tiles.every((k) => tiles.get(k)!.地形.endsWith("_MOUNTAIN"))) continue;
      const next = vertexKey(e.a) === here.id ? vertexKey(e.b) : vertexKey(e.a);
      if (blocked.has(next) || (next !== end && graph.incidentTiles.get(next)!
        .some((k) => isWaterTile(tiles.get(k)!)))) continue;
      const cost = here.cost + costs.get(id)!;
      if (cost >= (dist.get(next) ?? Infinity)) continue;
      dist.set(next, cost); previous.set(next, here.id); push({ id: next, cost });
    }
  }
  return undefined;
}

export function generateRandomRivers(
  input: ReadonlyMap<string, Tile>, random: () => number,
): RandomRiverResult {
  const tiles = new Map(input), graph = buildRiverGraph(tiles);
  const interior = [...graph.vertices.keys()].filter((v) => {
    const ids = graph.incidentTiles.get(v)!;
    return ids.length === 3 && ids.every((id) => !isWaterTile(tiles.get(id)!));
  });
  const outlets = [...graph.vertices.keys()].filter((v) => {
    const ids = graph.incidentTiles.get(v)!;
    return ids.length === 3 && ids.filter((id) => isWaterTile(tiles.get(id)!)).length === 1 &&
      (graph.adjacent.get(v) ?? []).some((id) => graph.edges.get(id)!.tiles.every((k) => !isWaterTile(tiles.get(k)!)));
  });
  if (!outlets.length || !interior.length) throw new Error("河流缺少可达的湖海出口或内陆源头");

  const sources = interior.filter((v) => graph.incidentTiles.get(v)!
    .filter((id) => relief(tiles.get(id)!)).length >= 2);
  const planningInterior = new Set(interior.filter((v) => graph.incidentTiles.get(v)!.some((id) =>
    distance(parseKey(id), { q: 0, r: 0 }) <= RANDOM_PLANNING_RADIUS &&
    !tiles.get(id)!.地形.endsWith("_MOUNTAIN"))));
  const passesPlanningArea = (path: readonly string[]): boolean =>
    path.slice(1, -1).some((v) => planningInterior.has(v));

  // 连贯随机成本场：相近边收到相近影响，而不是每边独立白噪声。
  const patches = Array.from({ length: 6 }, () => ({
    v: physical(graph.vertices.get(interior[Math.floor(random() * interior.length)])!),
    strength: random() * 2.5,
  }));
  const costs = new Map<string, number>();
  for (const [id, e] of graph.edges) {
    const a = physical(e.a), b = physical(e.b);
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    const noise = patches.reduce((sum, p) => sum + p.strength * Math.exp(-((x - p.v.x) ** 2 + (y - p.v.y) ** 2) / 40), 0);
    const mountain = e.tiles.some((k) => tiles.get(k)!.地形.endsWith("_MOUNTAIN"));
    const valley = e.tiles.filter((k) => relief(tiles.get(k)!)).length === 1;
    costs.set(id, 1 + noise + (mountain ? 0.7 : 0) - (valley ? 0.25 : 0));
  }
  const lake = outlets.filter((v) => graph.incidentTiles.get(v)!.some((id) => tiles.get(id)!.湖泊));
  const sea = outlets.filter((v) => !lake.includes(v));
  const preferred = random() < 0.45 && lake.length ? lake : sea.length ? sea : lake;
  const findPath = (sourceCandidates: readonly string[]): string[] | undefined => {
    let found: string[] | undefined;
    for (let attempt = 0; attempt < 32 && !found && sourceCandidates.length; attempt++) {
      const end = preferred[Math.floor(random() * preferred.length)];
      const far = sourceCandidates.filter((v) => separation(graph.vertices.get(v)!, graph.vertices.get(end)!) >= 10);
      if (!far.length) continue;
      const start = far[Math.floor(random() * far.length)];
      const a = physical(graph.vertices.get(start)!), z = physical(graph.vertices.get(end)!);
      const len = Math.hypot(z.x - a.x, z.y - a.y), sign = random() < 0.5 ? -1 : 1;
      const offset = 5 + random() * 5;
      const ideal = { x: (a.x + z.x) / 2 - sign * (z.y - a.y) / len * offset,
        y: (a.y + z.y) / 2 + sign * (z.x - a.x) / len * offset };
      const waypoints = interior.filter((v) => planningInterior.has(v) && v !== start &&
        separation(graph.vertices.get(v)!, graph.vertices.get(start)!) >= 4)
        .sort((p, q) => {
          const x = physical(graph.vertices.get(p)!), y = physical(graph.vertices.get(q)!);
          return Math.hypot(x.x - ideal.x, x.y - ideal.y) - Math.hypot(y.x - ideal.x, y.y - ideal.y);
        }).slice(0, 4);
      if (!waypoints.length) continue;
      const via = waypoints[Math.floor(random() * waypoints.length)];
      const first = route(graph, tiles, start, via, costs, new Set());
      if (!first) continue;
      const second = route(graph, tiles, via, end, costs, new Set(first.slice(0, -1)));
      if (second && first.length + second.length >= 10) found = [...first, ...second.slice(1)];
    }
    // 有限可达退路，仍使用真实边，不偷偷换成固定横线或断河。
    if (!found) outer: for (const start of sourceCandidates) for (const end of [...preferred, ...outlets]) {
      const candidate = route(graph, tiles, start, end, costs, new Set());
      if (candidate && candidate.length >= 3 && passesPlanningArea(candidate)) { found = candidate; break outer; }
    }
    return found;
  };
  let found = findPath(sources);
  // 既有源头也可能在被水包围的山岛上；先证明新源区可达，再有限补丘陵。
  if (!found) {
    const eligible = interior.filter((v) => graph.incidentTiles.get(v)!.every((id) =>
      Math.abs(parseKey(id).r) < 5 && !/^TERRAIN_(TUNDRA|SNOW)/.test(tiles.get(id)!.地形) &&
      !tiles.get(id)!.地形.endsWith("_MOUNTAIN")))
      .map((v) => ({ v, order: random() })).sort((a, b) => a.order - b.order);
    outer: for (const { v } of eligible) for (const end of [...preferred, ...outlets]) {
      if (separation(graph.vertices.get(v)!, graph.vertices.get(end)!) < 10) continue;
      const candidate = route(graph, tiles, v, end, costs, new Set());
      if (!candidate || candidate.length < 3 || !passesPlanningArea(candidate)) continue;
      for (const id of graph.incidentTiles.get(v)!.slice(0, 2)) {
        const t = tiles.get(id)!;
        tiles.set(id, { ...t, 地形: t.地形.replace(/_HILLS$/, "") + "_HILLS",
          地貌: ["FEATURE_MARSH", "FEATURE_OASIS"].includes(t.地貌 ?? "") ? undefined : t.地貌 });
      }
      found = findPath([v]) ?? candidate;
      break outer;
    }
  }
  if (!found) throw new Error("河流源头与湖海出口之间没有可通行河道");

  const path = found.map((id) => graph.vertices.get(id)!);
  const mouthLand = new Set<string>();
  const warmLand = (id: string): boolean => tiles.has(id) && !isWaterTile(tiles.get(id)!) &&
    !/^TERRAIN_(TUNDRA|SNOW)/.test(tiles.get(id)!.地形);
  const land = graph.incidentTiles.get(found.at(-1)!)!.filter(warmLand);
  for (const id of land) mouthLand.add(id);
  if (land.length === 1) {
    const nb = neighbors(parseKey(land[0])).map(key).find((id) => warmLand(id) && id !== land[0]);
    if (nb) mouthLand.add(nb);
  }
  for (const id of mouthLand) {
    const t = tiles.get(id)!;
    const terrain = random() < 0.65 ? "TERRAIN_GRASS" : "TERRAIN_PLAINS";
    tiles.set(id, { ...t, 地形: terrain,
      地貌: t.地貌 === "FEATURE_MARSH" && terrain !== "TERRAIN_GRASS" ? undefined : t.地貌 });
  }
  return { tiles, paths: [path], mouthLand };
}
