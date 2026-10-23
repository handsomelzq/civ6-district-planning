import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { R, board } from "./helpers.ts";
import { loadLevels } from "../web/levels.ts";
import { challengeStatus, challengeReview, FEATURED_LEVELS, LESSONS, playtestRecord } from "../web/challenge.ts";
import { withDistrict } from "../src/board.ts";
import { parseKey } from "../src/hex.ts";
import { rat } from "../src/rational.ts";

const { levels } = loadLevels(R, Object.fromEntries(["levels.csv", "level_tiles.csv"].map(f =>
  [f, readFileSync(new URL(`../配置表/${f}`, import.meta.url), "utf8")])));
const oracle = JSON.parse(readFileSync(new URL("fixtures/levels_oracle.json", import.meta.url), "utf8"));
const palette = ["DISTRICT_CAMPUS", "DISTRICT_HOLY_SITE", "DISTRICT_GOVERNMENT",
  "DISTRICT_COMMERCIAL_HUB", "DISTRICT_THEATER"];

test("五个代表关都有三档提示，逐步合法放置可达三星，记录包含最终布局与差距", () => {
  assert.equal(FEATURED_LEVELS.length, 5);
  for (const id of FEATURED_LEVELS) {
    const lv = levels.find(l => l.关卡id === id)!;
    assert.equal(LESSONS[id].hints.length, 3);
    assert.equal(challengeStatus(R, lv, lv.初始局面, palette).terminal, false, id);
    let b = lv.初始局面;
    for (const step of oracle.cases.find((c: any) => c.关卡id === id).最优布局) {
      b = withDistrict(b, parseKey(step.坐标), step.区域, R.removedByDistrict);
    }
    const result = challengeStatus(R, lv, b, palette);
    assert.equal(result.stars, 3, id);
    assert.equal(result.passed, true, id);
    assert.equal(challengeReview(R, lv, b).gap.n, 0);
    const record = playtestRecord(R, lv, b, {
      seconds: 10, hints: 2, moves: 3, undos: 1, result: "达成", build: "test",
    });
    assert.ok(record.finalBoard.tiles.length);
    assert.equal(record.stars, 3);
    assert.ok(record.goals.every(g => g.passed));
  }
});

test("达标未三星且仍可合法放置时不提前结算，所选区域被占满也不等于所有机会耗尽", () => {
  const initial = board({
    "0,0": { 区域: "DISTRICT_CITY_CENTER" },
    "1,0": {}, "2,0": { 地形: "TERRAIN_GRASS_MOUNTAIN" }, "0,1": {},
  }, { 人口: 12, 已解锁科技: ["TECH_WRITING", "TECH_ASTROLOGY"] });
  const lv = { ...levels[0], 初始局面: initial, 约束值: 4, 目标: new Map([["科技", rat(1)]]),
    二星阈值: rat(2), 三星阈值: rat(3) };
  const b = withDistrict(initial, { q: 1, r: 0 }, "DISTRICT_CAMPUS", R.removedByDistrict);
  const result = challengeStatus(R, lv, b, palette);
  assert.equal(result.passed, true);
  assert.equal(result.terminal, false);
  assert.equal(result.canPlace, true, "应继续检查圣地，而不是只检查已经放过的学院");
});

test("真正没有合法放置机会时才提前失败，多目标仍须各项达标", () => {
  const lv = levels.find(l => l.关卡id === "L-07")!;
  const locked = { ...lv.初始局面, 已解锁科技: new Set<string>(),
    已解锁市政: new Set<string>() };
  assert.equal(challengeStatus(R, lv, locked, palette).canPlace, false);
  assert.equal(challengeStatus(R, lv, locked, palette).terminal, true);
  assert.equal(challengeStatus(R, lv, locked, palette).passed, false);
  const report = challengeReview(R, lv, locked);
  assert.equal(report.goals.length, 2);
  assert.ok(report.goals.some(g => !g.passed));
});
