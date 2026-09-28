import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, total } from "../src/evaluate.ts";
import { fmt } from "../src/rational.ts";
import { withDistrict } from "../src/board.ts";
import { renderTotals } from "../web/render.ts";
import { PRESETS, sandboxBoard } from "../web/presets.ts";
import { R, board } from "./helpers.ts";

test("圣地的信仰即使为零也显示在汇总，山脉加成可见", () => {
  const zero = renderTotals(evaluate(R, board({})), "科技");
  assert.match(zero, /信仰/);
  const tree = evaluate(R, board({
    "0,0": { 区域: "DISTRICT_HOLY_SITE" },
    "1,0": { 地形: "TERRAIN_GRASS_MOUNTAIN" },
    "0,1": { 地貌: "FEATURE_FOREST" },
  }));
  assert.equal(fmt(total(tree, "信仰")), "1.5");
  const playable = withDistrict(sandboxBoard(), { q: 1, r: -1 },
    "DISTRICT_HOLY_SITE", R.removedByDistrict, "A");
  const actual = evaluate(R, playable);
  assert.equal(fmt(total(actual, "信仰")), "2.5",
    "自由模式山林双城初始环境：两座山脉 +2，城市中心 +0.5");
  assert.equal(fmt(actual.城市合计.get("A")!.get("信仰")!), "2.5");
});

test("日本明治维新：相邻区域每个 +1，通用 +0.5 被排除", () => {
  const spec = { "0,0": { 区域: "DISTRICT_HOLY_SITE" },
    "1,0": { 区域: "DISTRICT_CITY_CENTER" } };
  assert.equal(fmt(total(evaluate(R, board(spec)), "信仰")), "0.5");
  const japan = evaluate(R, board(spec, { 文明: "CIVILIZATION_JAPAN", 领袖: "LEADER_HOJO" }));
  assert.equal(fmt(total(japan, "信仰")), "1");
  assert.ok(japan.产出.flatMap((y) => y.来源).flatMap((s) => s.叶子)
    .some((l) => l.规则id === "TRAIT_ADJACENT_DISTRICTS_HOLYSITE_ADJACENCYFAITH"));
  assert.equal(R.traitAdjacency.get("CIVILIZATION_JAPAN")?.length, 6);
});

test("多城：同类区域分属两城合法，单城两座非法，政府广场仍全局唯一", () => {
  let b = sandboxBoard();
  b = withDistrict(b, { q: -1, r: 0 }, "DISTRICT_HOLY_SITE", R.removedByDistrict, "A");
  b = withDistrict(b, { q: 5, r: 0 }, "DISTRICT_HOLY_SITE", R.removedByDistrict, "B");
  const ok = evaluate(R, b);
  assert.ok(!ok.诊断.some((d) => d.说明.includes("圣地") && d.说明.includes("上限")));
  assert.ok(ok.城市合计.get("A")?.has("信仰"));
  assert.ok(ok.城市合计.get("B")?.has("信仰"));
  const same = withDistrict(b, { q: -1, r: 1 }, "DISTRICT_HOLY_SITE", R.removedByDistrict, "A");
  assert.ok(evaluate(R, same).诊断.some((d) => d.说明.includes("圣地") && d.说明.includes("每城上限")));
  const plazas = withDistrict(withDistrict(sandboxBoard(), { q: -1, r: 0 },
    "DISTRICT_GOVERNMENT", R.removedByDistrict, "A"), { q: 5, r: 0 },
    "DISTRICT_GOVERNMENT", R.removedByDistrict, "B");
  assert.ok(evaluate(R, plazas).诊断.some((d) => d.说明.includes("市政广场") && d.说明.includes("每玩家上限")));
});

test("自由模式提供三种多城环境，并且四文明的所有已解析领袖都可用", () => {
  for (const p of PRESETS) {
    const b = sandboxBoard(p.id);
    assert.ok((b.城市?.length ?? 0) >= 2);
    assert.ok(b.tiles.size > 37);
  }
  const expected: Record<string, string[]> = {
    CIVILIZATION_GERMANY: ["LEADER_BARBAROSSA", "LEADER_LUDWIG"],
    CIVILIZATION_JAPAN: ["LEADER_HOJO", "LEADER_TOKUGAWA"],
    CIVILIZATION_RUSSIA: ["LEADER_PETER_GREAT"],
    CIVILIZATION_KOREA: ["LEADER_SEONDEOK", "LEADER_SEJONG"],
  };
  for (const [civ, leaders] of Object.entries(expected)) {
    assert.deepEqual((R.leadersByCiv.get(civ) ?? []).map((l) => l.id).sort(), leaders.sort());
  }
});

test("路德维希二世：世界奇观相邻两座区域提供 +4 文化", () => {
  const spec = { "0,0": { 世界奇观: "BUILDING_PYRAMIDS" },
    "1,0": { 区域: "DISTRICT_CITY_CENTER" },
    "0,1": { 区域: "DISTRICT_CAMPUS" } };
  assert.equal(fmt(total(evaluate(R, board(spec, { 领袖: "LEADER_LUDWIG" })), "文化")), "4");
  assert.equal(fmt(total(evaluate(R, board(spec, { 领袖: "LEADER_BARBAROSSA" })), "文化")), "0");
});
