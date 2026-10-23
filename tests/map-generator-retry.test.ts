import test from "node:test";
import assert from "node:assert/strict";
import { type BoardState, type City, type Tile } from "../src/board.ts";
import { disc, key, type Axial } from "../src/hex.ts";
import {
  MAP_PRESETS, MapGenerationError, generateMapCandidate, generateSandboxMap,
  type CandidateBuilder, type MapGeneratorConfig,
} from "../src/map_generator.ts";
import { hardFailures } from "../src/map_report.ts";
import { analyzeGeneratedMap } from "../src/map_report.ts";
import { R } from "./helpers.ts";

const city = (id: string, center: Axial): City => ({ id, 名称: `${id}城`, 中心: center, 人口: 10 });
const boardWith = (waterCount: number, cityCount = 2): BoardState => {
  const points = disc(7), tiles = new Map<string, Tile>(points.map((p) => [key(p), { 地形: "TERRAIN_GRASS" }]));
  for (const p of points.slice(-waterCount)) tiles.set(key(p), { 地形: "TERRAIN_COAST" });
  const centers = [{ q: -2, r: 0 }, { q: 2, r: 0 }, { q: 0, r: -4 }, { q: 0, r: 4 }].slice(0, cityCount);
  const cities = centers.map((p, i) => city(String.fromCharCode(65 + i), p));
  for (const c of cities) tiles.set(key(c.中心), { 地形: "TERRAIN_GRASS", 区域: "DISTRICT_CITY_CENTER", 所属城市: c.id });
  return { tiles, 城市: cities, 河道: [], 中心: centers[0], 人口: 10,
    已解锁科技: new Set(), 已解锁市政: new Set(), 已装配政策: new Set(), 已选宗教信条: new Set() };
};
const config = (patch: Partial<MapGeneratorConfig> = {}): MapGeneratorConfig =>
  ({ ...MAP_PRESETS.balanced, cityCount: 2, rivers: "low", polar: "none", seed: 100, ...patch });

test("首个全达标合法候选立即返回", () => {
  const seeds: number[] = [];
  const build: CandidateBuilder = (_config, seed) => { seeds.push(seed); return generateMapCandidate(config(), 1); };
  const result = generateSandboxMap(R, config({ seed: 0xffffffff }), { buildCandidate: build, maxAttempts: 4 });
  assert.equal(result.report.metadata.attempts, 1);
  assert.deepEqual(seeds, [0xffffffff]);
});

test("候选种子按32位无符号加法派生", () => {
  const seeds: number[] = [];
  const build: CandidateBuilder = (_config, seed) => { seeds.push(seed); return boardWith(20, 1); };
  assert.throws(() => generateSandboxMap(R, config({ seed: 0xffffffff }),
    { buildCandidate: build, maxAttempts: 3 }), MapGenerationError);
  assert.deepEqual(seeds, [0xffffffff, 0, 1]);
});

test("前23次硬失败时第24次合法候选仍可返回", () => {
  let calls = 0;
  const build: CandidateBuilder = (_config, _seed) => ++calls < 24 ? boardWith(20, 1) : generateMapCandidate(config(), 31);
  const result = generateSandboxMap(R, config(), { buildCandidate: build });
  assert.equal(calls, 24);
  assert.equal(result.report.metadata.attempts, 24);
  assert.equal(hardFailures(result.report).length, 0);
});

test("24次全部硬失败抛结构化错误并按code聚合原因", () => {
  const build: CandidateBuilder = (_config, _seed) => boardWith(20, 1);
  assert.throws(() => generateSandboxMap(R, config(), { buildCandidate: build }), (error) => {
    assert.ok(error instanceof MapGenerationError);
    assert.equal(error.attempts, 24);
    assert.equal(error.reasons.CITY_COUNT, 24);
    assert.match(error.message, /CITY_COUNT|城市/);
    return true;
  });
});

test("仅有软偏差时跑满上限选评分最高候选并明确warning", () => {
  let calls = 0;
  const build: CandidateBuilder = (_config, _seed) => {
    calls++;
    return generateMapCandidate({ ...config(), ocean: calls === 2 ? "standard" : "low" }, 40 + calls);
  };
  const result = generateSandboxMap(R, config({ ocean: "high" }), { buildCandidate: build, maxAttempts: 3 });
  assert.equal(calls, 3);
  assert.equal(result.report.status, "warning");
  assert.ok(result.report.warning?.includes("偏差"));
  assert.ok(result.report.targets.some((target) => !target.passed));
  assert.equal(result.report.metadata.attempts, 3);
});

test("保留韩国文明后仍须在最终局面找到书院规划位", () => {
  const input = { ...MAP_PRESETS["coastal-cities"], seed: 1 };
  const result = generateSandboxMap(R, input, { context: { 文明: "CIVILIZATION_KOREA" } } as never);
  const final = { ...result.board, 文明: "CIVILIZATION_KOREA" };
  assert.deepEqual(hardFailures(analyzeGeneratedMap(R, final, input, result.report.metadata)), []);
  assert.equal(result.board.文明, "CIVILIZATION_KOREA");
});

test("构造失败向用户保留具体中文原因", () => {
  assert.throws(() => generateSandboxMap(R, config(), { maxAttempts: 2,
    buildCandidate: () => { throw new Error("没有足够的临河城址"); } }),
    /没有足够的临河城址/);
});

test("双河只允许共享湖海出口，不允许共享内陆顶点", () => {
  for (const seed of [18, 33, 52]) {
    const result = generateSandboxMap(R, { ...MAP_PRESETS["arid-valley"], seed });
    const [a, b] = result.board.河道!;
    const shared = a.filter((v) => b.some((w) => v.x === w.x && v.y === w.y));
    for (const v of shared) {
      assert.deepEqual(v, a.at(-1));
      assert.deepEqual(v, b.at(-1));
    }
  }
});

test("相同输入与真实生成器得到深度一致且极端组合有界结束", () => {
  const extreme = config({ cityCount: 4, ocean: "high", relief: "high", desert: "high", rivers: "high" });
  const run = () => {
    try { return generateSandboxMap(R, extreme, { maxAttempts: 3 }); }
    catch (error) { return { name: (error as Error).name, message: (error as Error).message }; }
  };
  assert.deepEqual(run(), run());
});
