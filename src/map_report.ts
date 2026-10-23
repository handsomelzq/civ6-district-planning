import { MIN_CITY_CENTER_DISTANCE, cityTerritoryOwners, type BoardState } from "./board.ts";
import { disc, distance, key, neighbors, parseKey } from "./hex.ts";
import { MAP_RESOURCE_TERRAINS, mapResourceOptions } from "./map_resources.ts";
import { validateDistrictPlacement } from "./legality.ts";
import { buildRiverGraph, edgeKey, isWaterTile, riverBankKeys, vertexKey } from "./river.ts";
import { type Rules } from "./rules.ts";
import { MAP_GENERATOR_VERSION, normalizeMapConfig, targetBands, type Band, type MapGeneratorConfig } from "./map_config.ts";

export type MapCheck = {
  readonly code: string;
  readonly severity: "error" | "warning" | "pass";
  readonly message: string;
};

export type MapTargetCheck = {
  readonly code: string;
  readonly label: string;
  readonly actual: number;
  readonly denominator: number;
  readonly ratio: number;
  readonly target: Band;
  readonly passed: boolean;
  readonly normalizedDeviation: number;
};

export type MapGenerationReport = {
  readonly version: string;
  readonly status: "ok" | "warning" | "error";
  readonly warning?: string;
  readonly config: MapGeneratorConfig;
  readonly metadata: { readonly baseSeed: number; readonly candidateSeed: number; readonly attempts: number;
    readonly candidateIndex?: number };
  readonly surface: {
    readonly total: number; readonly land: number; readonly water: number;
    readonly ocean: number; readonly lake: number; readonly hills: number;
    readonly mountains: number; readonly desert: number; readonly tundra: number;
    readonly reliefComponents: number; readonly desertComponents: number; readonly tundraComponents: number;
  };
  readonly rivers: {
    readonly count: number; readonly segments: number; readonly riversideLand: number;
    readonly riversideLandRatio: number; readonly outlets: { readonly sea: number; readonly lake: number };
  };
  readonly resources: { readonly total: number; readonly byCategory: Readonly<Record<string, number>> };
  readonly cities: readonly {
    readonly id: string; readonly name: string; readonly territoryTiles: number;
    readonly buildableTiles: number; readonly districtCandidates: Readonly<Record<string, number>>;
  }[];
  readonly polarActual: "none" | "north" | "south" | "invalid";
  readonly planning: { readonly passed: boolean; readonly minimumBuildableTiles: number };
  readonly targets: readonly MapTargetCheck[];
  readonly checks: readonly MapCheck[];
};

const connectedComponents = (ids: Iterable<string>): number => {
  const remaining = new Set(ids);
  let count = 0;
  while (remaining.size) {
    count++;
    const queue = [remaining.values().next().value!];
    remaining.delete(queue[0]);
    for (let i = 0; i < queue.length; i++) for (const p of neighbors(parseKey(queue[i]))) {
      const id = key(p);
      if (remaining.delete(id)) queue.push(id);
    }
  }
  return count;
};

const targetCheck = (
  code: string, label: string, actual: number, denominator: number, target: Band,
): MapTargetCheck => {
  const ratio = denominator ? actual / denominator : 0;
  const passed = ratio >= target[0] && ratio <= target[1];
  const gap = ratio < target[0] ? target[0] - ratio : ratio > target[1] ? ratio - target[1] : 0;
  const span = Math.max(0.000001, target[1] - target[0]);
  return { code, label, actual, denominator, ratio, target, passed,
    normalizedDeviation: gap / span };
};

const add = (checks: MapCheck[], code: string, condition: boolean, fail: string, pass: string): void => {
  checks.push({ code, severity: condition ? "pass" : "error", message: condition ? pass : fail });
};

