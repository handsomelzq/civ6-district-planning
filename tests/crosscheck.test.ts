/** 交叉校验：TS 产品求值器 vs Python 设计期原型，同一批盘面逐项对账。
 *
 * 为什么这比单测强：**两份独立实现在同一批盘面上给出相同结果**。单测只能证明
 * 代码符合我写测试时的理解；交叉校验能抓出「我在两个地方犯了同一个错」之外的
 * 一切偏差 —— 而两份实现是在不同时间、不同语言、由不同的思路写出来的。
 *
 * oracle 由 `python3 Tools/gen_oracle.py` 生成（固定种子，可复现）。
 * 覆盖 地形 / 地貌 / 区域 / 任意其他区域 / 自身 五个目标类别，也就是全部 10 关
 * 用到的规则。剩下 8 个类别见 categories.test.ts。
 *
 * ⚠️ 一处**刻意的差异**：原型在 `计数 == 0` 时跳过记账，产品按边界 E1 要求
 * 即使为 0 也记账。所以两边的**明细树形状不同**，但**总产出必须相同** ——
 * 因此这里只对账总产出。树的加和完备由 invariants.test.ts 单独保证。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { evaluate } from "../src/evaluate.ts";
import { fmt, ZERO } from "../src/rational.ts";
import { type BoardState } from "../src/board.ts";
import { R, board } from "./helpers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const ORACLE = JSON.parse(readFileSync(path.join(here, "fixtures", "oracle.json"), "utf8"));
const CASES = ORACLE.cases as any[];
const YIELDS = ["科技", "文化", "金币", "生产力", "信仰", "粮食"];

function fromCase(c: any): BoardState {
  const spec: Record<string, object> = {};
  for (const [k, t] of Object.entries<any>(c.tiles)) {
    spec[k] = { 地形: t["地形"], 地貌: t["地貌"], 区域: t["区域"] };
  }
  return board(spec as never, { 文明: c["文明"] ?? undefined });
}

describe(`与 Python 原型对账（${CASES.length} 个盘面）`, () => {
  test("每个盘面的六种产出逐项相等", () => {
    const mismatches: string[] = [];
    for (const c of CASES) {
      const tree = evaluate(R, fromCase(c));
      for (const y of YIELDS) {
        const got = fmt(tree.合计.get(y) ?? ZERO);
        const want = (c.期望产出[y] as string | undefined) ?? "0";
        if (got !== want) {
          mismatches.push(`${c.id}（半径 ${c.半径}，文明 ${c.文明}）${y}：TS ${got} ≠ 原型 ${want}`);
        }
      }
    }
    assert.deepEqual(mismatches, [],
      `${mismatches.length} 处不一致：\n  ${mismatches.slice(0, 12).join("\n  ")}`);
  });

  test("覆盖面自查：用例确实跑到了各个文明与各种半径", () => {
    const civs = new Set(CASES.map((c) => String(c.文明)));
    const radii = new Set(CASES.map((c) => c.半径));
    // 五个首期文明 + 常规（null）
    assert.ok(civs.size >= 6, `文明覆盖不足：${[...civs].join(", ")}`);
    assert.deepEqual([...radii].sort(), [1, 2, 3]);
    const nonzero = CASES.filter((c) => Object.keys(c.期望产出).length > 0);
    assert.ok(nonzero.length >= CASES.length * 0.6,
      `有非零产出的用例只有 ${nonzero.length}/${CASES.length}，盘面生成得太稀了`);
  });

  test("韩国那几个用例必须真的走到了书院的替换与负向相邻", () => {
    const korea = CASES.filter((c) => c.文明 === "CIVILIZATION_KOREA");
    assert.ok(korea.length > 0, "oracle 里没有韩国用例");
    let sawSeowon = false;
    for (const c of korea) {
      const tree = evaluate(R, fromCase(c));
      for (const y of tree.产出) {
        for (const s of y.来源) {
          if (s.来源id.startsWith("DISTRICT_SEOWON")) {
            sawSeowon = true;
            // 书院的三条规则：自身 +4、每相邻一区域 −1、相邻市政广场 +1
            assert.equal(s.叶子.length, 3, "书院应当恰好命中 3 条规则");
            assert.ok(s.叶子.some((l) => l.档位 === "固定"), "其中一条是固定值（自身 +4）");
          }
        }
      }
    }
    assert.ok(sawSeowon, "韩国用例里没有任何一块学院被替换成书院 —— 替换解析没被跑到");
  });

  test("高卢那几个用例必须真的走到了规则排除", () => {
    const gaul = CASES.filter((c) => c.文明 === "CIVILIZATION_GAUL");
    assert.ok(gaul.length > 0, "oracle 里没有高卢用例");
    let sawExcluded = false;
    for (const c of gaul) {
      for (const y of evaluate(R, fromCase(c)).产出) {
        for (const s of y.来源) {
          for (const l of s.叶子) {
            if (l.未生效 === "被文明排除") {
              sawExcluded = true;
              assert.equal(fmt(l.增量), "0", "被排除的规则增量必须是 0");
            }
          }
        }
      }
    }
    assert.ok(sawExcluded,
      "高卢用例里没有任何一条规则被排除 —— 求值顺序第 2 步没被跑到，而不实现它高卢会偏强");
  });
});
