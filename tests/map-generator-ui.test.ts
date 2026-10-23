import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateMapCandidate, MAP_PRESETS, type MapGeneratorConfig } from "../src/map_generator.ts";
import { analyzeGeneratedMap } from "../src/map_report.ts";
import {
  mapConfigFromForm, mergeGeneratedBoard, preserveBoardOnGenerationFailure,
  renderMapGeneratorContent,
  captureMapState, restoreMapState, resetGeneratedBoard, refreshMapReport, renderMapReportSummary,
} from "../web/map_generator_ui.ts";
import { R } from "./helpers.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const page = readFileSync(`${root}/web/index.html`, "utf8");
const appSource = readFileSync(`${root}/web/app.ts`, "utf8");

test("自由模式提供独立地图生成入口和完整设置弹窗", () => {
  assert.match(page, /id="map-generator"/);
  assert.match(page, /id="map-generator-modal"/);
  assert.match(page, /id="map-generator-content"/);
  const html = renderMapGeneratorContent(MAP_PRESETS.balanced);
  for (const id of ["balanced", "mountain-basin", "arid-valley", "coastal-cities"])
    assert.match(html, new RegExp(`data-map-preset="${id}"`));
  for (const name of ["cityCount", "ocean", "relief", "desert", "rivers", "resources", "polar", "seed"])
    assert.match(html, new RegExp(`name="${name}"`));
  assert.match(appSource, /app\.mode === "自由"/);
  assert.match(appSource, /mapGenerator\.hidden/);
});

test("任意参数修改成为自定义，seed=0不被当作空值", () => {
  const config = mapConfigFromForm({
    preset: "balanced", cityCount: "3", ocean: "high", relief: "standard",
    desert: "standard", rivers: "standard", resources: "standard", polar: "random", seed: "0",
  });
  assert.equal(config.preset, "custom");
  assert.equal(config.seed, 0);
});

test("报告显示请求实际值、计数分母、尝试次数和警告", () => {
  const board = generateMapCandidate(MAP_PRESETS.balanced, 1);
  const report = analyzeGeneratedMap(R, board, MAP_PRESETS.balanced,
    { baseSeed: 0, candidateSeed: 1, attempts: 2 });
  const html = renderMapGeneratorContent(MAP_PRESETS.balanced, report);
  assert.match(html, /请求/);
  assert.match(html, /实际/);
  assert.match(html, /\d+\s*\/\s*\d+/);
  assert.match(html, /尝试 2 次/);
  assert.match(html, /参数.*偏差|全部参数目标命中/);
  assert.match(html, /<details/);
});

test("完整报告用河段单位并展示城市规划位、极地和资源类别", () => {
  const board = generateMapCandidate(MAP_PRESETS.balanced, 1);
  const report = analyzeGeneratedMap(R, board, MAP_PRESETS.balanced,
    { baseSeed: 0, candidateSeed: 1, attempts: 2 });
  const sample = { ...report, version: "1", polarActual: "north" as const,
    surface: { ...report.surface, tundra: 12 },
    rivers: { ...report.rivers, count: 1, segments: 19, riversideLand: 24,
      riversideLandRatio: 0.16, outlets: { sea: 1, lake: 0 } },
    resources: { total: 10, byCategory: { 加成: 6, 战略: 4 } },
    targets: [{ code: "TARGET_RIVERS", label: "河流", actual: 19, denominator: 1,
      ratio: 19, target: [15, 23] as const, passed: true, normalizedDeviation: 0 }],
    cities: [{ id: "A", name: "样板城", territoryTiles: 37, buildableTiles: 28,
      districtCandidates: { DISTRICT_CAMPUS: 7, DISTRICT_HOLY_SITE: 8,
        DISTRICT_COMMERCIAL_HUB: 9, DISTRICT_INDUSTRIAL_ZONE: 10 } }],
  };
  const html = renderMapGeneratorContent(MAP_PRESETS.balanced, sample);
  assert.doesNotMatch(html, /1900\.0%/);
  for (const text of ["19 段", "样板城", "学院 7", "圣地 8", "商业中心 9", "工业区 10",
    "加成 6", "战略 4", "北缘", "冻土 12", "入海 1", "入湖 0", "基础种子 0", "版本 1"])
    assert.ok(html.includes(text), `报告缺少 ${text}`);
});

