import test from "node:test";
import assert from "node:assert/strict";
import {
  MAP_PRESETS, generateMapCandidate, type Level3, type MapGeneratorConfig,
} from "../src/map_generator.ts";
import { edgeKey } from "../src/river.ts";

const config = (patch: Partial<MapGeneratorConfig>): MapGeneratorConfig =>
  ({ ...MAP_PRESETS.balanced, seed: 17, ...patch });
const boards = (field: "ocean" | "relief" | "desert" | "resources", level: Level3) =>
  Array.from({ length: 30 }, (_, i) => generateMapCandidate(config({ [field]: level, seed: i + 1 }), i + 1));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const water = (b: ReturnType<typeof generateMapCandidate>) =>
  [...b.tiles.values()].filter((t) => t.湖泊 || /TERRAIN_(COAST|OCEAN)/.test(t.地形)).length;
const landRatio = (b: ReturnType<typeof generateMapCandidate>, predicate: (terrain: string) => boolean) => {
  const land = [...b.tiles.values()].filter((t) => !t.湖泊 && !/TERRAIN_(COAST|OCEAN)/.test(t.地形));
  return land.filter((t) => predicate(t.地形)).length / land.length;
};

test("城市数量与极地选择是确定约束", () => {
  for (const cityCount of [2, 3, 4] as const) {
    assert.equal(generateMapCandidate(config({ cityCount }), 91).城市?.length, cityCount);
  }
  const rows = (polar: MapGeneratorConfig["polar"]) => [...generateMapCandidate(config({ polar }), 44).tiles]
    .filter(([, t]) => t.地形.startsWith("TERRAIN_TUNDRA")).map(([id]) => Number(id.split(",")[1]));
  assert.deepEqual(rows("none"), []);
  assert.ok(rows("north").every((r) => r <= -5));
  assert.ok(rows("south").every((r) => r >= 5));
});

test("海洋、地势、沙漠与资源档位在同种子样本中的中位数单调", () => {
  const measure: Record<string, (b: ReturnType<typeof generateMapCandidate>) => number> = {
    ocean: water,
    relief: (b) => landRatio(b, (t) => /_(HILLS|MOUNTAIN)$/.test(t)),
    desert: (b) => landRatio(b, (t) => t.startsWith("TERRAIN_DESERT")),
    resources: (b) => [...b.tiles.values()].filter((t) => t.资源).length,
  };
  for (const field of ["ocean", "relief", "desert", "resources"] as const) {
    const values = (["low", "standard", "high"] as const).map((level) =>
      median(boards(field, level).map(measure[field])));
    assert.ok(values[0] < values[1] && values[1] < values[2], `${field}: ${values.join(" < ")}`);
  }
});

test("丰富河流生成两条不复用河段的连续水系", () => {
  const b = generateMapCandidate(config({ rivers: "high" }), 73);
  assert.equal(b.河道?.length, 2);
  const seen = new Set<string>();
  let segments = 0;
  for (const path of b.河道 ?? []) for (let i = 1; i < path.length; i++) {
    const id = edgeKey(path[i - 1], path[i]);
    assert.ok(!seen.has(id), `河段不能重复：${id}`);
    seen.add(id); segments++;
  }
  assert.ok(segments >= 24 && segments <= 36, `总河段=${segments}`);
});

test("候选生成固定种子完全重现且保持169格", () => {
  const a = generateMapCandidate(config({}), 12345);
  const z = generateMapCandidate(config({}), 12345);
  assert.deepEqual(a, z);
  assert.equal(a.tiles.size, 169);
});
