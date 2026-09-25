/** 关卡加载。读 `levels.csv` / `level_tiles.csv`（构建期内联），把行还原成局面。
 *
 * 加载时**必须校验**（SDD-挑战模式 §5）：一个非法的初始局面会让后续所有求值
 * 结果失去意义，且极难排查。所以 `loadLevel` 返回的是「局面 + 问题清单」，
 * 有问题就不进入游戏（边界 G1 / G2 / G3）。
 */
import { parseCsv, parseList, isNone } from "../src/csv.ts";
import { parseKey, type Axial } from "../src/hex.ts";
import { type BoardState, type Tile } from "../src/board.ts";
import { type Rules } from "../src/rules.ts";
import { evaluate, total } from "../src/evaluate.ts";
import { type Rat, parseRat, cmp, fmt, ZERO, add } from "../src/rational.ts";

export type Level = {
  readonly 关卡id: string;
  readonly 名称: string;
  readonly 文明: string;
  readonly 领袖: string;
  readonly 关卡类别: string;
  readonly 母题: string;
  readonly 目标类型: string;
  /** 产出类型 → 目标值。单产出也用这个结构，只有一项。 */
  readonly 目标: ReadonlyMap<string, Rat>;
  readonly 约束类型: string;
  readonly 约束值: number;
  readonly 二星阈值: Rat;
  readonly 三星阈值: Rat;
  readonly 贪心基线: string;
  readonly 初始局面: BoardState;
};

/** 解析 `目标值`：`4.5` 或 `科技:4|信仰:3`（见 关卡设计.md §7.4）。 */
function parseGoal(目标产出类型: string, 目标值: string): Map<string, Rat> {
  const out = new Map<string, Rat>();
  if (目标值.includes(":")) {
    for (const part of 目标值.split("|")) {
      const i = part.indexOf(":");
      out.set(part.slice(0, i).trim(), parseRat(part.slice(i + 1)));
    }
  } else {
    out.set(目标产出类型.trim(), parseRat(目标值));
  }
  return out;
}

export function loadLevels(
  rules: Rules, texts: Record<string, string>,
): { levels: Level[]; problems: string[] } {
  const problems: string[] = [];
  const tilesByLevel = new Map<string, Map<string, Tile>>();
  for (const r of parseCsv(texts["level_tiles.csv"])) {
    const m = tilesByLevel.get(r["关卡id"]) ?? new Map<string, Tile>();
    tilesByLevel.set(r["关卡id"], m);
    const t: Tile = {
      地形: r["地形"],
      地貌: isNone(r["地貌"]) ? undefined : r["地貌"],
      资源: isNone(r["资源"]) ? undefined : r["资源"],
      自然奇观: isNone(r["自然奇观"]) ? undefined : r["自然奇观"],
      河流边: !isNone(r["河流边"]),
      区域: isNone(r["初始区域"]) ? undefined : r["初始区域"],
      建筑: isNone(r["初始建筑"]) ? undefined : parseList(r["初始建筑"]),
    };
    m.set(r["坐标"], t);
  }

  const levels: Level[] = [];
  for (const r of parseCsv(texts["levels.csv"])) {
    const id = r["关卡id"];
    const tiles = tilesByLevel.get(id);
    if (!tiles) { problems.push(`${id}：没有任何地块`); continue; }
    const 目标 = parseGoal(r["目标产出类型"], r["目标值"]);
    const board: BoardState = {
      tiles,
      中心: parseKey(r["城市中心坐标"]),
      人口: Number(r["人口"]),
      文明: r["文明id"],
      领袖: r["领袖id"],
      已解锁科技: new Set(parseList(r["已解锁科技"])),
      已解锁市政: new Set(parseList(r["已解锁市政"])),
    };
    const lv: Level = {
      关卡id: id, 名称: r["名称"], 文明: r["文明id"], 领袖: r["领袖id"],
      关卡类别: r["关卡类别"], 母题: r["母题"], 目标类型: r["目标类型"],
      目标, 约束类型: r["约束类型"], 约束值: Number(r["约束值"]),
      二星阈值: parseRat(r["二星阈值"]), 三星阈值: parseRat(r["三星阈值"]),
      贪心基线: r["贪心基线结果"], 初始局面: board,
    };

    // ── 加载校验（SDD-挑战模式 §5、边界 G1–G3）────────────────────────
    const tree = evaluate(rules, board);
    for (const d of tree.诊断) {
      if (d.级别 === "错误") problems.push(`${id}：初始局面非法 —— ${d.说明}（G2）`);
    }
    if (lv.约束值 <= 0) problems.push(`${id}：约束值不为正（G3）`);
    let already = true;
    for (const [y, v] of 目标) {
      if (cmp(total(tree, y), v) < 0) already = false;
    }
    if (already) {
      problems.push(`${id}：初始局面已经达成目标，这是关卡配错（G1）`);
    }
    levels.push(lv);
  }
  return { levels, problems };
}

/** 达成判定。多产出要求**每一项**都达标（边界 G7）。 */
export function meetsGoal(lv: Level, got: ReadonlyMap<string, Rat>): boolean {
  for (const [y, need] of lv.目标) {
    if (cmp(got.get(y) ?? ZERO, need) < 0) return false;
  }
  return true;
}

/** 评分用的标量：目标涉及的各产出之合计（单产出就是那一个数）。 */
export function scoreOf(lv: Level, got: ReadonlyMap<string, Rat>): Rat {
  let s = ZERO;
  for (const y of lv.目标.keys()) s = add(s, got.get(y) ?? ZERO);
  return s;
}

/** 星级。阈值都是**产出值**（关卡设计.md §8）。 */
export function starsOf(lv: Level, got: ReadonlyMap<string, Rat>): number {
  if (!meetsGoal(lv, got)) return 0;
  const s = scoreOf(lv, got);
  if (cmp(s, lv.三星阈值) >= 0) return 3;
  if (cmp(s, lv.二星阈值) >= 0) return 2;
  return 1;
}

export const goalText = (lv: Level): string =>
  [...lv.目标].map(([y, v]) => `${y} ≥ ${fmt(v)}`).join("　且　");
