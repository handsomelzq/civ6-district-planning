/** 自由模式的起始环境。坐标共享一张地图，每座城市有独立的三格工作范围。 */
import { disc, key, distance, type Axial } from "../src/hex.ts";
import { type BoardState, type City, type Tile } from "../src/board.ts";

export const PRESETS = [
  { id: "mountain", name: "山林双城", hint: "山脉、森林、河流；适合比较学院与圣地" },
  { id: "coast", name: "海湾三城", hint: "海岸、河流、资源；适合港口与跨城组团" },
  { id: "tundra", name: "冻土双城", hint: "冻土与山地；适合俄罗斯拉夫拉" },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"];

const city = (id: string, 名称: string, q: number, r: number): City =>
  ({ id, 名称, 中心: { q, r }, 人口: 10 });

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
    for (const k of ["-2,0", "-1,0", "5,0", "5,-1"]) set(k, { 河流边: true });
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
  }
  for (const c of cities) set(key(c.中心), {
    区域: "DISTRICT_CITY_CENTER", 建筑: ["BUILDING_PALACE"], 所属城市: c.id,
  });
  return {
    tiles, 城市: cities, 中心: cities[0].中心, 人口: cities[0].人口,
    已解锁科技: new Set<string>(), 已解锁市政: new Set<string>(),
  };
}
