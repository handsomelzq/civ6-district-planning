import {
  MIN_CITY_CENTER_DISTANCE, type BoardState, type City, type RiverPath, type Tile,
} from "./board.ts";
import { disc, distance, key, neighbors, parseKey, type Axial } from "./hex.ts";
import { edgeKey, vertexKey, isWaterTile, riverBankKeys, syncRiverBanks } from "./river.ts";
import { mapResourceOptions } from "./map_resources.ts";
import {
  analyzeGeneratedMap, candidateScore, hardFailures, type MapGenerationReport,
} from "./map_report.ts";
import {
  MAP_PRESETS, MapConfigError, normalizeMapConfig, targetBands,
  type Band, type MapGeneratorConfig, type MapTargetBands,
} from "./map_config.ts";
import { type Rules } from "./rules.ts";
import { generateRandomRivers } from "../web/random_rivers.ts";

export {
  MAP_GENERATOR_VERSION, MAP_PRESETS, MapConfigError, normalizeMapConfig, targetBands,
} from "./map_config.ts";
export type {
  MapPresetId, Level3, MapGeneratorConfig, Band, MapTargetBands,
} from "./map_config.ts";

const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffled = <T>(items: readonly T[], random: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const midpointCount = (band: Band, denominator: number): number =>
  Math.round((band[0] + band[1]) / 2 * denominator);
const terrainBase = (terrain: string): string =>
  terrain.replace(/_(HILLS|MOUNTAIN)$/, "");
const withRelief = (terrain: string, relief: "" | "_HILLS" | "_MOUNTAIN"): string =>
  terrainBase(terrain) + relief;

function growConnected(
  origin: Axial, count: number, eligible: ReadonlySet<string>, random: () => number,
): string[] {
  const selected = new Set<string>(), frontier = new Map<string, Axial>([[key(origin), origin]]);
  while (frontier.size && selected.size < count) {
    const options = [...frontier.values()].sort((a, b) =>
      distance(origin, a) - distance(origin, b) || random() - 0.5);
    const p = options[Math.floor(random() * Math.min(options.length, 5))];
    frontier.delete(key(p));
    if (!eligible.has(key(p)) || selected.has(key(p))) continue;
    selected.add(key(p));
    for (const nb of neighbors(p)) {
      const id = key(nb);
      if (eligible.has(id) && !selected.has(id)) frontier.set(id, nb);
    }
  }
  return [...selected];
}

function placeOcean(
  map: readonly Axial[], tiles: Map<string, Tile>, target: number, random: () => number,
): void {
  const eligible = new Set(map.filter((p) => distance(p, { q: 0, r: 0 }) >= 3).map(key));
  const boundary = map.filter((p) => distance(p, { q: 0, r: 0 }) === 7);
  const origin = shuffled(boundary, random)[0];
  const ids = growConnected(origin, target, eligible, random);
  if (ids.length < target) throw new Error(`海洋只能生成 ${ids.length}/${target} 格`);
  const water = new Set(ids);
  for (const id of ids) {
    const p = parseKey(id);
    const coast = neighbors(p).some((n) => tiles.has(key(n)) && !water.has(key(n)));
    tiles.set(id, { 地形: coast ? "TERRAIN_COAST" : "TERRAIN_OCEAN" });
  }
}

function placeLake(
  map: readonly Axial[], tiles: Map<string, Tile>, random: () => number,
): void {
  const inland = (p: Axial): boolean => tiles.has(key(p)) && Math.abs(p.r) < 5 &&
    !isWaterTile(tiles.get(key(p))!) && !neighbors(p).some((n) =>
      tiles.has(key(n)) && isWaterTile(tiles.get(key(n))!));
  const origins = shuffled(map.filter((p) => distance(p, { q: 0, r: 0 }) <= 4 &&
    inland(p) && neighbors(p).filter(inland).length >= 2), random);
  const origin = origins[0];
  if (!origin) throw new Error("地图缺少与海水隔开的内陆湖区域");
  const cells = [origin, ...shuffled(neighbors(origin).filter(inland), random).slice(0, 2)];
  for (const p of cells) tiles.set(key(p), { 地形: "TERRAIN_COAST", 湖泊: true });
}

function setPolar(
  map: readonly Axial[], tiles: Map<string, Tile>, polar: MapGeneratorConfig["polar"],
  random: () => number,
): "none" | "north" | "south" {
  const actual = polar === "random"
    ? (random() < 0.65 ? "none" : random() < 0.5 ? "north" : "south") : polar;
  if (actual === "none") return actual;
  const edgeRow = actual === "north" ? -7 : 7;
  const innerRow = actual === "north" ? -5 : 5;
  const edgeLand = map.filter((p) => p.r === edgeRow && !isWaterTile(tiles.get(key(p))!));
  if (!edgeLand.length) return actual;
  const eligible = new Set(map.filter((p) => {
    const inBand = actual === "north" ? p.r <= innerRow : p.r >= innerRow;
    return inBand && !isWaterTile(tiles.get(key(p))!);
  }).map(key));
  const polarCells = growConnected(shuffled(edgeLand, random)[0], eligible.size, eligible, random);
  for (const id of polarCells) {
    const p = parseKey(id);
    const t = tiles.get(key(p))!;
    tiles.set(key(p), { ...t, 地形: withRelief(t.地形, t.地形.endsWith("_MOUNTAIN")
      ? "_MOUNTAIN" : t.地形.endsWith("_HILLS") ? "_HILLS" : ""), 地貌: undefined });
    const current = tiles.get(key(p))!;
    tiles.set(key(p), { ...current, 地形: current.地形.replace(/^TERRAIN_[A-Z]+/, "TERRAIN_TUNDRA") });
  }
  return actual;
}

function placeRelief(
  map: readonly Axial[], tiles: Map<string, Tile>, bands: MapTargetBands,
  random: () => number,
): void {
  const land = map.filter((p) => !isWaterTile(tiles.get(key(p))!));
  const total = midpointCount(bands.relief, land.length);
  const mountains = Math.min(total, midpointCount(bands.mountains, land.length));
  const eligible = new Set(land.map(key));
  const origins = shuffled(land.filter((p) => Math.abs(p.r) <= 5), random).slice(0, 2);
  const relief = new Set<string>();
  for (const origin of origins) for (const id of growConnected(
    origin, Math.ceil(total / origins.length), eligible, random,
  )) relief.add(id);
  for (const id of shuffled([...relief], random).slice(0, mountains)) {
    const t = tiles.get(id)!;
    tiles.set(id, { ...t, 地形: withRelief(t.地形, "_MOUNTAIN"), 地貌: undefined });
  }
  for (const id of relief) {
    const t = tiles.get(id)!;
    if (!t.地形.endsWith("_MOUNTAIN")) tiles.set(id, {
      ...t, 地形: withRelief(t.地形, "_HILLS"),
      地貌: t.地貌 === "FEATURE_MARSH" ? undefined : t.地貌,
    });
  }
}

function riverSet(
  tiles: Map<string, Tile>, config: MapGeneratorConfig, random: () => number,
): { tiles: Map<string, Tile>; paths: RiverPath[]; mouthLand: Set<string> } {
  const target = targetBands(config).rivers;
  const first = generateRandomRivers(tiles, random);
  if (target.count === 1) return {
    tiles: new Map(first.tiles), paths: [...first.paths], mouthLand: new Set(first.mouthLand),
  };
  const firstEdges = new Set<string>();
  for (const path of first.paths) for (let i = 1; i < path.length; i++)
    firstEdges.add(edgeKey(path[i - 1], path[i]));
  const firstVertices = new Set(first.paths[0].map(vertexKey));
  for (let attempt = 0; attempt < 24; attempt++) {
    const second = generateRandomRivers(first.tiles, random);
    const secondPath = second.paths[0];
    const secondEdges = secondPath.slice(1).map((v, i) => edgeKey(secondPath[i], v));
    if (secondEdges.some((id) => firstEdges.has(id))) continue;
    if (secondPath.some((v, i) => firstVertices.has(vertexKey(v)) &&
      !(i === secondPath.length - 1 && vertexKey(v) === vertexKey(first.paths[0].at(-1)!)))) continue;
    let a = first.paths[0], b = secondPath;
    while (a.length + b.length - 2 > target.segments[1]) {
      if (a.length >= b.length && a.length > 4) a = a.slice(1);
      else if (b.length > 4) b = b.slice(1);
      else break;
    }
    if (a.length + b.length - 2 < target.segments[0]) continue;
    return { tiles: new Map(second.tiles), paths: [a, b],
      mouthLand: new Set([...first.mouthLand, ...second.mouthLand]) };
  }
  throw new Error("丰富河流无法生成两条互不重复且长度合适的河道");
}

function placeDesert(
  map: readonly Axial[], tiles: Map<string, Tile>, mouthLand: ReadonlySet<string>,
  band: Band, random: () => number,
): void {
  const land = map.filter((p) => !isWaterTile(tiles.get(key(p))!));
  const warm = land.filter((p) => Math.abs(p.r) < 5 && !mouthLand.has(key(p)));
  const eligible = new Set(warm.map(key));
  const target = midpointCount(band, land.length);
  const origins = shuffled(warm, random);
  let ids: string[] = [];
  for (const origin of origins) {
    const candidate = growConnected(origin, target, eligible, random);
    if (candidate.length > ids.length) ids = candidate;
    if (ids.length >= target) break;
  }
  if (ids.length < Math.min(2, target)) {
    throw new Error(`沙漠只能生成 ${ids.length}/${target} 格连续片区`);
  }
  for (const id of ids) {
    const t = tiles.get(id)!;
    const suffix = t.地形.endsWith("_MOUNTAIN") ? "_MOUNTAIN" :
      t.地形.endsWith("_HILLS") ? "_HILLS" : "";
    tiles.set(id, { ...t, 地形: `TERRAIN_DESERT${suffix}`,
      地貌: !suffix && random() < 0.05 ? "FEATURE_OASIS" : undefined });
  }
}

function chooseCities(
  tiles: ReadonlyMap<string, Tile>, count: 2 | 3 | 4, random: () => number,
): Axial[] {
  const candidates = shuffled([...tiles].filter(([id, t]) =>
    distance(parseKey(id), { q: 0, r: 0 }) <= 5 && !isWaterTile(t) &&
    !t.地形.endsWith("_MOUNTAIN")).map(([id]) => parseKey(id)), random);
  const score = (p: Axial) => (tiles.get(key(p))!.河流边 ? 1000 : 0) -
    (tiles.get(key(p))!.地形.endsWith("_HILLS") ? 10 : 0);
  let beam = candidates.map((p) => [p]);
  for (let depth = 2; depth <= count; depth++) {
    const next: Axial[][] = [];
    for (const chosen of beam.slice(0, 180)) for (const p of candidates) {
      if (chosen.some((x) => key(x) === key(p)) || !chosen.every((x) => {
        const d = distance(x, p); return d >= MIN_CITY_CENTER_DISTANCE && d <= 6;
      })) continue;
      next.push([...chosen, p]);
    }
    beam = next.sort((a, b) => b.reduce((s, p) => s + score(p), 0) -
      a.reduce((s, p) => s + score(p), 0)).slice(0, 180);
    if (!beam.length) break;
  }
  const best = beam.find((group) => group.length === count &&
    group.some((p) => tiles.get(key(p))!.河流边));
  if (!best) throw new Error(`无法找到 ${count} 座满足间距且至少一城临河的城址`);
  return best;
}

const CITY_NAMES = ["山麓城", "河畔城", "林间城", "高原城"];
const city = (index: number, center: Axial): City => ({
  id: String.fromCharCode(65 + index), 名称: CITY_NAMES[index], 中心: center, 人口: 10,
});

export function generateMapCandidate(input: MapGeneratorConfig, candidateSeed: number): BoardState {
  const config = normalizeMapConfig({ ...input, seed: candidateSeed });
  const random = seeded(candidateSeed), map = disc(7), targets = targetBands(config);
  let tiles = new Map<string, Tile>();
  for (const p of map) {
    const terrain = random() < 0.20 ? "TERRAIN_PLAINS" : "TERRAIN_GRASS";
    const roll = random();
    tiles.set(key(p), { 地形: terrain,
      地貌: roll < 0.09 ? "FEATURE_FOREST" : roll < 0.14 ? "FEATURE_JUNGLE"
        : terrain === "TERRAIN_GRASS" && roll < 0.17 ? "FEATURE_MARSH" : undefined });
  }
  const waterTarget = midpointCount(targets.ocean, map.length);
  placeOcean(map, tiles, Math.max(3, waterTarget - 3), random);
  placeLake(map, tiles, random);
  placeRelief(map, tiles, targets, random);
  setPolar(map, tiles, config.polar, random);
  const water = riverSet(tiles, config, random);
  tiles = water.tiles;
  const banks = riverBankKeys(tiles, water.paths);
  for (const id of banks) tiles.set(id, { ...tiles.get(id)!, 河流边: true });
  placeDesert(map, tiles, water.mouthLand, targets.desert, random);
  const centers = chooseCities(tiles, config.cityCount, random);
  const resourceTarget = midpointCount(targets.resources, map.length);
  const resourceCells = shuffled(map.filter((p) => !centers.some((c) => key(c) === key(p)) &&
    mapResourceOptions(tiles.get(key(p))!).length > 0), random)
    .slice(0, resourceTarget);
  for (const p of resourceCells) {
    const t = tiles.get(key(p))!;
    const options = mapResourceOptions(t);
    tiles.set(key(p), { ...t, 资源: options[Math.floor(random() * options.length)] });
  }
  const cities = centers.map((center, index) => city(index, center));
  for (const c of cities) {
    const id = key(c.中心), t = tiles.get(id)!;
    tiles.set(id, { ...t, 地形: terrainBase(t.地形), 地貌: undefined, 湖泊: false,
      资源: undefined, 区域: "DISTRICT_CITY_CENTER", 建筑: ["BUILDING_PALACE"], 所属城市: c.id });
  }
  return syncRiverBanks({
    tiles, 城市: cities, 中心: cities[0].中心, 人口: cities[0].人口,
    河道: water.paths, 已解锁科技: new Set(), 已解锁市政: new Set(),
    已装配政策: new Set(), 已选宗教信条: new Set(),
  });
}

export type CandidateBuilder = (
  config: MapGeneratorConfig, candidateSeed: number, attempt: number,
) => BoardState;

export type MapGenerationResult = {
  readonly board: BoardState;
  readonly report: MapGenerationReport;
};

export type MapContext = Pick<BoardState, "文明" | "领袖" | "已解锁科技" | "已解锁市政" |
  "已装配政策" | "已选宗教信条">;

export function applyMapContext(board: BoardState, context?: Partial<MapContext>): BoardState {
  if (!context) return board;
  return { ...board, 文明: context.文明, 领袖: context.领袖,
    已解锁科技: context.已解锁科技 ?? board.已解锁科技,
    已解锁市政: context.已解锁市政 ?? board.已解锁市政,
    已装配政策: context.已装配政策 ?? board.已装配政策,
    已选宗教信条: context.已选宗教信条 ?? board.已选宗教信条 };
}

export class MapGenerationError extends Error {
  readonly attempts: number;
  readonly reasons: Readonly<Record<string, number>>;

  constructor(attempts: number, reasons: Readonly<Record<string, number>>,
    details: readonly string[] = []) {
    const summary = Object.entries(reasons).sort(([a], [b]) => a.localeCompare(b))
      .map(([code, count]) => `${code}×${count}`).join("、");
    super(`尝试 ${attempts} 次仍没有硬约束合法地图：${details.join("；") || summary || "未知生成错误"}`);
    this.name = "MapGenerationError";
    this.attempts = attempts;
    this.reasons = reasons;
  }
}

const betterScore = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
};

