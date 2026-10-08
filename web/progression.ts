import { parseCsv, parseList } from "../src/csv.ts";

export type TreeKind = "科技" | "文化";

export type ProgressionNode = {
  readonly id: string;
  readonly name: string;
  readonly era: string;
  readonly cost: string;
  readonly prereqs: readonly string[];
  readonly functionText: string;
  readonly unlocks: readonly string[];
  readonly focus: boolean;
};

export type PolicyCard = {
  readonly id: string;
  readonly name: string;
  readonly slot: string;
  readonly prereqCivic: string;
  readonly functionText: string;
  readonly tag: string;
};

export type ReligionBelief = {
  readonly id: string;
  readonly name: string;
  readonly beliefClass: string;
  readonly functionText: string;
  readonly effects: readonly string[];
};

export type ProgressionTexts = {
  readonly tech_tree: string;
  readonly civic_tree: string;
  readonly policy_cards: string;
  readonly religion_beliefs: string;
};

export type ProgressionData = {
  readonly techs: ReadonlyMap<string, ProgressionNode>;
  readonly civics: ReadonlyMap<string, ProgressionNode>;
  readonly policies: readonly PolicyCard[];
  readonly beliefs: readonly ReligionBelief[];
};

export type ProgressionLayoutPoint = {
  readonly x: number;
  readonly y: number;
  readonly column: number;
  readonly row: number;
};

const nodeMap = (text: string, idCol: string): Map<string, ProgressionNode> => {
  const out = new Map<string, ProgressionNode>();
  for (const row of parseCsv(text)) {
    const id = row[idCol];
    out.set(id, {
      id,
      name: row["名称"],
      era: row["时代"],
      cost: row["成本"],
      prereqs: parseList(row[idCol === "科技id" ? "前置科技" : "前置市政"]),
      functionText: row["功能说明"],
      unlocks: parseList(row["解锁内容"]),
      focus: row["区域规划相关"] === "是",
    });
  }
  return out;
};

export function loadProgression(texts: ProgressionTexts): ProgressionData {
  const policies = parseCsv(texts.policy_cards).map((row): PolicyCard => ({
    id: row["政策卡id"],
    name: row["名称"],
    slot: row["政策槽位"],
    prereqCivic: row["前置市政"],
    functionText: row["功能说明"],
    tag: row["规划标签"],
  }));
  const beliefs = parseCsv(texts.religion_beliefs).map((row): ReligionBelief => ({
    id: row["信条id"], name: row["名称"], beliefClass: row["信条类别"],
    functionText: row["功能说明"], effects: parseList(row["结构化效果"]),
  }));
  return {
    techs: nodeMap(texts.tech_tree, "科技id"),
    civics: nodeMap(texts.civic_tree, "市政id"),
    policies,
    beliefs,
  };
}

export function prerequisiteClosure(
  nodes: ReadonlyMap<string, ProgressionNode>, id: string,
): string[] {
  const seen = new Set<string>();
  const visit = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    for (const parent of nodes.get(current)?.prereqs ?? []) visit(parent);
  };
  visit(id);
  return [...seen];
}

/** 游戏时代的固定顺序。不能用时代 id 或中文名排序，否则「原子能」会跑到「古典」前面。 */
export const ERA_ORDER = [
  "ERA_ANCIENT", "ERA_CLASSICAL", "ERA_MEDIEVAL", "ERA_RENAISSANCE",
  "ERA_INDUSTRIAL", "ERA_MODERN", "ERA_ATOMIC", "ERA_INFORMATION", "ERA_FUTURE",
] as const;

const ERA_NAMES: ReadonlyMap<string, string> = new Map([
  ["ERA_ANCIENT", "远古"], ["ERA_CLASSICAL", "古典"], ["ERA_MEDIEVAL", "中世纪"],
  ["ERA_RENAISSANCE", "文艺复兴"], ["ERA_INDUSTRIAL", "工业"],
  ["ERA_MODERN", "现代"], ["ERA_ATOMIC", "原子能"], ["ERA_INFORMATION", "信息"],
  ["ERA_FUTURE", "未来"],
]);

