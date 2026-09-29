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

export type ProgressionTexts = {
  readonly tech_tree: string;
  readonly civic_tree: string;
  readonly policy_cards: string;
};

export type ProgressionData = {
  readonly techs: ReadonlyMap<string, ProgressionNode>;
  readonly civics: ReadonlyMap<string, ProgressionNode>;
  readonly policies: readonly PolicyCard[];
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
  return {
    techs: nodeMap(texts.tech_tree, "科技id"),
    civics: nodeMap(texts.civic_tree, "市政id"),
    policies,
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