test("成功生成只替换地图结构，保留文明体系并可由一次撤销恢复", () => {
  const old = generateMapCandidate({ ...MAP_PRESETS.balanced, seed: 10 }, 10);
  const context = { ...old, 文明: "CIVILIZATION_JAPAN", 领袖: "LEADER_HOJO",
    已解锁科技: new Set(["TECH_MINING"]), 已解锁市政: new Set(["CIVIC_CRAFTSMANSHIP"]),
    已装配政策: new Set(["POLICY_NATURAL_PHILOSOPHY"]), 已选宗教信条: new Set(["BELIEF_WORK_ETHIC"]) };
  const generated = generateMapCandidate({ ...MAP_PRESETS["coastal-cities"], seed: 11 }, 11);
  const merged = mergeGeneratedBoard(context, generated);
  assert.equal(merged.tiles, generated.tiles);
  assert.equal(merged.城市, generated.城市);
  assert.equal(merged.河道, generated.河道);
  assert.equal(merged.文明, context.文明);
  assert.equal(merged.领袖, context.领袖);
  assert.equal(merged.已解锁科技, context.已解锁科技);
  assert.equal(merged.已解锁市政, context.已解锁市政);
  assert.equal(merged.已装配政策, context.已装配政策);
  assert.equal(merged.已选宗教信条, context.已选宗教信条);
  const undo = [context];
  assert.equal(undo.pop(), context);
});

test("生成失败保持旧局面引用，挑战模式不展示入口", () => {
  const old = generateMapCandidate(MAP_PRESETS.balanced, 12);
  assert.equal(preserveBoardOnGenerationFailure(old), old);
  assert.match(appSource, /mapGenerator\.hidden = app\.mode !== "自由"/);
});

test("撤销恢复地图对应配置报告与种子，重置还原本次生成模板", () => {
  const input = { ...MAP_PRESETS["coastal-cities"], seed: 11 };
  const generated = generateMapCandidate(input, 11);
  const old = { board: generated, mapConfigDraft: input, randomSeed: 11,
    selectedCity: "D", mapInitialBoard: generated,
    mapReport: analyzeGeneratedMap(R, generated, input, { baseSeed: 11, candidateSeed: 11, attempts: 1 }) };
  const saved = captureMapState(old);
  const next = { ...old, board: generateMapCandidate(MAP_PRESETS.balanced, 1), randomSeed: 1 };
  const restored = restoreMapState(next, saved);
  assert.equal(restored.board, generated);
  assert.equal(restored.randomSeed, 11);
  assert.equal(restored.mapConfigDraft, input);
  assert.equal(restored.mapReport, old.mapReport);
  const changed = new Map(generated.tiles); changed.set("0,0", { 地形: "TERRAIN_DESERT" });
  const reset = resetGeneratedBoard({ ...generated, tiles: changed, 文明: "CIVILIZATION_JAPAN" }, generated);
  assert.equal(reset.tiles, generated.tiles);
  assert.equal(reset.城市?.length, 4);
  assert.equal(reset.文明, "CIVILIZATION_JAPAN");
});

test("地图编辑后的报告实时复算，软偏差摘要可以在主界面展示", () => {
  const input = { ...MAP_PRESETS.balanced, seed: 0 };
  const b = generateMapCandidate(input, 0);
  const report = analyzeGeneratedMap(R, b, input, { baseSeed: 0, candidateSeed: 0, attempts: 1 });
  const tiles = new Map(b.tiles);
  const land = [...tiles].find(([, t]) => !t.湖泊 && t.地形 === "TERRAIN_GRASS" && !t.区域)![0];
  tiles.set(land, { 地形: "TERRAIN_COAST" });
  const updated = refreshMapReport(R, { ...b, tiles }, report);
  assert.equal(updated.surface.water, report.surface.water + 1);
  assert.match(renderMapReportSummary({ ...report, status: "warning", warning: "山地低于请求目标" }),
    /山地低于请求目标/);
});