export const eraName = (id: string): string => ERA_NAMES.get(id) ?? id.replace(/^ERA_/, "");

export const eraIndex = (id: string): number => {
  const index = ERA_ORDER.indexOf(id as (typeof ERA_ORDER)[number]);
  return index < 0 ? ERA_ORDER.length : index;
};

/**
 * 按真实前置图分层，而不是按时代硬切列。
 *
 * 文明 VI 的时代是内容标签，不是研究树的几何约束：同一时代里可能有多个
 * 分叉。这里用「官方时代顺序的横向下限 + 前置关系的最长距离」作为研究层，
 * 再按前置节点的稳定顺序排列同层节点。这样没有显式前置的后期节点也不会
 * 跑到最左侧，同时仍保留真实前置关系造成的分叉。
 */
export function progressionGraphLayout(
  nodes: ReadonlyMap<string, ProgressionNode>,
): Map<string, ProgressionLayoutPoint> {
  const depthMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depthMemo.get(id);
    if (known !== undefined) return known;
    // 数据应当是 DAG；遇到坏配置时保留节点并截断回路，避免 UI 递归死循环。
    if (visiting.has(id)) return eraIndex(nodes.get(id)?.era ?? "");
    visiting.add(id);
    const node = nodes.get(id);
    const eraColumn = node ? eraIndex(node.era) : 0;
    const prereqColumn = node && node.prereqs.length
      ? Math.max(...node.prereqs.map(depthOf).filter((value) => Number.isFinite(value)), -1) + 1
      : 0;
    // 时代是官方研究树的横向位置下限；前置关系可以把同一时代的
    // 分支再向右推一列，但不能让后期节点出现在早期节点左侧。
    const depth = Math.max(eraColumn, prereqColumn);
    visiting.delete(id);
    depthMemo.set(id, depth);
    return depth;
  };

  const columns = new Map<number, ProgressionNode[]>();
  for (const node of nodes.values()) {
    const column = depthOf(node.id);
    (columns.get(column) ?? columns.set(column, []).get(column)!).push(node);
  }

  const rank = new Map<string, number>();
  const maxColumn = Math.max(...columns.keys(), 0);
  let maxRows = 1;
  for (let column = 0; column <= maxColumn; column += 1) {
    const group = columns.get(column) ?? [];
    group.sort((a, b) => {
      const parentRank = (node: ProgressionNode): number => {
        if (!node.prereqs.length) return -1;
        const values = node.prereqs
          .map((parent) => rank.get(parent))
          .filter((value): value is number => value !== undefined);
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : -1;
      };
      return parentRank(a) - parentRank(b)
        || Number(b.focus) - Number(a.focus)
        || eraIndex(a.era) - eraIndex(b.era)
        || a.name.localeCompare(b.name, "zh-CN")
        || a.id.localeCompare(b.id);
    });
    group.forEach((node, row) => rank.set(node.id, row));
    maxRows = Math.max(maxRows, group.length);
  }

  // 研究树是横向浏览的工作区。纵向必须在单页内收束，不能把每一层
  // 撑成另一条滚动轴；详细功能放到悬停面板，不把长文案塞进节点。
  const colWidth = 288;
  const rowHeight = 38;
  const left = 52;
  const top = 46;
  const out = new Map<string, ProgressionLayoutPoint>();
  for (let column = 0; column <= maxColumn; column += 1) {
    const group = columns.get(column) ?? [];
    const offset = ((maxRows - group.length) * rowHeight) / 2;
    group.forEach((node, row) => {
      out.set(node.id, {
        x: left + column * colWidth,
        y: top + offset + row * rowHeight,
        column,
        row,
      });
    });
  }
  return out;
}
