/** 局面（boardState）。**不可变** —— 求值器的不变量 I1 要求它不被修改。
 *
 * 一个刻意的设计：`Tile.区域` 存的是**基础区域 id**，不是应用替换后的 id。
 * 替换在求值时按 `文明` 解析（求值顺序第 1 步）。好处是「同一张盘面换文明」
 * 变成一个纯参数改动 —— 而这正是对照关（关卡设计.md §1.2）要的语义：
 * L-08 与 L-09 是同一片地形、同一份局面，只有 `文明` 不同。
 */
import { type Axial, key, parseKey, neighbors, distance } from "./hex.ts";

export type Tile = {
  readonly 地形: string;
  readonly 地貌?: string;
  readonly 资源?: string;
  readonly 自然奇观?: string;
  readonly 世界奇观?: string;
  readonly 改良设施?: string;
  readonly 河流边?: boolean;
  readonly 区域?: string;          // 基础区域 id；替换在求值时解析
  readonly 建筑?: readonly string[];
};

export type BoardState = {
  readonly tiles: ReadonlyMap<string, Tile>;
  readonly 中心: Axial;
  readonly 人口: number;
  readonly 文明?: string;
  readonly 领袖?: string;
  readonly 已解锁科技: ReadonlySet<string>;
  readonly 已解锁市政: ReadonlySet<string>;
};

export const EMPTY_TILE: Tile = { 地形: "TERRAIN_GRASS" };

export function tileAt(b: BoardState, p: Axial): Tile | undefined {
  return b.tiles.get(key(p));
}

export function neighborTiles(b: BoardState, p: Axial): Tile[] {
  const out: Tile[] = [];
  for (const n of neighbors(p)) {
    const t = b.tiles.get(key(n));
    if (t) out.push(t);
  }
  return out;
}

/** 放置一个区域，返回**新的**局面。原局面不被修改（I1）。
 *
 * 会一并清掉该格的地貌（若它属于「建区域需移除」那一类）—— 这是文明 6 的实际
 * 行为，清掉之后它不再作为相邻目标被计入。原型上曾漏掉这条，导致森林重复计入。
 */
export function withDistrict(
  b: BoardState, p: Axial, districtId: string,
  removedFeatures: ReadonlySet<string>,
): BoardState {
  const k = key(p);
  const old = b.tiles.get(k);
  if (!old) throw new Error(`坐标不在盘面上：${k}`);
  const next: Tile = {
    ...old,
    区域: districtId,
    地貌: old.地貌 && removedFeatures.has(old.地貌) ? undefined : old.地貌,
  };
  const tiles = new Map(b.tiles);
  tiles.set(k, next);
  return { ...b, tiles };
}

export function withBuilding(b: BoardState, p: Axial, buildingId: string): BoardState {
  const k = key(p);
  const old = b.tiles.get(k);
  if (!old) throw new Error(`坐标不在盘面上：${k}`);
  const tiles = new Map(b.tiles);
  tiles.set(k, { ...old, 建筑: [...(old.建筑 ?? []), buildingId] });
  return { ...b, tiles };
}

/** 所有已放置区域的坐标，按坐标稳定排序（保证求值输出可复现）。 */
export function districtPositions(b: BoardState): Axial[] {
  return [...b.tiles.entries()]
    .filter(([, t]) => t.区域 !== undefined)
    .map(([k]) => parseKey(k))
    .sort((a, z) => a.q - z.q || a.r - z.r);
}

/** 是否在城市 3 格工作范围内（边界 E16）。 */
export const inWorkRange = (b: BoardState, p: Axial): boolean =>
  distance(b.中心, p) <= 3;
