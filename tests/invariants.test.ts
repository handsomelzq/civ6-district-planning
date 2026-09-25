/** 四条不变量（SDD §3.8）。它们是「四个消费方复用同一个求值器」的前提。
 *
 * I3（顺序无关）值得单独说：它意味着求值器**不能**有任何「按放置先后累加」的
 * 内部状态。这也是本作能做残局的根本原因 —— 残局只给最终局面，不给历史。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluate, total, checkAdditive } from "../src/evaluate.ts";
import { fmt, cmp } from "../src/rational.ts";
import { withDistrict, type BoardState } from "../src/board.ts";
import { parseKey } from "../src/hex.ts";
import { R, board, emptyBoard, at } from "./helpers.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const ORACLE = JSON.parse(readFileSync(path.join(
  path.dirname(fileURLToPath(import.meta.url)), "fixtures", "oracle.json"), "utf8"));

/** 把 oracle 的用例还原成局面。区域存的是**基础 id**，替换留给求值解析。 */
function fromCase(c: any): BoardState {
  const spec: Record<string, object> = {};
  for (const [k, t] of Object.entries<any>(c.tiles)) {
    spec[k] = { 地形: t["地形"], 地貌: t["地貌"], 区域: t["区域"] };
  }
  return board(spec as never, { 文明: c["文明"] ?? undefined });
}

const CASES = ORACLE.cases as any[];

describe("I1 纯函数：不修改输入局面", () => {
  test("求值前后局面的深层内容完全一致", () => {
    const b = fromCase(CASES.find((c) => Object.keys(c.期望产出).length > 0));
    const before = JSON.stringify([...b.tiles.entries()].sort());
    evaluate(R, b);
    assert.equal(JSON.stringify([...b.tiles.entries()].sort()), before);
  });

  test("放置操作返回新局面，不动原局面", () => {
    const b = emptyBoard(1);
    const n = withDistrict(b, at(0, 0), "DISTRICT_CAMPUS", R.removedByDistrict);
    assert.equal(b.tiles.get("0,0")!.区域, undefined, "原局面必须没被改");
    assert.equal(n.tiles.get("0,0")!.区域, "DISTRICT_CAMPUS");
  });
});

describe("I2 幂等：同一局面反复求值结果恒等", () => {
  test("全部 oracle 用例连算三遍结果一致", () => {
    for (const c of CASES) {
      const b = fromCase(c);
      const a = evaluate(R, b);
      const d = evaluate(R, b);
      const e = evaluate(R, b);
      for (const [y, v] of a.合计) {
        assert.equal(cmp(v, d.合计.get(y)!), 0, `${c.id} ${y}`);
        assert.equal(cmp(v, e.合计.get(y)!), 0, `${c.id} ${y}`);
      }
    }
  });
});

describe("I3 顺序无关：产出与放置历史无关", () => {
  test("打乱放置顺序后总产出恒等（oracle 全部用例，每例 5 种顺序）", () => {
    // 确定性伪随机，失败可复现
    let seed = 20260925;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    for (const c of CASES) {
      const full = fromCase(c);
      const placed = [...full.tiles.entries()]
        .filter(([, t]) => t.区域 !== undefined)
        .map(([k, t]) => [k, t.区域!] as const);
      if (placed.length < 2) continue;

      // 空盘底座：同样的地形地貌，但没有任何区域
      const bareSpec: Record<string, object> = {};
      for (const [k, t] of full.tiles) {
        bareSpec[k] = { 地形: t.地形, 地貌: t.地貌 };
      }
      const bare = board(bareSpec as never, { 文明: full.文明 });

      const results: string[] = [];
      for (let trial = 0; trial < 5; trial++) {
        const order = [...placed];
        for (let i = order.length - 1; i > 0; i--) {          // Fisher–Yates
          const j = Math.floor(rnd() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        let b = bare;
        for (const [k, d] of order) {
          b = withDistrict(b, parseKey(k), d, R.removedByDistrict);
        }
        const tree = evaluate(R, b);
        results.push([...tree.合计.entries()]
          .map(([y, v]) => `${y}=${fmt(v)}`).sort().join(","));
      }
      assert.equal(new Set(results).size, 1,
        `${c.id} 的产出随放置顺序变化了：${[...new Set(results)].join(" ≠ ")}`);
    }
  });
});

describe("I4 加和完备：树的每一层求和等于父节点", () => {
  test("全部 oracle 用例的树都通过自检", () => {
    for (const c of CASES) {
      const bad = checkAdditive(evaluate(R, fromCase(c)));
      assert.deepEqual(bad, [], `${c.id} 的明细树不加和完备：${bad.join("；")}`);
    }
  });

  test("没有「其他」「杂项」节点 —— 任何无法归因的数值都是建模缺失", () => {
    for (const c of CASES) {
      for (const y of evaluate(R, fromCase(c)).产出) {
        for (const s of y.来源) {
          assert.ok(s.叶子.length > 0, `${c.id} ${y.产出类型}/${s.来源id} 是个空来源节点`);
          for (const l of s.叶子) {
            assert.ok(l.规则id.length > 0, "每个叶子都必须带规则 id");
          }
        }
      }
    }
  });
});
