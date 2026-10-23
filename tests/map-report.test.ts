import test from "node:test";
import assert from "node:assert/strict";
import { type BoardState, type City, type RiverPath, type Tile } from "../src/board.ts";
import { disc, distance, key, neighbors, type Axial } from "../src/hex.ts";
import { buildRiverGraph, isWaterTile, vertexKey } from "../src/river.ts";
import { analyzeGeneratedMap, candidateScore, hardFailures } from "../src/map_report.ts";
import { MAP_PRESETS, generateSandboxMap, type MapGeneratorConfig } from "../src/map_generator.ts";
import { R } from "./helpers.ts";

const city = (id: string, center: Axial): City => ({ id, 名称: `${id}城`, 中心: center, 人口: 10 });
const baseBoard = (tiles: ReadonlyMap<string, Tile>, cities: readonly City[], 河道?: readonly RiverPath[]): BoardState => ({
  tiles, 城市: cities, 河道, 中心: cities[0]?.中心 ?? { q: 0, r: 0 }, 人口: 10,
  已解锁科技: new Set(), 已解锁市政: new Set(), 已装配政策: new Set(), 已选宗教信条: new Set(),
});
const cfg = (patch: Partial<MapGeneratorConfig> = {}): MapGeneratorConfig =>
  ({ ...MAP_PRESETS.balanced, polar: "north", seed: 7, cityCount: 2, ...patch });
const metadata = { baseSeed: 7, candidateSeed: 8, attempts: 2 };

function measuredBoard(): BoardState {
  const points = disc(3), tiles = new Map<string, Tile>(points.map((p) => [key(p), { 地形: "TERRAIN_GRASS" }]));
  tiles.set("3,0", { 地形: "TERRAIN_COAST" });
  tiles.set("2,0", { 地形: "TERRAIN_COAST", 湖泊: true });
  tiles.set("0,-3", { 地形: "TERRAIN_TUNDRA_HILLS" });
  tiles.set("0,-2", { 地形: "TERRAIN_GRASS_MOUNTAIN" });
  tiles.set("-2,0", { 地形: "TERRAIN_DESERT", 资源: "RESOURCE_STONE" });
  tiles.set("-2,1", { 地形: "TERRAIN_DESERT_HILLS", 资源: "RESOURCE_IRON" });
  tiles.set("-3,1", { 地形: "TERRAIN_DESERT" });
  return baseBoard(tiles, [city("A", { q: -1, r: 0 }), city("B", { q: 1, r: -2 })]);
}

function validRiverBoard(): BoardState {
  const tiles = new Map<string, Tile>(disc(4).map((p) => [key(p), { 地形: "TERRAIN_GRASS" }]));
  tiles.set("3,0", { 地形: "TERRAIN_COAST" });
  const graph = buildRiverGraph(tiles);
  const outlet = [...graph.vertices.keys()].find((id) => {
    const incident = graph.incidentTiles.get(id)!;
    return incident.some((tileId) => isWaterTile(tiles.get(tileId)!)) &&
      incident.some((tileId) => !isWaterTile(tiles.get(tileId)!));
  })!;
  const landVertices = [...graph.vertices.keys()].filter((id) =>
    graph.incidentTiles.get(id)!.length === 3 &&
    graph.incidentTiles.get(id)!.every((tileId) => !isWaterTile(tiles.get(tileId)!)));
  const queue = landVertices.map((id) => [id]);
  let ids: string[] | undefined;
  while (queue.length && !ids) {
    const path = queue.shift()!;
    const here = path.at(-1)!;
    for (const edgeId of graph.adjacent.get(here) ?? []) {
      const edge = graph.edges.get(edgeId)!;
      if (edge.tiles.some((tileId) => isWaterTile(tiles.get(tileId)!))) continue;
      const next = vertexKey(edge.a) === here ? vertexKey(edge.b) : vertexKey(edge.a);
      if (path.includes(next)) continue;
      if (next === outlet && path.length >= 2) { ids = [...path, next]; break; }
      if (graph.incidentTiles.get(next)?.every((tileId) => !isWaterTile(tiles.get(tileId)!))) queue.push([...path, next]);
    }
  }
  assert.ok(ids);
  return baseBoard(tiles, [city("A", { q: -2, r: 0 }), city("B", { q: 2, r: -2 })],
    [ids.map((id) => graph.vertices.get(id)!)]);
}

test("报告只从最终局面复算地表、资源、河流与城市统计", () => {
  const report = analyzeGeneratedMap(R, measuredBoard(), cfg(), metadata);
  assert.deepEqual(report.surface, {
    total: 37, land: 35, water: 2, ocean: 1, lake: 1,
    hills: 2, mountains: 1, desert: 3, tundra: 1,
    reliefComponents: 2, desertComponents: 1, tundraComponents: 1,
  });
  assert.deepEqual(report.resources, { total: 2, byCategory: { 加成: 1, 战略: 1 } });
  assert.equal(report.rivers.count, 0);
  assert.equal(report.rivers.segments, 0);
  assert.equal(report.rivers.riversideLand, 0);
  assert.deepEqual(report.cities.map((c) => c.id), ["A", "B"]);
  assert.ok(report.cities.every((c) => c.territoryTiles > 0));

  const changed = new Map(measuredBoard().tiles);
  changed.set("1,1", { 地形: "TERRAIN_COAST" });
  const again = analyzeGeneratedMap(R, baseBoard(changed, measuredBoard().城市!), cfg(), metadata);
  assert.equal(again.surface.water, 3);
  assert.equal(again.surface.land, 34);
});

