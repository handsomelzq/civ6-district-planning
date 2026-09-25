/** 校准：对照 2026-09-24 的游戏内实测读数。
 *
 * **这组测试的地位特殊**：它不是在验证代码，而是在验证「代码所实现的那个公式
 * 就是游戏在跑的公式」。任一条不过，后面所有结论都不可信 —— 包括 10 关的
 * 目标值与星级阈值，它们全部由这个公式推出。
 *
 * 实验方法与原始读数见 设计/测试清单.md §2.6 对账记录。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluate, total } from "../src/evaluate.ts";
import { fmt } from "../src/rational.ts";
import { R, board } from "./helpers.ts";

const HOLY = "DISTRICT_HOLY_SITE";
const CENTER = "DISTRICT_CITY_CENTER";
const MTN = "TERRAIN_GRASS_MOUNTAIN";
const FOREST = "FEATURE_FOREST";

describe("游戏内实测读数（圣地 + 森林 / 山脉）", () => {
  const cases: [string, Record<string, object>, string][] = [
    ["2 片森林 → 每 2 个 +1 信仰，拿满 1",
      { "0,0": { 区域: HOLY }, "1,0": { 地貌: FOREST }, "0,1": { 地貌: FOREST } }, "1"],
    ["1 片森林 → **+0.5**，这一条推翻了「凑满 2 个才给」的字面读法",
      { "0,0": { 区域: HOLY }, "1,0": { 地貌: FOREST } }, "0.5"],
    ["1 个城市中心 → +0.5，城市中心算「任意其他区域」",
      { "0,0": { 区域: HOLY }, "1,0": { 区域: CENTER } }, "0.5"],
    ["1 森林 + 1 城市中心 → +1，**小数跨规则汇合**（两个 0.5 相加）",
      { "0,0": { 区域: HOLY }, "1,0": { 地貌: FOREST }, "0,1": { 区域: CENTER } }, "1"],
    ["2 座山脉 → +2，主要档严格线性",
      { "0,0": { 区域: HOLY }, "1,0": { 地形: MTN }, "0,1": { 地形: MTN } }, "2"],
  ];
  for (const [label, spec, expect] of cases) {
    test(label, () => {
      const tree = evaluate(R, board(spec as never));
      assert.equal(fmt(total(tree, "信仰")), expect);
    });
  }
});

test("三座山脉 → +3；五个山脉地形变体完全等价", () => {
  const variants = ["TERRAIN_GRASS_MOUNTAIN", "TERRAIN_PLAINS_MOUNTAIN",
    "TERRAIN_DESERT_MOUNTAIN", "TERRAIN_TUNDRA_MOUNTAIN", "TERRAIN_SNOW_MOUNTAIN"];
  for (const v of variants) {
    const tree = evaluate(R, board({
      "0,0": { 区域: HOLY }, "1,0": { 地形: v }, "0,1": { 地形: v }, "1,-1": { 地形: v },
    }));
    assert.equal(fmt(total(tree, "信仰")), "3", `${v} 应与其他山脉变体等价`);
  }
});

test("GDD §5 拆解面板示例逐项复现：学院 +5.5", () => {
  // 面板示例：山脉 ×2（+2）+ 相邻其他区域 ×3（+1.5）+ 图书馆（+2）= 5.5
  // 三个区域邻居刻意都**不是市政广场** —— 市政广场会额外走一条主要档 +1 的
  // 专门规则（Government_Science），那就不是示例里那三项了。
  const b = board({
    "0,0": { 区域: "DISTRICT_CAMPUS", 建筑: ["BUILDING_LIBRARY"] },
    "1,0": { 地形: MTN },
    "1,-1": { 地形: MTN },
    "0,-1": { 区域: CENTER },
    "-1,0": { 区域: "DISTRICT_HOLY_SITE" },
    "-1,1": { 区域: "DISTRICT_THEATER" },
  });
  const tree = evaluate(R, b);
  const sci = tree.产出.find((y) => y.产出类型 === "科技")!;
  const campus = sci.来源.find((s) => s.来源id.startsWith("DISTRICT_CAMPUS"))!;
  assert.equal(fmt(campus.合计), "3.5", "学院自身的相邻加成：2 + 1.5");
  assert.equal(fmt(total(tree, "科技")), "5.5", "加上图书馆 +2");

  // 面板的灵魂是「每一点产出都能追到规则行」。这里就验这件事：
  const hit = campus.叶子.filter((l) => l.计数 > 0).map((l) => l.规则id).sort();
  assert.deepEqual(hit, [
    "DISTRICT_CAMPUS@District_Science",     // 相邻其他区域 ×3 → +1.5
    "DISTRICT_CAMPUS@Mountains_Science1",   // 草原山脉 ×2 → +2
  ], "命中的规则 id 必须可枚举，而且山脉那一档是按地形变体分条的");
});

test("即使增量为 0 也记账（边界 E1）：学院 12 条规则全部出现在树里", () => {
  const b = board({ "0,0": { 区域: "DISTRICT_CAMPUS" } });
  const tree = evaluate(R, b);
  const campus = tree.产出.find((y) => y.产出类型 === "科技")!.来源[0];
  assert.equal(campus.叶子.length, R.adjacency.get("DISTRICT_CAMPUS")!.length,
    "「为什么没有加成」与「有多少加成」是同等重要的信息");
  assert.equal(fmt(campus.合计), "0");
});
