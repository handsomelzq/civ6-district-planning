import test from "node:test";
import assert from "node:assert/strict";
import {
  MAP_PRESETS, MapGenerationError, generateMapCandidate, generateSandboxMap,
  type Level3, type MapGeneratorConfig,
} from "../src/map_generator.ts";
import { analyzeGeneratedMap, hardFailures } from "../src/map_report.ts";
import { R } from "./helpers.ts";

const levels = ["low", "standard", "high"] as const;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const config = (seed: number, patch: Partial<MapGeneratorConfig> = {}): MapGeneratorConfig =>
  ({ ...MAP_PRESETS.balanced, seed, ...patch });

test("200个固定候选全部满足地图硬约束", () => {
  for (let i = 0; i < 200; i++) {
    const preset = Object.values(MAP_PRESETS)[i % 4];
    const input = { ...preset, seed: i + 1 };
    const result = generateSandboxMap(R, input);
    assert.deepEqual(hardFailures(result.report), [], `seed=${i + 1}, preset=${preset.preset}`);
    assert.ok(result.report.metadata.attempts <= 24);
  }
});

test("六个有序档位在同种子样本中的指标中位数单调", () => {
  const measures: Record<"ocean" | "relief" | "desert" | "resources" | "rivers", (r: ReturnType<typeof analyzeGeneratedMap>) => number> = {
    ocean: (r) => r.surface.water / r.surface.total,
    relief: (r) => (r.surface.hills + r.surface.mountains) / r.surface.land,
    desert: (r) => r.surface.desert / r.surface.land,
    resources: (r) => r.resources.total / r.surface.total,
    rivers: (r) => r.rivers.segments,
  };
  for (const field of Object.keys(measures) as (keyof typeof measures)[]) {
    const values = levels.map((level: Level3) => median(Array.from({ length: 20 }, (_, i) => {
      const input = config(i + 1, { [field]: level });
      return measures[field](generateSandboxMap(R, input).report);
    })));
    assert.ok(values[0] < values[1] && values[1] < values[2], `${field}: ${values.join(" < ")}`);
  }
});

test("四个预设各生成20张，压力组合在有限尝试内返回或结构化失败", () => {
  for (const preset of Object.values(MAP_PRESETS)) for (let seed = 1; seed <= 20; seed++) {
    const input = { ...preset, seed };
    assert.equal(generateSandboxMap(R, input).board.tiles.size, 169);
  }
  const stresses: Partial<MapGeneratorConfig>[] = [
    { cityCount: 4, ocean: "high", relief: "high" },
    { cityCount: 4, ocean: "high", desert: "high", rivers: "high" },
    { cityCount: 2, relief: "high", rivers: "high", resources: "high" },
  ];
  for (const [index, patch] of stresses.entries()) {
    try {
      const result = generateSandboxMap(R, config(900 + index, patch));
      assert.ok(result.report.metadata.attempts <= 24);
    } catch (error) {
      assert.ok(error instanceof MapGenerationError);
      assert.equal(error.attempts, 24);
    }
  }
});
