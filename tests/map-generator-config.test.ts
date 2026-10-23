import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import {
  MAP_PRESETS, normalizeMapConfig, targetBands,
  type MapGeneratorConfig,
} from "../src/map_generator.ts";

test("四个预设是同一组可编辑参数，而不是四套生成算法", () => {
  assert.deepEqual(Object.keys(MAP_PRESETS), [
    "balanced", "mountain-basin", "arid-valley", "coastal-cities",
  ]);
  assert.deepEqual(MAP_PRESETS.balanced, {
    preset: "balanced", cityCount: 3, ocean: "standard", relief: "standard",
    desert: "standard", rivers: "standard", resources: "standard",
    polar: "random", seed: 0,
  });
  assert.deepEqual(MAP_PRESETS["mountain-basin"], {
    preset: "mountain-basin", cityCount: 2, ocean: "low", relief: "high",
    desert: "low", rivers: "standard", resources: "standard", polar: "none", seed: 0,
  });
  assert.deepEqual(MAP_PRESETS["arid-valley"], {
    preset: "arid-valley", cityCount: 3, ocean: "low", relief: "standard",
    desert: "high", rivers: "high", resources: "low", polar: "none", seed: 0,
  });
  assert.deepEqual(MAP_PRESETS["coastal-cities"], {
    preset: "coastal-cities", cityCount: 4, ocean: "high", relief: "low",
    desert: "low", rivers: "low", resources: "high", polar: "random", seed: 0,
  });
});

test("修改预设参数会标为自定义，种子变化不会抹掉预设身份", () => {
  assert.equal(normalizeMapConfig({ ...MAP_PRESETS.balanced, seed: 9 }).preset, "balanced");
  assert.equal(normalizeMapConfig({ ...MAP_PRESETS.balanced, ocean: "high" }).preset, "custom");
  assert.equal(normalizeMapConfig({ ...MAP_PRESETS.balanced, seed: 0 }).seed, 0);
  assert.equal(normalizeMapConfig({ ...MAP_PRESETS.balanced, seed: 0x1FFFFFFFF }).seed, 0xFFFFFFFF);
});

test("错误配置指出具体字段，不把异常输入静默改成默认值", () => {
  assert.throws(() => normalizeMapConfig({
    ...MAP_PRESETS.balanced, cityCount: 5,
  } as unknown as MapGeneratorConfig), /cityCount/);
  assert.throws(() => normalizeMapConfig({
    ...MAP_PRESETS.balanced, polar: "both",
  } as unknown as MapGeneratorConfig), /polar/);
  assert.throws(() => normalizeMapConfig({
    ...MAP_PRESETS.balanced, seed: 1.5,
  } as unknown as MapGeneratorConfig), /seed/);
});

test("档位映射使用固定区间，河流按条数和河段而非地块占比", () => {
  assert.deepEqual(targetBands({ ...MAP_PRESETS.balanced, ocean: "low" }).ocean, [0.06, 0.10]);
  assert.deepEqual(targetBands(MAP_PRESETS.balanced).ocean, [0.11, 0.17]);
  assert.deepEqual(targetBands({ ...MAP_PRESETS.balanced, ocean: "high" }).ocean, [0.18, 0.28]);
  assert.deepEqual(targetBands({ ...MAP_PRESETS.balanced, relief: "low" }).relief, [0.10, 0.16]);
  assert.deepEqual(targetBands(MAP_PRESETS.balanced).mountains, [0.04, 0.08]);
  assert.deepEqual(targetBands({ ...MAP_PRESETS.balanced, relief: "high" }).mountains, [0.08, 0.13]);
  assert.deepEqual(targetBands({ ...MAP_PRESETS.balanced, desert: "high" }).desert, [0.18, 0.28]);
  assert.deepEqual(targetBands({ ...MAP_PRESETS.balanced, resources: "low" }).resources, [0.03, 0.05]);
  assert.deepEqual(targetBands({ ...MAP_PRESETS.balanced, rivers: "low" }).rivers,
    { count: 1, segments: [8, 14] });
  assert.deepEqual(targetBands(MAP_PRESETS.balanced).rivers,
    { count: 1, segments: [15, 23] });
  assert.deepEqual(targetBands({ ...MAP_PRESETS.balanced, rivers: "high" }).rivers,
    { count: 2, segments: [24, 36] });
});

test("浏览器单文件包可独立加载地图报告，不受模块初始化顺序影响", () => {
  const bundlePath = fileURLToPath(new URL("../web/dist/app.bundle.js", import.meta.url));
  const source = readFileSync(bundlePath, "utf8").replace(
    '__require("web/app");',
    `globalThis.__mapTest = {
      generator: __require("src/map_generator"),
      report: __require("src/map_report"),
      Rules: __require("src/rules").Rules,
      tables: __require("web/tables.gen").TABLE_TEXTS,
    };`,
  );
  const context: Record<string, unknown> = { console };
  runInNewContext(source, context);
  const api = context.__mapTest as {
    generator: typeof import("../src/map_generator.ts");
    report: typeof import("../src/map_report.ts");
    Rules: typeof import("../src/rules.ts").Rules;
    tables: Record<string, string>;
  };
  const config = { ...api.generator.MAP_PRESETS.balanced, cityCount: 2 as const,
    rivers: "low" as const, polar: "none" as const, seed: 0 };
  const board = api.generator.generateMapCandidate(config, 0);
  const report = api.report.analyzeGeneratedMap(
    new api.Rules(api.tables as never), board, config,
    { baseSeed: 0, candidateSeed: 0, attempts: 1 },
  );
  assert.equal(report.config.seed, 0);
  assert.equal(report.surface.total, 169);
});