const riverChecks = (board: BoardState, checks: MapCheck[]) => {
  const graph = buildRiverGraph(board.tiles);
  const used = new Set<string>();
  const usedVertices = new Map<string, boolean>();
  let crossing = false;
  let segments = 0, sea = 0, lake = 0, broken = false, overlap = false, noOutlet = false;
  for (const path of board.河道 ?? []) {
    const localVertices = new Set<string>();
    if (path.length < 3) broken = true;
    for (const vertex of path) {
      const id = vertexKey(vertex);
      if (localVertices.has(id)) broken = true;
      const outlet = vertex === path.at(-1);
      if (usedVertices.has(id) && !(usedVertices.get(id) && outlet)) crossing = true;
      usedVertices.set(id, outlet);
      localVertices.add(id);
    }
    for (let i = 1; i < path.length; i++) {
      const id = edgeKey(path[i - 1], path[i]);
      const edge = graph.edges.get(id);
      if (!edge || edge.tiles.length !== 2 || edge.tiles.some((tileId) => isWaterTile(board.tiles.get(tileId)!))) {
        broken = true;
        continue;
      }
      if (used.has(id)) overlap = true;
      used.add(id); segments++;
    }
    const endpoint = path.at(-1);
    const water = endpoint ? (graph.incidentTiles.get(vertexKey(endpoint)) ?? [])
      .filter((id) => isWaterTile(board.tiles.get(id)!)) : [];
    if (!water.length) noOutlet = true;
    else if (water.some((id) => board.tiles.get(id)!.湖泊)) lake++;
    else sea++;
  }
  if (broken) checks.push({ code: "RIVER_BROKEN", severity: "error", message: "河道包含断边、跳边、环路或非法水面边" });
  if (overlap) checks.push({ code: "RIVER_OVERLAP", severity: "error", message: "两条河流复用了同一河段" });
  if (crossing) checks.push({ code: "RIVER_INTERSECTION", severity: "error", message: "两条河流只能共享湖海出口，不能在内陆相交或分叉" });
  if (noOutlet) checks.push({ code: "RIVER_NO_OUTLET", severity: "error", message: "河流末端没有汇入湖泊或海洋" });
  let banks = new Set<string>();
  try { banks = new Set(riverBankKeys(board.tiles, board.河道 ?? [])); } catch { /* checks above retain detail */ }
  return { count: board.河道?.length ?? 0, segments, riversideLand: banks.size,
    riversideLandRatio: board.tiles.size ? banks.size / [...board.tiles.values()].filter((t) => !isWaterTile(t)).length : 0,
    outlets: { sea, lake } };
};

const DISTRICTS = ["DISTRICT_CAMPUS", "DISTRICT_HOLY_SITE", "DISTRICT_COMMERCIAL_HUB", "DISTRICT_INDUSTRIAL_ZONE"];

