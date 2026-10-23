import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boardToData, boardFromData } from "../src/board_file.ts";
import { compareBoards } from "../src/compare.ts";
import { type BoardState } from "../src/board.ts";
import { type MapStateSnapshot } from "../web/map_generator_ui.ts";
import { parsePlan, serializePlan, readWorkspace, MAX_PLAN_LENGTH } from "../web/plan_files.ts";
import { syncRiverBanks } from "../src/river.ts";
import { PlanWorkspace } from "../web/workspace.ts";
import { R } from "./helpers.ts";
import { board } from "./helpers.ts";
import { add, ZERO, eq } from "../src/rational.ts";
import { parseCsv } from "../src/csv.ts";
import { generateSandboxMap, MAP_PRESETS } from "../src/map_generator.ts";

const catalog = {
  techs: new Set(["TECH_ASTROLOGY", "TECH_WRITING", "TECH_MINING"]),
  civics: new Set(["CIVIC_STATE_WORKFORCE", "CIVIC_DRAMA_POETRY"]),
  improvements: new Set(parseCsv(readFileSync(new URL("../配置表/improvements.csv", import.meta.url), "utf8"))
    .map(r => r["改良设施id"])),
};

const baseBoard = (): BoardState => syncRiverBanks({
  tiles: new Map([
    ["0,0", { 地形: "TERRAIN_GRASS", 区域: "DISTRICT_CITY_CENTER",
      所属城市: "A", 建筑: ["BUILDING_PALACE"], 淡水: true }],
    ["1,0", { 地形: "TERRAIN_GRASS_MOUNTAIN", 所属城市: "A" }],
    ["0,1", { 地形: "TERRAIN_GRASS", 所属城市: "A" }],
    ["-1,0", { 地形: "TERRAIN_GRASS", 区域: "DISTRICT_CAMPUS",
      所属城市: "A", 建筑: ["BUILDING_LIBRARY"] }],
    ["4,0", { 地形: "TERRAIN_GRASS", 区域: "DISTRICT_CITY_CENTER",
      所属城市: "B", 建筑: ["BUILDING_PALACE"] }],
    ["3,0", { 地形: "TERRAIN_COAST", 资源: "RESOURCE_FISH",
      所属城市: "B", 湖泊: true }],
  ]),
  河道: [[{ x: 1, y: -1 }, { x: 1, y: 1 }, { x: 0, y: 2 }]],
  中心: { q: 0, r: 0 },
  人口: 6,
  城市: [
    { id: "A", 名称: "阿尔法", 中心: { q: 0, r: 0 }, 人口: 6 },
    { id: "B", 名称: "贝塔", 中心: { q: 4, r: 0 }, 人口: 4 },
  ],
  文明: "CIVILIZATION_GERMANY",
  领袖: "LEADER_BARBAROSSA",
  已解锁科技: new Set(["TECH_ASTROLOGY", "TECH_WRITING"]),
  已解锁市政: new Set(["CIVIC_STATE_WORKFORCE"]),
  已装配政策: new Set(["POLICY_NATURAL_PHILOSOPHY"]),
  已选宗教信条: new Set(["BELIEF_WORK_ETHIC"]),
});

test("导入拒绝穿格、断流、重复顶点；合法河道重新派生临河加成", () => {
  for (const path of [
    [{ x: 1, y: -1 }, { x: 20, y: 20 }, { x: 0, y: 2 }],
    [{ x: 1, y: -1 }, { x: 1, y: -1 }, { x: 0, y: 2 }],
  ]) {
    const data = boardToData(baseBoard());
    assert.throws(() => boardFromData({ ...data, 河道: [path] }, R, catalog), /河段|河道/);
  }
  const data = boardToData(baseBoard());
  const tampered = { ...data, tiles: data.tiles.map(([id, tile]) =>
    [id, { ...tile, 河流边: id === "-1,0" }]) };
  const result = boardFromData(tampered, R, catalog);
  assert.equal(result.tiles.get("0,0")?.河流边, true);
  assert.equal(result.tiles.get("-1,0")?.河流边, undefined);
  assert.equal(boardFromData({ ...tampered, 河道: [] }, R, catalog).tiles.get("-1,0")?.河流边, undefined);
  assert.equal(boardFromData({ ...tampered, 河道: undefined }, R, catalog).tiles.get("-1,0")?.河流边, true);
});