export function generateSandboxMap(
  rules: Rules, input: MapGeneratorConfig,
  options: { readonly buildCandidate?: CandidateBuilder; readonly maxAttempts?: number;
    readonly context?: Partial<MapContext> } = {},
): MapGenerationResult {
  const config = normalizeMapConfig(input);
  const build = options.buildCandidate ?? ((candidateConfig, seed) =>
    generateMapCandidate(candidateConfig, seed));
  const maxAttempts = options.maxAttempts ?? 24;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new MapConfigError("maxAttempts 必须是至少1的整数");
  }
  const reasons: Record<string, number> = {};
  const details = new Set<string>();
  let best: MapGenerationResult | undefined;
  let bestScore: readonly number[] | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidateSeed = (config.seed + attempt) >>> 0;
    let board: BoardState;
    try {
      board = applyMapContext(build(config, candidateSeed, attempt + 1), options.context);
    } catch (error) {
      reasons.GENERATOR_ERROR = (reasons.GENERATOR_ERROR ?? 0) + 1;
      details.add(error instanceof Error ? error.message : String(error));
      continue;
    }
    const report = analyzeGeneratedMap(rules, board, config, {
      baseSeed: config.seed, candidateSeed, attempts: attempt + 1, candidateIndex: attempt + 1,
    });
    const failures = hardFailures(report);
    if (failures.length) {
      for (const failure of failures) {
        reasons[failure.code] = (reasons[failure.code] ?? 0) + 1;
        details.add(failure.message);
      }
      continue;
    }
    const result = { board, report };
    if (report.targets.every((target) => target.passed)) return result;
    const score = candidateScore(report);
    if (!bestScore || betterScore(score, bestScore)) {
      best = result;
      bestScore = score;
    }
  }
  if (best) return { ...best, report: { ...best.report,
    metadata: { ...best.report.metadata, attempts: maxAttempts } } };
  throw new MapGenerationError(maxAttempts, reasons, [...details].sort());
}
