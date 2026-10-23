/** 自由模式的起始环境。坐标共享一张地图，每座城市有独立的三格工作范围。 */
import { disc, key, distance, neighbors, type Axial } from "../src/hex.ts";
import {
  MIN_CITY_CENTER_DISTANCE, type BoardState, type City, type Tile,
} from "../src/board.ts";
import { isWaterTile } from "../src/river.ts";
import {
  generateMapCandidate, MAP_PRESETS,
} from "../src/map_generator.ts";
import { RANDOM_PLANNING_RADIUS } from "./random_rivers.ts";

export const PRESETS = [
  { id: "mountain", name: "山林双城", hint: "山脉、森林、河流；适合比较学院与圣地" },
  { id: "coast", name: "海湾三城", hint: "海岸、河流、资源；适合港口与跨城组团" },
  { id: "tundra", name: "冻土双城", hint: "冻土与山地；适合俄罗斯拉夫拉" },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"];

const city = (id: string, 名称: string, q: number, r: number): City =>
  ({ id, 名称, 中心: { q, r }, 人口: 10 });

const CITY_NAMES = ["山麓城", "河畔城", "林间城", "高原城"];

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
  return generateMapCandidate({ ...MAP_PRESETS.balanced, seed }, seed);
}

/** 有界组合搜索：城距不变，优先多座临河城市，不贪心固定第一座城。 */
export function selectRiverCityCenters(
  tiles: ReadonlyMap<string, Tile>, random: () => number,
): readonly Axial[] {
  const candidates = shuffled([...tiles].filter(([id, t]) =>
    distance(parseCoord(id), { q: 0, r: 0 }) <= RANDOM_PLANNING_RADIUS && !isWaterTile(t) &&
    !t.地形.endsWith("_MOUNTAIN")).map(([id]) => parseCoord(id)), random);
  const target = 2 + Math.floor(random() * 3);
  const scores = candidates.map((p) => {
    const t = tiles.get(key(p))!;
    return (t.河流边 ? 1000 : 0) +
      (neighbors(p).some((n) => tiles.get(key(n))?.湖泊) ? 5 : 0) -
      (t.地形.endsWith("_HILLS") ? 10 : 0);
  });
  const ranked = (groups: number[][]): number[][] => groups.sort((a, b) =>
    b.reduce((s, i) => s + scores[i], 0) - a.reduce((s, i) => s + scores[i], 0));
  let beam = ranked(candidates.map((_, i) => [i])).slice(0, 128);
  let best: number[] | undefined;
  for (let depth = 2; depth <= target; depth++) {
    const expanded = new Map<string, number[]>();
    for (const chosen of beam) for (let i = 0; i < candidates.length; i++) {
      if (chosen.includes(i) || !chosen.every((j) => {
        const d = distance(candidates[j], candidates[i]);
        return d >= MIN_CITY_CENTER_DISTANCE && d <= 6;
      })) continue;
      const next = [...chosen, i].sort((a, b) => a - b);
      expanded.set(next.join(","), next);
    }
    if (!expanded.size) break;
    beam = ranked([...expanded.values()]).slice(0, 128);
    const riverside = beam.find((ids) => ids.some((i) => tiles.get(key(candidates[i]))!.河流边));
    if (riverside) best = riverside;
  }
  if (!best) throw new Error(`无法找到至少一城临河且满足间距的双城城址（可建候选${candidates.length}，临河${candidates.filter((p) => tiles.get(key(p))!.河流边).length}）`);
  return best.map((i) => candidates[i]);
}

const parseCoord = (id: string): Axial => {
  const [q, r] = id.split(",").map(Number);
  return { q, r };
};
