import { type Rules } from "../src/rules.ts";
import { type BoardState, districtPositions } from "../src/board.ts";
import { parseKey } from "../src/hex.ts";
import { validateDistrictPlacement } from "../src/legality.ts";
import { evaluate } from "../src/evaluate.ts";
import { boardToData } from "../src/board_file.ts";
import { cmp, sub, ZERO, fmt } from "../src/rational.ts";
import { type Level, meetsGoal, starsOf, scoreOf } from "./levels.ts";

export const FEATURED_LEVELS = ["L-01", "L-05", "L-08", "L-09", "L-07"];
export const LESSONS: Record<string, { title: string; hints: string[]; review: string }> = {
  "L-01": { title: "读地形", hints: ["先找山脉，再比较邻山数量。", "学院的山脉收益可以叠加。", "先悬停候选格，比较学院自身的科技增量。"], review: "地形提供起点收益；放置前先读懂来源，而不只看合计。" },
  "L-05": { title: "给后续留位置", hints: ["当前最高收益，不一定带来最后最高收益。", "比较相互靠近的空格与孤立空格。", "把学院与辅助区域作为一组规划，观察已有学院的增量。"], review: "辅助区域的价值可能落在已有学院上。即时收益与最终收益需要分开比较。" },
  "L-08": { title: "德国：协同布局", hints: ["先确认每城区域唯一性。", "学院周围的辅助区域也能贡献科技。", "留住能围绕学院形成一组的位置，不要只挑单格最高值。"], review: "这张图要与韩国关对照；区域之间的正向协同会影响位置选择。" },
  "L-09": { title: "韩国：对照布局", hints: ["书院不是普通学院。", "检查书院固定收益和邻区负项。", "让书院远离其他区域，再与上一关比较。"], review: "同一地形换文明，最佳布局可能改变。书院固定项仍保留 D10 待核边界。" },
  "L-07": { title: "兼顾两种产出", hints: ["科技和信仰必须分别达标。", "山地位置同时吸引学院和圣地。", "先为两个目标留出位置，再用辅助区域补足；总分高不等于通关。"], review: "多目标不能只追求合计最大；先满足各项底线，再提高星级。" },
};
export function challengeStatus(rules: Rules, level: Level, board: BoardState, palette: readonly string[]) {
  const remaining = level.约束值 - (districtPositions(board).length - districtPositions(level.初始局面).length);
  const totals = evaluate(rules, board).合计;
  const passed = meetsGoal(level, totals), stars = starsOf(level, totals);
  const canPlace = remaining > 0 && [...board.tiles.keys()].some(k => palette.some(d =>
    validateDistrictPlacement(rules, board, parseKey(k), d,
      { mode: "挑战", challengeBudgetRemaining: remaining }).length === 0));
  return { remaining, passed, stars, canPlace,
    terminal: stars === 3 || remaining <= 0 || !canPlace,
    reason: stars === 3 ? "已达三星" : remaining <= 0 ? "配额已用完" : !canPlace ? "没有合法放置位置" : "仍可继续规划" };
}

export function challengeReview(rules: Rules, level: Level, board: BoardState) {
  const tree = evaluate(rules, board);
  const difference = sub(level.三星阈值, scoreOf(level, tree.合计));
  const gap = cmp(difference, ZERO) > 0 ? difference : ZERO;
  return { tree, gap, goals: [...level.目标].map(([yieldType, target]) => {
    const actual = tree.合计.get(yieldType) ?? ZERO;
    return { yieldType, target, actual, passed: cmp(actual, target) >= 0 };
  }) };
}

/** Local export only. No names, account identifiers or network transmission. */
export function playtestRecord(rules: Rules, level: Level, board: BoardState, info: {
  seconds: number; hints: number; undos: number; moves: number;
  result: string; build: string;
}) {
  const review = challengeReview(rules, level, board);
  return { level: level.关卡id, ...info,
    stars: starsOf(level, review.tree.合计), threeStarGap: fmt(review.gap),
    goals: review.goals.map(g => ({ yield: g.yieldType, target: fmt(g.target),
      actual: fmt(g.actual), passed: g.passed })),
    finalBoard: boardToData(board) };
}
