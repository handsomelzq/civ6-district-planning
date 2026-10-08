/** 自由模式的起始环境。坐标共享一张地图，每座城市有独立的三格工作范围。 */
import { disc, key, distance, type Axial } from "../src/hex.ts";
import {
  MIN_CITY_CENTER_DISTANCE, type BoardState, type City, type Tile,
} from "../src/board.ts";

export const PRESETS = [
  { id: "mountain", name: "山林双城", hint: "山脉、森林、河流；适合比较学院与圣地" },
  { id: "coast", name: "海湾三城", hint: "海岸、河流、资源；适合港口与跨城组团" },
  { id: "tundra", name: "冻土双城", hint: "冻土与山地；适合俄罗斯拉夫拉" },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"];

const city = (id: string, 名称: string, q: number, r: number): City =>
  ({ id, 名称, 中心: { q, r }, 人口: 10 });

const CITY_NAMES = ["山麓城", "河畔城", "林间城", "高原城"];

const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffled = <T>(items: T[], random: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const randomSeed = (): number => Math.floor(Math.random() * 0xFFFFFFFF);

export function sandboxBoard(preset: PresetId = "mountain"): BoardState {
  const cities = preset === "coast"
    ? [city("A", "山麓城", 0, 0), city("B", "河口城", 6, 0), city("C", "海湾城", 3, 5)]
    : [city("A", preset === "tundra" ? "北境城" : "山麓城", 0, 0),
       city("B", preset === "tundra" ? "林间城" : "河畔城", 6, 0)];
  const tiles = new Map<string, Tile>();
  for (const c of cities) for (const p of disc(3, c.中心)) {
    const k = key(p);
    if (!tiles.has(k)) tiles.set(k, { 地形: preset === "tundra" ? "TERRAIN_TUNDRA" : "TERRAIN_GRASS" });
  }
  // 将城市工作范围之间的行内空洞补成真实地块；新增格不属于任何城市。
  // 不扩大城市三格工作范围，也不改变原有地形和城市中心。
  const rows = new Map<number, { min: number; max: number }>();
  for (const k of tiles.keys()) {
    const [q, r] = k.split(",").map(Number);
    const row = rows.get(r);
    rows.set(r, { min: Math.min(row?.min ?? q, q), max: Math.max(row?.max ?? q, q) });
  }
  for (const [r, { min, max }] of rows) for (let q = min; q <= max; q++) {
    const k = key({ q, r });
    if (!tiles.has(k)) tiles.set(k, { 地形: preset === "tundra" ? "TERRAIN_TUNDRA" : "TERRAIN_GRASS" });
  }
  const set = (k: string, t: Partial<Tile>) => {
    if (tiles.has(k)) tiles.set(k, { ...tiles.get(k)!, ...t });
  };
  for (const k of ["2,-1", "2,0", "1,-2", "7,-2", "8,-1"]) {
    set(k, { 地形: preset === "tundra" ? "TERRAIN_TUNDRA_MOUNTAIN" : "TERRAIN_GRASS_MOUNTAIN" });
  }
  for (const k of ["-1,1", "-2,1", "-1,2", "5,1", "4,2"]) set(k, { 地貌: "FEATURE_FOREST" });
  if (preset !== "tundra") {
    for (const k of ["0,-2", "1,-3"]) set(k, { 地貌: "FEATURE_JUNGLE" });
    // 一条跨越地图的连续河道；相邻标记格共享河流边，不再生成彼此断开的水系。
    for (const k of ["-2,1", "-1,1", "0,1", "1,1", "2,1", "3,1", "4,1", "5,1"]) {
      set(k, { 河流边: true });
    }
    set("1,1", { 资源: "RESOURCE_IRON" });
  }
  if (preset === "coast") {
    for (const [k, t] of tiles) {
      const p: Axial = { q: Number(k.split(",")[0]), r: Number(k.split(",")[1]) };
      if (distance(p, cities[2].中心) <= 2 && p.r >= 6 && !t.区域) {
        set(k, { 地形: "TERRAIN_COAST", 地貌: undefined });
      }
    }
    set("3,7", { 资源: "RESOURCE_FISH" });
    // 用连续浅水格表现内陆湖泊；它们与海洋同样覆盖整格，但提供淡水。
    for (const k of ["4,5", "4,6", "5,5", "5,6"]) {
      set(k, { 地形: "TERRAIN_COAST", 地貌: undefined, 湖泊: true });
    }
  }
  for (const c of cities) set(key(c.中心), {
    区域: "DISTRICT_CITY_CENTER", 建筑: ["BUILDING_PALACE"], 所属城市: c.id,
  });
  return {
    tiles, 城市: cities, 中心: cities[0].中心, 人口: cities[0].人口,
    已解锁科技: new Set<string>(), 已解锁市政: new Set<string>(),
    已装配政策: new Set<string>(),
    已选宗教信条: new Set<string>(),
  };
}

/** 生成可复现的自由模式多城模板；不把随机结果混进求值器。 */
export function randomSandboxBoard(seed = randomSeed()): BoardState {
  const random = seeded(seed);
  const map = disc(7);
  const tiles = new Map<string, Tile>();
  for (const p of map) {
    const roll = random();
    let terrain = "TERRAIN_GRASS";
    if (roll < 0.17) terrain = "TERRAIN_PLAINS";
    else if (roll < 0.30) terrain = "TERRAIN_TUNDRA";
    else if (roll < 0.42) terrain = "TERRAIN_DESERT";
    const hills = random() < 0.18;
    if (hills && ["TERRAIN_GRASS", "TERRAIN_PLAINS", "TERRAIN_TUNDRA", "TERRAIN_DESERT"].includes(terrain)) {
      terrain = `${terrain}_HILLS`;
    }
    if (random() < 0.08 && terrain.endsWith("_HILLS")) {
      terrain = terrain.replace("_HILLS", "_MOUNTAIN");
    }
    const tile: Tile = { 地形: terrain };
    const featureRoll = random();
    if (!terrain.endsWith("_MOUNTAIN") && featureRoll < 0.10) tile.地貌 = "FEATURE_FOREST";
    else if (!terrain.endsWith("_MOUNTAIN") && featureRoll < 0.16) tile.地貌 = "FEATURE_JUNGLE";
    else if (!terrain.endsWith("_MOUNTAIN") && featureRoll < 0.20) tile.地貌 = "FEATURE_MARSH";
    else if (terrain === "TERRAIN_DESERT" && featureRoll < 0.25) tile.地貌 = "FEATURE_OASIS";
    tiles.set(key(p), tile);
  }

  // 东南边缘形成一片海岸，地图中间保留连续陆地，方便多城规划。
  for (const p of map) {
    if ((p.q >= 5 && p.r >= 0) || (p.r >= 6 && p.q >= -1)) {
      const t = tiles.get(key(p))!;
      if (!t.区域) tiles.set(key(p), { 地形: "TERRAIN_COAST" });
    }
  }

  const candidates = shuffled(map.filter((p) =>
    distance(p, { q: 0, r: 0 }) <= 5 &&
    tiles.get(key(p))!.地形 !== "TERRAIN_COAST" &&
    tiles.get(key(p))!.地形 !== "TERRAIN_OCEAN" &&
    !tiles.get(key(p))!.地形.endsWith("_MOUNTAIN")), random);
  const centers: Axial[] = [{ q: 0, r: 0 }];
  for (const candidate of candidates) {
    if (centers.every((center) =>
      distance(center, candidate) >= MIN_CITY_CENTER_DISTANCE &&
      distance(center, candidate) <= 6)) {
      centers.push(candidate);
    }
    if (centers.length >= 2 + Math.floor(random() * 3)) break;
  }
  // 极端随机种子下仍保证至少两座城市。
  if (centers.length < 2) centers.push({ q: 4, r: 0 });

  // 一条连续河道，方向每次随机，但不穿过海岸。
  const riverR = Math.floor(random() * 5) - 2;
  for (let q = -5; q <= 4; q += 1) {
    const p = { q, r: riverR };
    const t = tiles.get(key(p));
    if (t && t.地形 !== "TERRAIN_COAST") tiles.set(key(p), { ...t, 河流边: true });
  }

  // 一小片湖泊与若干资源，确保随机模板有可辨认的规划目标。
  for (const p of [{ q: 2, r: 3 }, { q: 3, r: 3 }, { q: 2, r: 4 }]) {
    const t = tiles.get(key(p));
    if (t && !centers.some((c) => distance(c, p) < 2)) {
      tiles.set(key(p), { ...t, 地形: "TERRAIN_COAST", 湖泊: true, 地貌: undefined });
    }
  }
  for (const p of shuffled(map, random).slice(0, 8)) {
    const t = tiles.get(key(p));
    if (t && t.地形 !== "TERRAIN_COAST" && !t.地形.endsWith("_MOUNTAIN")) {
      tiles.set(key(p), { ...t, 资源: random() < 0.5 ? "RESOURCE_STONE" : "RESOURCE_IRON" });
    }
  }

  const cities = centers.map((center, index) =>
    city(String.fromCharCode(65 + index), CITY_NAMES[index], center.q, center.r));
  for (const c of cities) {
    const t = tiles.get(key(c.中心))!;
    const land = t.地形.endsWith("_MOUNTAIN") ? "TERRAIN_GRASS" :
      t.地形.endsWith("_HILLS") ? t.地形.replace("_HILLS", "") : t.地形;
    tiles.set(key(c.中心), {
      ...t, 地形: land,
      地貌: undefined, 河流边: false, 湖泊: false,
      区域: "DISTRICT_CITY_CENTER", 建筑: ["BUILDING_PALACE"], 所属城市: c.id,
    });
  }
  return {
    tiles, 城市: cities, 中心: cities[0].中心, 人口: cities[0].人口,
    已解锁科技: new Set<string>(), 已解锁市政: new Set<string>(),
    已装配政策: new Set<string>(), 已选宗教信条: new Set<string>(),
  };
}