test("真实河道报告段数、出口和临河陆地比例", () => {
  const report = analyzeGeneratedMap(R, validRiverBoard(), cfg({ polar: "none" }), metadata);
  assert.equal(report.rivers.count, 1);
  assert.ok(report.rivers.segments >= 2);
  assert.ok(report.rivers.riversideLand >= 2);
  assert.ok(report.rivers.riversideLandRatio > 0);
  assert.equal(report.rivers.outlets.sea, 1);
  assert.equal(hardFailures(report).filter((item) => item.code.startsWith("RIVER_")).length, 0);
});

test("硬约束用稳定code报告坏河、极地、沙漠、城市、封死城与城心资源", () => {
  const scenarios: [string, BoardState, Partial<MapGeneratorConfig>][] = [];
  const simple = measuredBoard();
  scenarios.push(["CITY_COUNT", simple, { cityCount: 3 }]);
  scenarios.push(["CITY_DISTANCE", { ...simple, 城市: [city("A", { q: 0, r: 0 }), city("B", { q: 1, r: 0 })] }, {}]);
  const resourceCenter = new Map(simple.tiles); resourceCenter.set("-1,0", { ...resourceCenter.get("-1,0")!, 资源: "RESOURCE_IRON" });
  scenarios.push(["CITY_CENTER_RESOURCE", baseBoard(resourceCenter, simple.城市!), {}]);
  const fragmentedDesert = new Map(simple.tiles); fragmentedDesert.set("2,1", { 地形: "TERRAIN_DESERT" });
  scenarios.push(["DESERT_FRAGMENTED", baseBoard(fragmentedDesert, simple.城市!), {}]);
  const wrongPolar = new Map(simple.tiles); wrongPolar.set("0,0", { 地形: "TERRAIN_TUNDRA" });
  scenarios.push(["POLAR_POSITION", baseBoard(wrongPolar, simple.城市!), {}]);
  const blocked = new Map(simple.tiles);
  for (const p of neighbors({ q: -1, r: 0 })) blocked.set(key(p), { 地形: "TERRAIN_GRASS_MOUNTAIN" });
  scenarios.push(["CITY_PLANNING_BLOCKED", baseBoard(blocked, simple.城市!), {}]);
  const valid = validRiverBoard();
  const broken = valid.河道![0].filter((_, i) => i !== 1);
  scenarios.push(["RIVER_BROKEN", { ...valid, 河道: [broken] }, { polar: "none" }]);
  const noOutlet = valid.河道![0].slice(0, -1);
  scenarios.push(["RIVER_NO_OUTLET", { ...valid, 河道: [noOutlet] }, { polar: "none" }]);
  scenarios.push(["RIVER_OVERLAP", { ...valid, 河道: [valid.河道![0], valid.河道![0]] }, { polar: "none" }]);

  for (const [expected, board, patch] of scenarios) {
    const report = analyzeGeneratedMap(R, board, cfg(patch), metadata);
    const hit = hardFailures(report).find((item) => item.code === expected);
    assert.ok(hit, `${expected}: ${hardFailures(report).map((item) => item.code).join(",")}`);
    assert.ok(hit.message.length >= 4);
  }
});

test("规划探测不修改研究状态，评分按质量、命中、偏差、尝试序号稳定排序", () => {
  const board = measuredBoard();
  const beforeTech = [...board.已解锁科技];
  const beforeCivic = [...board.已解锁市政];
  const report = analyzeGeneratedMap(R, board, cfg(), metadata);
  assert.deepEqual([...board.已解锁科技], beforeTech);
  assert.deepEqual([...board.已解锁市政], beforeCivic);
  assert.deepEqual(candidateScore(report), [
    report.planning.passed ? 1 : 0, report.targets.filter((x) => x.passed).length,
    -report.targets.reduce((sum, x) => sum + x.normalizedDeviation, 0), -metadata.attempts,
  ]);
});

test("地图坐标、水面形态、资源兼容和区域归属都进入硬检查", () => {
  const input = { ...MAP_PRESETS.balanced, seed: 0 };
  const valid = generateSandboxMap(R, input).board;
  const cases: [string, (tiles: Map<string, Tile>) => void][] = [
    ["MAP_SIZE", (tiles) => { tiles.delete("0,7"); tiles.set("99,99", { 地形: "TERRAIN_GRASS" }); }],
    ["RESOURCE_COMPATIBILITY", (tiles) => {
      const water = [...tiles].find(([, t]) => isWaterTile(t))![0];
      tiles.set(water, { ...tiles.get(water)!, 资源: "RESOURCE_IRON" });
    }],
    ["DISTRICT_OWNER", (tiles) => {
      tiles.set("0,0", { ...tiles.get("0,0")!, 区域: "DISTRICT_CAMPUS", 所属城市: "UNKNOWN" });
    }],
    ["WATER_SHAPE", (tiles) => {
      const id = [...tiles.keys()].find((id) => !tiles.get(id)!.区域 &&
        neighbors({ q: Number(id.split(",")[0]), r: Number(id.split(",")[1]) })
          .every((p) => tiles.has(key(p)) && !isWaterTile(tiles.get(key(p))!)))!;
      tiles.set(id, { 地形: "TERRAIN_COAST" });
    }],
  ];
  for (const [code, change] of cases) {
    const tiles = new Map(valid.tiles); change(tiles);
    const report = analyzeGeneratedMap(R, { ...valid, tiles }, input, metadata);
    assert.ok(hardFailures(report).some((x) => x.code === code), code);
  }
});
