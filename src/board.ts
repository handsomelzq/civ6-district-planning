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
  /** 显式淡水标记，供湖泊等不适合压缩成地形/地貌的来源使用。 */
  readonly 淡水?: boolean;
  /** 湖泊水面标记。湖泊仍使用浅水地形表现，但与海岸区分为淡水来源。 */
  readonly 湖泊?: boolean;
  readonly 资源?: string;
  readonly 自然奇观?: string;
  readonly 世界奇观?: string;
  readonly 改良设施?: string;
  readonly 河流边?: boolean;
  readonly 区域?: string;          // 基础区域 id；替换在求值时解析
  readonly 建筑?: readonly string[];
  /** 自由模式中这格区域归属的城市；相邻加成仍允许跨城。 */
  readonly 所属城市?: string;
};

export type City = { readonly id: string; readonly 名称: string; readonly 中心: Axial; readonly 人口: number };

/** 文明 VI 的城市中心间距：CITY_MIN_RANGE=3，故中心六边距离至少为 4。 */
export const MIN_CITY_CENTER_DISTANCE = 4;

export type BoardState = {
  readonly tiles: ReadonlyMap<string, Tile>;
  readonly 中心: Axial;
  readonly 人口: number;
  /** 多城自由模式；旧关卡没有此字段，仍按单城局面处理。 */
  readonly 城市?: readonly City[];
  readonly 文明?: string;
  readonly 领袖?: string;
  readonly 已解锁科技: ReadonlySet<string>;
  readonly 已解锁市政: ReadonlySet<string>;
  /** 当前政策栏中的政策卡 id。自由模式默认允许装配三张。 */
  readonly 已装配政策: ReadonlySet<string>;
  /** 当前采用的区域规划相关宗教信条。只记录信条选择，不模拟逐城宗教归属。 */
  readonly 已选宗教信条: ReadonlySet<string>;
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

/** 文明 VI 中可作为水渠/浴场引水来源的地块属性。
 *
 * 当前配置模型直接表达河流、绿洲和山脉；`淡水=true` 为湖泊等未来地块
 * 预留，不把“临海”误当作淡水。
 */
export function isFreshWaterSource(t: Tile): boolean {
  return t.淡水 === true || t.湖泊 === true ||
    t.河流边 === true ||
    t.地貌 === "FEATURE_OASIS" ||
    t.地形.endsWith("_MOUNTAIN");
}

/** 放置一个区域，返回**新的**局面。原局面不被修改（I1）。
 *
 * 会一并清掉该格的地貌（若它属于「建区域需移除」那一类）—— 这是文明 6 的实际
 * 行为，清掉之后它不再作为相邻目标被计入。原型上曾漏掉这条，导致森林重复计入。
 */
export function withDistrict(
  b: BoardState, p: Axial, districtId: string,
  removedFeatures: ReadonlySet<string>, cityId?: string,
): BoardState {
  const k = key(p);
  const old = b.tiles.get(k);
  if (!old) throw new Error(`坐标不在盘面上：${k}`);
  const next: Tile = {
    ...old,
    区域: districtId,
    所属城市: cityId ?? old.所属城市,
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

/** 在自由模式中移动一个城市中心。旧中心恢复为普通地块，新中心接管宫殿与城市归属。 */
export function moveCityCenter(b: BoardState, cityId: string, target: Axial): BoardState {
  const city = b.城市?.find((c) => c.id === cityId);
  if (!city) throw new Error(`城市不存在：${cityId}`);
  const oldKey = key(city.中心);
  const targetKey = key(target);
  const oldTile = b.tiles.get(oldKey);
  const targetTile = b.tiles.get(targetKey);
  if (!oldTile || !targetTile) throw new Error(`城市中心坐标不在盘面上：${targetKey}`);
  const tiles = new Map(b.tiles);
  const { 区域: _oldDistrict, 建筑: _oldBuildings, 所属城市: _oldCity, ...oldRest } = oldTile;
  tiles.set(oldKey, oldRest);
  tiles.set(targetKey, {
    ...targetTile,
    区域: "DISTRICT_CITY_CENTER",
    建筑: ["BUILDING_PALACE"],
    所属城市: cityId,
    地貌: undefined,
    资源: undefined,
    湖泊: false,
  });
  const cities = b.城市.map((c) =>
    c.id === cityId ? { ...c, 中心: target } : c);
  return {
    ...b,
    tiles,
    城市: cities,
    中心: cityId === cities[0]?.id ? target : b.中心,
  };
}

/** 所有已放置区域的坐标，按坐标稳定排序（保证求值输出可复现）。 */
export function districtPositions(b: BoardState): Axial[] {
  return [...b.tiles.entries()]
    .filter(([, t]) => t.区域 !== undefined)
    .map(([k]) => parseKey(k))
    .sort((a, z) => a.q - z.q || a.r - z.r);
}

/** 是否在城市 3 格工作范围内（边界 E16）。 */
export function cityFor(b: BoardState, p: Axial): City | undefined {
  if (!b.城市?.length) return { id: "单城", 名称: "本城", 中心: b.中心, 人口: b.人口 };
  const assigned = b.tiles.get(key(p))?.所属城市;
  if (assigned) return b.城市.find((c) => c.id === assigned);
  return [...b.城市].sort((a, z) =>
    distance(a.中心, p) - distance(z.中心, p) || a.id.localeCompare(z.id))[0];
}

/** 地图展示用的城市领土归属：三格范围内取最近城市；等距地块保持中立。 */
export function cityTerritoryOwner(b: BoardState, p: Axial): string | undefined {
  if (!b.城市?.length) return undefined;
  const candidates = b.城市
    .map((city) => ({ city, distance: distance(city.中心, p) }))
    .filter((item) => item.distance <= 3)
    .sort((a, z) => a.distance - z.distance || a.city.id.localeCompare(z.city.id));
  if (!candidates.length) return undefined;
  if (candidates.length > 1 && candidates[0].distance === candidates[1].distance) return undefined;
  return candidates[0].city.id;
}

export const inWorkRange = (b: BoardState, p: Axial, cityId?: string): boolean => {
  const city = cityId && b.城市?.length
    ? b.城市.find((c) => c.id === cityId)
    : cityFor(b, p);
  return city !== undefined && distance(city.中心, p) <= 3;
};
