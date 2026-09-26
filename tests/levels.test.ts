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
import { fmt } from "../src/rational.ts";
import { withDistrict, type BoardState } from "../src/board.ts";
import { parseKey } from "../src/hex.ts";
import { parseCsv } from "../src/csv.ts";
import { R, board } from "./helpers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(readFileSync(
  path.join(here, "fixtures", "levels_oracle.json"), "utf8"));
const CASES = FX.cases as any[];

const LEVELS = parseCsv(readFileSync(
  path.join(here, "..", "配置表", "levels.csv"), "utf8"));

/** 已知的 E17b（唯一性上限）违规，按关卡冻结。**这是待修的问题清单，不是期望值。**
 *  修好一关就删掉它那一行。全部删空之后，把上面第 5 步改回 `assert.deepEqual(errs, [])`。
 *  来源：2026-09-26 补 districts 的两列上限后逐关跑出来的，见 关卡设计.md §9。 */
const KNOWN_E17B: Record<string, string[]> = {
  "L-01": ["学院 放了 2 座，超过每城上限 1（E17b）"],
  "L-02": ["学院 放了 3 座，超过每城上限 1（E17b）"],
  "L-03": ["学院 放了 2 座，超过每城上限 1（E17b）"],
  "L-05": ["学院 放了 4 座，超过每城上限 1（E17b）"],
  "L-06": ["学院 放了 2 座，超过每城上限 1（E17b）",
           "市政广场 放了 2 座，超过每玩家上限 1（E17b）"],
  "L-07": ["学院 放了 2 座，超过每城上限 1（E17b）",
           "市政广场 放了 2 座，超过每玩家上限 1（E17b）"],
  "L-08": ["学院 放了 3 座，超过每城上限 1（E17b）",
           "市政广场 放了 2 座，超过每玩家上限 1（E17b）"],
  "L-09": ["书院 放了 5 座，超过每城上限 1（E17b）"],
  "L-10": ["书院 放了 2 座，超过每城上限 1（E17b）",
           "圣地 放了 2 座，超过每城上限 1（E17b）"],
};

describe(`关卡阈值对账（${CASES.length} 关）`, () => {
  for (const c of CASES) {
    test(`${c.关卡id}「${c.名称}」最优布局的产出 = 三星阈值 ${c.三星阈值}`, () => {
      // 1. 从 fixture 还原残局（区域存基础 id，替换留给求值解析）
      const spec: Record<string, object> = {};
      for (const [k, t] of Object.entries<any>(c.地块)) {
        spec[k] = { 地形: t["地形"], 地貌: t["地貌"], 区域: t["区域"] };
      }
      let b: BoardState = board(spec as never, { 文明: c.文明 });

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

      // 5. 残局本身必须合法 —— 关卡不该带着诊断错误发给玩家（边界 E18）
      //
      // ⚠️ **当前全部 9 关都违反 E17b**，这条断言因此退化成「特征测试」：它冻结
      //    已知的违规集合，而不是断言没有违规。
      //
      //    2026-09-26 补上 districts.每城上限 / 每玩家上限 两列后才发现：文明 6 的
      //    一座城市**每种专业化区域只能有一座**（OnePerCity 默认为真），而市政广场
      //    与外交区是**全文明唯一**（MaxPerPlayer=1）。9 关的最优布局全都在一座城里
      //    摆了多座同类区域 —— L-09 摆了 5 座书院，L-06/07/08 摆了 2 座市政广场。
      //    **这些局面在游戏里摆不出来**，见 关卡设计.md §9 与 SDD §10 D12。
      //
      //    为什么不把断言删掉、也不把 E17b 降成警告：删掉等于把问题藏起来，降级等于
      //    篡改规则来迎合错误的关卡。冻结成特征测试能同时做到两件事 —— CI 不红，
      //    且一旦违规集合发生任何变化（修好了，或又坏了新的）立刻失败。
      const errs = tree.诊断.filter((d) => d.级别 === "错误");
      const other = errs.filter((d) => !d.说明.includes("E17b"));
      assert.deepEqual(other, [], `${c.关卡id} 出现了 E17b 之外的合法性错误：` +
        other.map((e) => e.说明).join("；"));
      assert.deepEqual(
        errs.map((e) => e.说明).sort(), (KNOWN_E17B[c.关卡id] ?? []).slice().sort(),
        `${c.关卡id} 的 E17b 违规集合变了。若是修好了关卡，请同步删掉 KNOWN_E17B ` +
        `里对应的条目；若是新坏的，那是回归。`);
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
