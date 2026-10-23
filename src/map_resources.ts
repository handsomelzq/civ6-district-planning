import { type Tile } from "./board.ts";

// Base/Assets/Gameplay/Data/Resources.xml Resource_ValidTerrains；
// 此两资源没有 Resource_ValidFeatures / Resource_ValidFeatureTerrains 行。
// 仅定义首版随机生成池，不修改求值器或资源放置规则。
export const MAP_RESOURCE_TERRAINS: Readonly<Record<string, readonly string[]>> = {
  RESOURCE_STONE: ["TERRAIN_GRASS", "TERRAIN_GRASS_HILLS"],
  RESOURCE_IRON: ["TERRAIN_GRASS_HILLS", "TERRAIN_PLAINS_HILLS",
    "TERRAIN_DESERT_HILLS", "TERRAIN_TUNDRA_HILLS"],
};
export const mapResourceOptions = (tile: Tile): readonly string[] =>
  tile.湖泊 || tile.地貌 ? [] : Object.keys(MAP_RESOURCE_TERRAINS)
    .filter((id) => MAP_RESOURCE_TERRAINS[id].includes(tile.地形));