test("本机工作区按 UTF-8 字节限制读取，超大快照失败保留原方案", () => {
  const oversized = "中".repeat(Math.floor(MAX_PLAN_LENGTH / 3) + 1);
  assert.ok(oversized.length < MAX_PLAN_LENGTH);
  assert.throws(() => readWorkspace({ getItem: () => JSON.stringify({ version: 1, A: oversized }) }), /存档损坏/);
  const ws = new PlanWorkspace({ getItem: () => null, setItem: () => {} }, R, catalog, "test");
  ws.saveSlot("A", snapshot(baseBoard()));
  const previous = ws.saved.A;
  assert.throws(() => ws.saveSlot("A", { ...snapshot(baseBoard()), extra: oversized } as MapStateSnapshot), /超过 2 MB/);
  assert.equal(ws.saved.A, previous);
});

const snapshot = (board: BoardState): MapStateSnapshot => ({
  board,
  mapInitialBoard: board,
  mapConfigDraft: {
    preset: "balanced", cityCount: 2, ocean: "standard", relief: "standard",
    desert: "standard", rivers: "standard", resources: "standard", polar: "none", seed: 7,
  },
  randomSeed: 7,
  selectedCity: "A",
});

test("规划存档完整往返保留 Map、Set、河流、城市、建筑和研究状态", () => {
  const text = serializePlan(snapshot(baseBoard()), "build-test");
  const restored = parsePlan(text, R, catalog);
  assert.deepEqual(
    [...restored.board.tiles].sort(([a], [b]) => a.localeCompare(b)),
    [...baseBoard().tiles].sort(([a], [b]) => a.localeCompare(b)),
  );
  assert.deepEqual(restored.board.河道, baseBoard().河道);
  assert.deepEqual(restored.board.城市, baseBoard().城市);
  assert.deepEqual([...restored.board.已解锁科技], ["TECH_ASTROLOGY", "TECH_WRITING"]);
  assert.deepEqual([...restored.board.已装配政策], ["POLICY_NATURAL_PHILOSOPHY"]);
  assert.deepEqual([...restored.board.已选宗教信条], ["BELIEF_WORK_ETHIC"]);
  assert.equal(restored.selectedCity, "A");
});

test("非法存档在未知 ID、重复坐标和未知改良设施时拒绝", () => {
  const valid = JSON.parse(serializePlan(snapshot(baseBoard()), "build-test"));
  valid.state.board.tiles[0][1].区域 = "DISTRICT_NOT_REAL";
  assert.throws(() => parsePlan(JSON.stringify(valid), R, catalog), /未知 ID/);

  const duplicate = JSON.parse(serializePlan(snapshot(baseBoard()), "build-test"));
  duplicate.state.board.tiles.push(duplicate.state.board.tiles[0]);
  assert.throws(() => parsePlan(JSON.stringify(duplicate), R, catalog), /坐标重复/);

  const improvement = JSON.parse(serializePlan(snapshot(baseBoard()), "build-test"));
  improvement.state.board.tiles[0][1].改良设施 = "IMPROVEMENT_NOT_REAL";
  assert.throws(() => parsePlan(JSON.stringify(improvement), R, catalog), /改良设施/);
});

test("改良设施、世界奇观与生成模板不丢失，派生报告在读取时重新计算", () => {
  const generated = generateSandboxMap(R, { ...MAP_PRESETS["mountain-basin"], seed: 8 });
  const state = snapshot(generated.board);
  state.mapReport = generated.report;
  state.mapInitialBoard = generated.board;
  const tiles = new Map(generated.board.tiles);
  const k = [...tiles.keys()][0];
  tiles.set(k, { ...tiles.get(k)!, 改良设施: "IMPROVEMENT_MINE", 世界奇观: "BUILDING_PYRAMIDS" });
  state.board = { ...generated.board, tiles };
  const restored = parsePlan(serializePlan(state, "test"), R, {
    ...catalog, techs: generated.board.已解锁科技, civics: generated.board.已解锁市政,
  });
  assert.equal(restored.board.tiles.get(k)?.改良设施, "IMPROVEMENT_MINE");
  assert.equal(restored.board.tiles.get(k)?.世界奇观, "BUILDING_PYRAMIDS");
  assert.equal(restored.mapInitialBoard?.tiles.get(k)?.改良设施, undefined);
  assert.ok(restored.mapReport);
  assert.equal(restored.mapReport.surface.total, restored.board.tiles.size);
});