export function analyzeGeneratedMap(
  rules: Rules, board: BoardState, input: MapGeneratorConfig,
  metadata: { baseSeed: number; candidateSeed: number; attempts: number; candidateIndex?: number },
): MapGenerationReport {
  const config = normalizeMapConfig(input), bands = targetBands(config), checks: MapCheck[] = [];
  const entries = [...board.tiles], total = entries.length;
  const waterIds = entries.filter(([, t]) => isWaterTile(t)).map(([id]) => id);
  const landIds = entries.filter(([, t]) => !isWaterTile(t)).map(([id]) => id);
  const ocean = entries.filter(([, t]) => isWaterTile(t) && !t.湖泊).length;
  const lake = entries.filter(([, t]) => t.湖泊).length;
  const reliefIds = entries.filter(([, t]) => /_(HILLS|MOUNTAIN)$/.test(t.地形)).map(([id]) => id);
  const hillIds = entries.filter(([, t]) => t.地形.endsWith("_HILLS")).map(([id]) => id);
  const mountainIds = entries.filter(([, t]) => t.地形.endsWith("_MOUNTAIN")).map(([id]) => id);
  const desertIds = entries.filter(([, t]) => t.地形.startsWith("TERRAIN_DESERT")).map(([id]) => id);
  const tundraIds = entries.filter(([, t]) => t.地形.startsWith("TERRAIN_TUNDRA")).map(([id]) => id);
  const surface = {
    total, land: landIds.length, water: waterIds.length, ocean, lake,
    hills: hillIds.length, mountains: mountainIds.length,
    desert: desertIds.length, tundra: tundraIds.length,
    reliefComponents: connectedComponents(reliefIds), desertComponents: connectedComponents(desertIds),
    tundraComponents: connectedComponents(tundraIds),
  };

  add(checks, "MAP_SIZE", total === 169 && disc(7).every((p) => board.tiles.has(key(p))),
    "地图应为半径7的169个唯一六边坐标", "地图坐标数量正确");
  add(checks, "WATER_SHAPE", connectedComponents(entries.filter(([, t]) => isWaterTile(t) && !t.湖泊)
    .map(([id]) => id)) === 1 && ocean >= 2 &&
    (!lake || connectedComponents(entries.filter(([, t]) => t.湖泊).map(([id]) => id)) === 1 && lake >= 2),
    "海洋和湖泊应分别连片且不能为孤立单格水面", "海洋和湖泊水面连贯");
  const resourceCompatible = entries.every(([, t]) => !t.资源 ||
    (MAP_RESOURCE_TERRAINS[t.资源] ? mapResourceOptions(t).includes(t.资源) :
      rules.resources.has(t.资源) && (!isWaterTile(t) || rules.resources.get(t.资源)!.是否海洋资源)));
  add(checks, "RESOURCE_COMPATIBILITY", resourceCompatible,
    "资源与地形或地貌不兼容", "随机资源与地形地貌兼容");
  add(checks, "CITY_COUNT", (board.城市?.length ?? 0) === config.cityCount,
    `请求${config.cityCount}座城市，实际${board.城市?.length ?? 0}座`, "城市数量符合请求");
  const cityDistanceOk = (board.城市 ?? []).every((city, i, cities) => cities.slice(i + 1)
    .every((other) => distance(city.中心, other.中心) >= MIN_CITY_CENTER_DISTANCE));
  add(checks, "CITY_DISTANCE", cityDistanceOk, "城市中心之间不足4格", "城市中心间距合法");
  const centerResource = (board.城市 ?? []).some((city) => board.tiles.get(key(city.中心))?.资源);
  add(checks, "CITY_CENTER_RESOURCE", !centerResource, "城市中心仍被随机资源覆盖", "城市中心没有随机资源");

  if (desertIds.length) add(checks, "DESERT_FRAGMENTED", surface.desertComponents === 1,
    `沙漠分成${surface.desertComponents}个片区`, "沙漠为单一连续片区");
  const tundraRows = tundraIds.map((id) => parseKey(id).r);
  const north = tundraRows.length > 0 && tundraRows.every((r) => r <= -5);
  const south = tundraRows.length > 0 && tundraRows.every((r) => r >= 5);
  const polarActual = !tundraRows.length ? "none" : north ? "north" : south ? "south" : "invalid";
  const polarExpected = config.polar === "random" ? polarActual !== "invalid" : polarActual === config.polar;
  const touchesEdge = !tundraIds.length || tundraIds.every((id) => {
    const group = new Set([id]), queue = [id];
    for (let i = 0; i < queue.length; i++) for (const p of neighbors(parseKey(queue[i]))) {
      const next = key(p); if (tundraIds.includes(next) && !group.has(next)) { group.add(next); queue.push(next); }
    }
    return [...group].some((x) => Math.abs(parseKey(x).r) === 7);
  });
  add(checks, "POLAR_POSITION", polarExpected && touchesEdge,
    "冻土没有位于请求的单一南北边缘并连接地图边界", "冻土边缘位置合法");

  const rivers = riverChecks(board, checks);
  const resourceRows = entries.filter(([, t]) => t.资源);
  const byCategory: Record<string, number> = {};
  for (const [, tile] of resourceRows) {
    const kind = rules.resources.get(tile.资源!)?.资源类别 ?? "未知";
    byCategory[kind] = (byCategory[kind] ?? 0) + 1;
  }
  const resources = { total: resourceRows.length, byCategory };

  const owners = cityTerritoryOwners(board);
  add(checks, "DISTRICT_OWNER", entries.every(([id, t]) => !t.区域 ||
    Boolean(t.所属城市 && owners.get(id) === t.所属城市 &&
      board.城市?.some((city) => city.id === t.所属城市))),
    "区域缺少有效城市归属或跨越城市边境", "区域均属于本城领土");
  add(checks, "CITY_CENTERS", (board.城市 ?? []).every((city) => {
    const tile = board.tiles.get(key(city.中心));
    return tile && !isWaterTile(tile) && !tile.地形.endsWith("_MOUNTAIN") &&
      tile.区域 === "DISTRICT_CITY_CENTER" && tile.所属城市 === city.id;
  }), "城市中心不在合法本城陆地上", "城市中心位于合法本城陆地");
  const cities = (board.城市 ?? []).map((city) => {
    const territory = [...owners].filter(([, owner]) => owner === city.id).map(([id]) => id);
    const districtCandidates: Record<string, number> = {};
    for (const districtId of DISTRICTS) districtCandidates[districtId] = territory.filter((id) => {
      const tile = board.tiles.get(id)!;
      if (tile.区域) return false;
      return validateDistrictPlacement(rules, board, parseKey(id), districtId,
        { mode: "自由", selectedCityId: city.id }).every((issue) => issue.layer === "研究");
    }).length;
    return { id: city.id, name: city.名称, territoryTiles: territory.length,
      buildableTiles: territory.filter((id) => rules.buildableTerrain.has(board.tiles.get(id)!.地形)).length,
      districtCandidates };
  });
  const sealed = (board.城市 ?? []).some((city) => neighbors(city.中心).every((p) => {
    const tile = board.tiles.get(key(p)); return !tile || isWaterTile(tile) || tile.地形.endsWith("_MOUNTAIN");
  }));
  const allDistricts = cities.every((city) => DISTRICTS.every((id) => city.districtCandidates[id] > 0));
  const planningPassed = !sealed && allDistricts;
  if (!planningPassed) checks.push({ code: "CITY_PLANNING_BLOCKED", severity: "error",
    message: sealed ? "至少一座城市被山脉或水面封死" : "至少一座城市缺少常规区域合法候选位" });
  else checks.push({ code: "CITY_PLANNING", severity: "pass", message: "每城均有四种常规区域候选位" });
  const planning = { passed: planningPassed,
    minimumBuildableTiles: cities.length ? Math.min(...cities.map((city) => city.buildableTiles)) : 0 };

  const targets = [
    targetCheck("TARGET_OCEAN", "水域", surface.water, total, bands.ocean),
    targetCheck("TARGET_RELIEF", "丘陵与山脉", reliefIds.length, surface.land, bands.relief),
    targetCheck("TARGET_MOUNTAINS", "山脉", mountainIds.length, surface.land, bands.mountains),
    targetCheck("TARGET_DESERT", "沙漠", desertIds.length, surface.land, bands.desert),
    targetCheck("TARGET_RESOURCES", "资源", resources.total, total, bands.resources),
  ];
  const riverPassed = rivers.count === bands.rivers.count && rivers.segments >= bands.rivers.segments[0] &&
    rivers.segments <= bands.rivers.segments[1];
  targets.push({ code: "TARGET_RIVERS", label: "河流", actual: rivers.segments, denominator: 1,
    ratio: rivers.segments, target: bands.rivers.segments, passed: riverPassed,
    normalizedDeviation: riverPassed ? 0 : Math.min(Math.abs(rivers.segments - bands.rivers.segments[0]),
      Math.abs(rivers.segments - bands.rivers.segments[1])) / Math.max(1, bands.rivers.segments[1] - bands.rivers.segments[0]) });

  const failures = checks.filter((check) => check.severity === "error");
  const missed = targets.filter((target) => !target.passed);
  const status = failures.length ? "error" : missed.length ? "warning" : "ok";
  const warning = status === "warning"
    ? `地图合法，但有 ${missed.length} 项参数存在偏差：${missed.map((x) => x.label).join("、")}`
    : undefined;
  return { version: MAP_GENERATOR_VERSION, status, warning, config, metadata, surface, rivers, resources, cities, polarActual,
    planning, targets, checks };
}

export const hardFailures = (report: MapGenerationReport): readonly MapCheck[] =>
  report.checks.filter((check) => check.severity === "error");

export const candidateScore = (report: MapGenerationReport): readonly number[] => [
  report.planning.passed ? 1 : 0,
  report.targets.filter((target) => target.passed).length,
  -report.targets.reduce((sum, target) => sum + target.normalizedDeviation, 0),
  -(report.metadata.candidateIndex ?? report.metadata.attempts),
];
