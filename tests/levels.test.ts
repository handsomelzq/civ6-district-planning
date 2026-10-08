/** 关卡表的三星阈值由**产品求值器**独立重算一遍。
 *
 * 为什么要这个：`levels.csv` 里的三星阈值是设计期穷举出来的一个**数**，没有
 * 达到它的布局。于是那个数原本只有 `Tools/design_levels.py` 能验证 —— 一旦产品
 * 求值器算出别的结果，没人会发现，而玩家会在游戏里永远拿不到三星。
 *
 * fixture 由 `python3 Tools/design_levels.py` 导出（含每关的最优布局）。
 * 这条测试把关卡表的阈值变成**两份独立实现共同背书**的数字。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { evaluate, total } from "../src/evaluate.ts";
import { fmt, cmp } from "../src/rational.ts";
import { withDistrict, type BoardState } from "../src/board.ts";
import { parseKey } from "../src/hex.ts";
import { parseCsv, parseList } from "../src/csv.ts";
import { R, board } from "./helpers.ts";
import { loadLevels } from "../web/levels.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(readFileSync(
  path.join(here, "fixtures", "levels_oracle.json"), "utf8"));
const CASES = FX.cases as any[];

const LEVELS = parseCsv(readFileSync(
  path.join(here, "..", "配置表", "levels.csv"), "utf8"));
const LEVEL_BY_ID = new Map(LEVELS.map((r) => [r["关卡id"], r]));

test("关卡加载会标记非法初始局面为不可开始，并保留具体问题", () => {
  const levelText = [
    "关卡id,名称,文明id,领袖id,已解锁科技,已解锁市政,城市中心坐标,人口,目标类型,目标产出类型,目标值,约束类型,约束值,三星阈值,二星阈值,关卡类别,母题,贪心基线结果",
    'BAD-01,非法测试,CIVILIZATION_GERMANY,LEADER_BARBAROSSA,TECH_WRITING,无,"0,0",4,单一产出达标,科技,5,区域数,1,5,5,教学,无,0',
  ].join("\n");
  const tileText = [
    "关卡id,坐标,地形,地貌,资源,自然奇观,河流边,初始区域,初始建筑",
    'BAD-01,"0,0",TERRAIN_GRASS,无,无,无,无,DISTRICT_CAMPUS,无',
    'BAD-01,"1,0",TERRAIN_GRASS,无,无,无,无,DISTRICT_CAMPUS,无',
  ].join("\n");
  const loaded = loadLevels(R, {
    "levels.csv": levelText,
    "level_tiles.csv": tileText,
  });
  assert.equal(loaded.levels.length, 1);
  assert.equal(loaded.levels[0].可开始, false);
  assert.ok(loaded.levels[0].问题.some((problem) => problem.includes("E17c")));
  assert.ok(loaded.problems.some((problem) =>
    problem.includes("BAD-01") && problem.includes("E17c")));
});

test("当前 9 个挑战关卡的初始局面全部合法且未提前达成目标", () => {
  const loaded = loadLevels(R, {
    "levels.csv": readFileSync(
      path.join(here, "..", "配置表", "levels.csv"), "utf8"),
    "level_tiles.csv": readFileSync(
      path.join(here, "..", "配置表", "level_tiles.csv"), "utf8"),
  });
  assert.equal(loaded.problems.length, 0, loaded.problems.join("；"));
  assert.equal(loaded.levels.length, 9);
  assert.ok(loaded.levels.every((level) => level.可开始));
  assert.ok(loaded.levels.every((level) => {
    const tree = evaluate(R, level.初始局面);
    return [...level.目标].some(([yieldType, target]) =>
      cmp(total(tree, yieldType), target) < 0);
  }));
});

describe(`关卡阈值对账（${CASES.length} 关）`, () => {
  for (const c of CASES) {
    test(`${c.关卡id}「${c.名称}」最优布局的产出 = 三星阈值 ${c.三星阈值}`, () => {
      // 1. 从 fixture 还原残局（区域存基础 id，替换留给求值解析）
      const spec: Record<string, object> = {};
      for (const [k, t] of Object.entries<any>(c.地块)) {
        spec[k] = { 地形: t["地形"], 地貌: t["地貌"], 区域: t["区域"] };
      }
      const level = LEVEL_BY_ID.get(c.关卡id)!;
      let b: BoardState = board(spec as never, {
        文明: c.文明,
        人口: Number(level["人口"]),
        已解锁科技: parseList(level["已解锁科技"]),
        已解锁市政: parseList(level["已解锁市政"]),
      });

      // 2. 按最优布局放置
      for (const step of c.最优布局) {
        b = withDistrict(b, parseKey(step.坐标), step.区域, R.removedByDistrict);
      }

      // 3. 逐产出对账
      const tree = evaluate(R, b);
      for (const y of c.目标产出 as string[]) {
        assert.equal(fmt(total(tree, y)), c.最优产出[y],
          `${c.关卡id} 的 ${y} 与设计期原型不一致`);
      }

      // 4. 三星阈值 = 目标产出的合计（多产出关卡是各分量之和，见 关卡设计 §7.4）
      let sum = 0;
      for (const y of c.目标产出 as string[]) sum += Number(c.最优产出[y]);
      assert.equal(String(sum), c.三星阈值,
        `${c.关卡id} 的三星阈值与最优布局算出来的合计不符`);

      // 5. 最优候选布局必须通过与产品一致的共享合法性规则。
      const errs = tree.诊断.filter((d) => d.级别 === "错误");
      assert.deepEqual(errs, [],
        `${c.关卡id} 的最优候选布局存在合法性错误：` +
        errs.map((e) => e.说明).join("；"));
    });
  }

  test("fixture 覆盖了 levels.csv 的每一关", () => {
    const inCsv = LEVELS.map((r) => r["关卡id"]).sort();
    const inFx = CASES.map((c) => c.关卡id).sort();
    assert.deepEqual(inFx, inCsv,
      "配置表与 fixture 不同步 —— 重跑 python3 Tools/design_levels.py");
  });

  test("对照关 L-09 的最优布局换成德国会显著变差（关卡设计 §1.2 的判据）", () => {
    const l09 = CASES.find((c) => c.关卡id === "L-09")!;
    const l08 = CASES.find((c) => c.关卡id === "L-08")!;
    const build = (fx: any, civ: string) => {
      const spec: Record<string, object> = {};
      for (const [k, t] of Object.entries<any>(fx.地块)) {
        spec[k] = { 地形: t["地形"], 地貌: t["地貌"], 区域: t["区域"] };
      }
      let b: BoardState = board(spec as never, { 文明: civ });
      for (const s of fx.最优布局) {
        b = withDistrict(b, parseKey(s.坐标), s.区域, R.removedByDistrict);
      }
      return evaluate(R, b);
    };
    // 韩国的布局给德国：应当远低于德国自己的最优（9.5）
    const korToGer = Number(fmt(total(build(l09, "CIVILIZATION_GERMANY"), "科技")));
    assert.ok(korToGer < Number(l08.最优产出["科技"]),
      `韩国布局在德国下得 ${korToGer}，没有低于德国自己的最优 ${l08.最优产出["科技"]}`);
    // 德国的布局给韩国：应当远低于韩国自己的最优（20）
    const gerToKor = Number(fmt(total(build(l08, "CIVILIZATION_KOREA"), "科技")));
    assert.ok(gerToKor < Number(l09.最优产出["科技"]),
      `德国布局在韩国下得 ${gerToKor}，没有低于韩国自己的最优 ${l09.最优产出["科技"]}`);
  });
});
