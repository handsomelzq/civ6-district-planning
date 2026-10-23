/** Portable board schema. Reconstruct collections explicitly; never trust imported totals. */
import { type BoardState, type Tile } from "./board.ts";
import { type Rules } from "./rules.ts";
import { SUPPORTED_POLICY_IDS, SUPPORTED_BELIEF_IDS } from "./evaluate.ts";
import { syncRiverBanks } from "./river.ts";

export const boardToData = (b: BoardState) => ({ ...b,
  tiles: [...b.tiles].sort(([a], [z]) => a.localeCompare(z)),
  已解锁科技: [...b.已解锁科技].sort(), 已解锁市政: [...b.已解锁市政].sort(),
  已装配政策: [...b.已装配政策].sort(), 已选宗教信条: [...b.已选宗教信条].sort(),
});

export type ResearchCatalog = {
  techs: ReadonlySet<string>; civics: ReadonlySet<string>;
  improvements?: ReadonlySet<string>;
};
const fail = (message: string): never => { throw new Error(`存档无效：${message}`); };
export function record(value: unknown, field: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} 必须为对象`);
  return value as Record<string, any>;
}
const integer = (v: unknown, lo: number, hi: number, field: string): number => {
  if (!Number.isSafeInteger(v) || (v as number) < lo || (v as number) > hi) fail(`${field} 超出范围`);
  return v as number;
};
const position = (v: unknown) => {
  const p = record(v, "坐标");
  return { q: integer(p.q, -100, 100, "q"), r: integer(p.r, -100, 100, "r") };
};
const text = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !v.length || v.length > 120) fail(`${field} 不是有效文本`);
  return v as string;
};
const list = (v: unknown, field: string, max = 300): any[] => {
  if (!Array.isArray(v) || v.length > max) fail(`${field} 列表格式/长度错误`);
  return v as any[];
};

export function boardFromData(value: unknown, rules: Rules, catalog: ResearchCatalog): BoardState {
  const b = record(value, "局面");
  const known = (v: unknown, ids: { has(id: string): boolean }, field: string): string => {
    const id = text(v, field);
    if (!ids.has(id)) fail(`${field} 含未知 ID：${id}`);
    return id;
  };
  const set = (v: unknown, ids: { has(id: string): boolean }, field: string, max = 300) => {
    const values = list(v, field, max).map(id => known(id, ids, field));
    if (new Set(values).size !== values.length) fail(`${field} 含重复项`);
    return new Set(values);
  };
  const tiles = new Map<string, Tile>();
  for (const entry of list(b.tiles, "地块", 2000)) {
    if (!Array.isArray(entry) || entry.length !== 2) fail("地块条目格式错误");
    const [id, raw] = entry;
    if (typeof id !== "string" || !/^-?\d+,-?\d+$/.test(id)) fail("地块坐标格式错误");
    const [q, r] = id.split(",").map(Number);
    position({ q, r });
    if (`${q},${r}` !== id || tiles.has(id)) fail("地块坐标重复或不规范");
    const t = record(raw, "地块");
    const next: any = { 地形: known(t.地形, rules.names, "地形") };
    if (!next.地形.startsWith("TERRAIN_")) fail("地形类型错误");
    for (const field of ["地貌", "自然奇观"] as const) if (t[field] !== undefined) {
      next[field] = known(t[field], rules.names, field);
      if (!next[field].startsWith("FEATURE_")) fail(`${field} 类型错误`);
    }
    for (const [field, ids] of [["区域", rules.districts], ["资源", rules.resources]] as const)
      if (t[field] !== undefined) next[field] = known(t[field], ids, field);
    if (t.世界奇观 !== undefined) next.世界奇观 = known(t.世界奇观, new Set(["BUILDING_PYRAMIDS"]), "世界奇观");
    if (t.改良设施 !== undefined)
      next.改良设施 = known(t.改良设施, catalog.improvements ?? new Set(), "改良设施");
    if (t.建筑 !== undefined) next.建筑 = [...set(t.建筑, rules.buildings, "建筑", 100)];
    if (t.所属城市 !== undefined) next.所属城市 = text(t.所属城市, "城市归属");
    for (const field of ["湖泊", "淡水", "河流边"] as const) if (t[field] !== undefined) {
      if (typeof t[field] !== "boolean") fail(`${field} 必须为布尔值`);
      next[field] = t[field];
    }
    tiles.set(id, next);
  }
  if (!tiles.size) fail("地图为空");
  const center = position(b.中心);
  if (!tiles.has(`${center.q},${center.r}`)) fail("城市中心不在地图中");
  const cities = b.城市 === undefined ? undefined : list(b.城市, "城市", 20).map(c => {
    c = record(c, "城市");
    const p = position(c.中心);
    if (!tiles.has(`${p.q},${p.r}`)) fail("城市中心不在地图中");
    return { id: text(c.id, "城市 ID"), 名称: text(c.名称, "城市名称"), 中心: p,
      人口: integer(c.人口, 1, 1000, "人口") };
  });
  if (cities && (!cities.length || new Set(cities.map(c => c.id)).size !== cities.length)) fail("城市为空或重复");
  if (cities && new Set(cities.map(c => `${c.中心.q},${c.中心.r}`)).size !== cities.length)
    fail("多个城市使用同一个中心坐标");
  for (const t of tiles.values()) if (t.所属城市 && !cities?.some(c => c.id === t.所属城市)) fail("未知城市归属");
  const civ = b.文明 === undefined ? undefined : known(b.文明, rules.civAbility, "文明");
  const leader = b.领袖 === undefined ? undefined : known(b.领袖,
    new Set((rules.leadersByCiv.get(civ ?? "") ?? []).map(l => l.id)), "领袖");
  const rivers = b.河道 === undefined ? undefined : list(b.河道, "河道", 100).map(path => {
    const vertices = list(path, "河流顶点", 2000);
    if (vertices.length < 3) fail("河道至少需要两个河段");
    return vertices.map(v => {
      v = record(v, "河流顶点");
      return { x: integer(v.x, -1000, 1000, "河流x"), y: integer(v.y, -1000, 1000, "河流y") };
    });
  });
  // Explicit paths are authoritative: validate shared hex edges and rebuild bank flags.
  // Old saves without paths keep their legacy bank flags.
  return syncRiverBanks({ tiles, 中心: center, 人口: integer(b.人口, 1, 1000, "人口"),
    城市: cities, 文明: civ, 领袖: leader, 河道: rivers,
    已解锁科技: set(b.已解锁科技, catalog.techs, "科技"), 已解锁市政: set(b.已解锁市政, catalog.civics, "市政"),
    已装配政策: set(b.已装配政策, SUPPORTED_POLICY_IDS, "政策", 3),
    已选宗教信条: set(b.已选宗教信条, SUPPORTED_BELIEF_IDS, "宗教", 8) });
}
