/** 左侧笔刷的只读说明；数值直接取自游戏配置表，不参与求值。 */
import { parseCsv, parseKv } from "../src/csv.ts";
import { fmt } from "../src/rational.ts";
import { type Rules } from "../src/rules.ts";

export type BrushInfo = { title: string; lines: string[] };
export type InfoBrush =
  | { kind: "区域" | "地形" | "地貌" | "世界奇观"; id: string }
  | { kind: "移除" };

const yieldText = (s: string): string => {
  const parts = [...parseKv(s)];
  return parts.length ? parts.map(([y, n]) => `${y} ${n}`).join(" · ") : "无基础地块产出";
};

export function brushInfo(
  brush: InfoBrush, rules: Rules, civ: string | undefined,
  texts: Record<string, string>,
): BrushInfo {
  if (brush.kind === "移除") return { title: "移除区域", lines: ["点击已放置的区域格以移除区域及其建筑。"] };
  if (brush.kind === "区域") {
    const id = rules.effective(brush.id, civ);
    const district = rules.districts.get(id);
    const baseIds = new Set((rules.adjacency.get(brush.id) ?? []).map((r) => r.原始标识));
    const lines = (rules.adjacency.get(id) ?? []).map((r) => {
      const target = r.目标类别 === "区域" || r.目标类别 === "地形" || r.目标类别 === "地貌"
        ? rules.name(r.目标id) : r.目标类别;
      const amount = fmt(r.加成值);
      const per = r.目标类别 === "自身" ? "固定" : r.所需数量 === 1 ? "每个" : `每 ${r.所需数量} 个`;
      const special = id !== brush.id && !baseIds.has(r.原始标识) ? "特色 · " : "";
      return `${special}${target}：${per} ${amount.startsWith("-") ? "" : "+"}${amount} ${r.产出类型}`;
    });
    return { title: rules.name(id), lines: [
      ...(district?.是否特色区域 ? [`替换 ${rules.name(brush.id)}`] : []),
      ...(lines.length ? lines : ["无区域相邻加成规则"]),
    ] };
  }
  if (brush.kind === "世界奇观") return {
    title: brush.id ? "金字塔" : "移除奇观",
    lines: [brush.id ? "占用一格；参与世界奇观相邻加成。当前不校验建造条件。" : "点击奇观格移除世界奇观。"],
  };
  const table = brush.kind === "地形" ? "terrains.csv" : "features.csv";
  const idColumn = brush.kind === "地形" ? "地形id" : "地貌id";
  if (!brush.id) return { title: "无地貌", lines: ["清除所点地块的地貌。"] };
  const row = parseCsv(texts[table]).find((r) => r[idColumn] === brush.id);
  const title = row?.["名称"] ?? rules.name(brush.id);
  const lines = row ? [
    `地块基础产出：${yieldText(row["基础产出"])}`,
    `可建区域：${row["是否可建区域"]}`,
    ...(brush.kind === "地貌" ? [`建造区域时移除：${row["是否需移除"]}`] : []),
  ] : ["配置表未提供该项详情"];
  const matches = [...rules.adjacency.values()].flat().filter((r) =>
    r.目标类别 === brush.kind && r.目标id === brush.id);
  if (matches.length) lines.push(`相邻作用：可触发 ${[...new Set(matches.map((r) => rules.name(r.区域id)))].join("、")} 的加成`);
  return { title, lines };
}