test("损坏版本、未知城市、科技、政策和宗教 ID 不会通过导入", () => {
  for (const mutate of [
    (f: any) => f.version = 2,
    (f: any) => f.state.board.tiles[0][1].所属城市 = "missing",
    (f: any) => f.state.board.已解锁科技 = ["TECH_BAD"],
    (f: any) => f.state.board.已装配政策 = ["POLICY_BAD"],
    (f: any) => f.state.board.已选宗教信条 = ["BELIEF_BAD"],
    (f: any) => f.state.mapConfigDraft.seed = -1,
  ]) {
    const state = snapshot(baseBoard()), before = serializePlan(state, "test");
    const file = JSON.parse(before);
    mutate(file);
    assert.throws(() => parsePlan(JSON.stringify(file), R, catalog));
    assert.equal(serializePlan(state, "test"), before, "失败不能修改原局面");
  }
});

test("本机存储不可用时仍可在内存保存与导出；坏存档不被下一次保存覆盖", () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  const ws = new PlanWorkspace(storage, R, catalog, "test");
  ws.update(snapshot(baseBoard()));
  assert.match(ws.status, /请导出 JSON/);
  assert.ok(ws.restore("current")?.board.tiles instanceof Map);
  assert.doesNotThrow(() => ws.encode(snapshot(baseBoard())));
  let writes = 0;
  const broken = new PlanWorkspace({ getItem: () => "broken",
    setItem: () => { writes++; } }, R, catalog, "test");
  broken.update(snapshot(baseBoard()));
  assert.equal(writes, 0);
  assert.match(broken.status, /原数据保留/);
});

test("逐规则差值保留韩国负贡献，且每种产出的差值加和等于总差值", () => {
  const a = board({ "0,0": { 地形: "TERRAIN_GRASS_HILLS", 区域: "DISTRICT_CAMPUS" },
    "1,0": {}, "2,0": {} }, { 文明: "CIVILIZATION_KOREA" });
  const b = { ...a, tiles: new Map(a.tiles) };
  b.tiles.set("1,0", { 地形: "TERRAIN_GRASS", 区域: "DISTRICT_HOLY_SITE" });
  const c = compareBoards(R, a, b);
  assert.ok(c.changes.some(v => v.delta.n < 0 && v.position === "0,0"));
  for (const [y, delta] of c.delta) {
    const sum = c.changes.filter(v => v.yield === y).reduce((s,v) => add(s, v.delta), ZERO);
    assert.ok(eq(sum, delta), y);
  }
  assert.equal(c.sameGeography, true);
  assert.equal(compareBoards(R, a, { ...a, tiles: new Map([...a.tiles].reverse()) }).sameGeography, true);
  assert.equal(compareBoards(R, a, { ...a, tiles: new Map([["0,0",
    { 地形: "TERRAIN_DESERT" }]]) }).sameGeography, false);
});

test("PlanWorkspace 自动保存 current，A/B 快照互相独立，坏读取不覆盖数据", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
  const ws = new PlanWorkspace(storage, R, catalog, "build-test");
  const a = snapshot(baseBoard());
  const b = snapshot({ ...baseBoard(), 文明: "CIVILIZATION_KOREA",
    领袖: "LEADER_SEONDEOK" });
  ws.update(a);
  ws.saveSlot("A", a);
  ws.saveSlot("B", b);
  assert.equal(ws.restore("A")?.board.文明, "CIVILIZATION_GERMANY");
  assert.equal(ws.restore("B")?.board.文明, "CIVILIZATION_KOREA");
  assert.ok(ws.restore("current"));

  data.set("civ6-planner-workspace-v1", JSON.stringify({
    version: 1, current: "{bad json",
  }));
  const broken = new PlanWorkspace(storage, R, catalog, "build-test");
  assert.equal(broken.blocked, true);
  assert.match(broken.status, /无法读取本机存档/);
  assert.equal(broken.saved.current, undefined);
});

test("A/B 比较同时给出总产出、城市差异和具体规则贡献差异", () => {
  const a = baseBoard();
  const b: BoardState = { ...a, tiles: new Map(a.tiles) };
  b.tiles.set("2,0", { 地形: "TERRAIN_GRASS", 区域: "DISTRICT_CAMPUS", 所属城市: "A" });
  const result = compareBoards(R, a, b);
  assert.ok(result.changes.length > 0);
  assert.ok(result.changes.some((change) => change.position === "2,0"));
  assert.ok(result.cities.some((city) => city.id === "A" &&
    [...city.delta.values()].some((value) => value.n !== 0)));
  assert.ok([...result.delta.values()].some((value) => value.n !== 0));
});
