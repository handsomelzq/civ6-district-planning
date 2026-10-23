/** Optional, local-only Civ VI strategic-view textures. No gameplay semantics here. */
import { type Tile } from "../src/board.ts";
import { type Axial } from "../src/hex.ts";

// The build enables this only when the complete prepared local texture set exists.
export const TERRAIN_ART_INSTALLED = /* LOCAL_TERRAIN_ART */ false;
const BASES: Record<string, string> = {
  GRASS: "Grasslands", PLAINS: "Plains", DESERT: "Desert", TUNDRA: "Tundra", SNOW: "Snow",
  COAST: "Coast", OCEAN: "Ocean",
};
const FEATURES: Record<string, string> = {
  FEATURE_FOREST: "Forest", FEATURE_JUNGLE: "Jungle", FEATURE_MARSH: "Marsh",
  FEATURE_OASIS: "Oasis", FEATURE_ICE: "Icecaps", FEATURE_FLOODPLAINS: "Floodplains",
  FEATURE_FLOODPLAINS_GRASSLAND: "Floodplains", FEATURE_FLOODPLAINS_PLAINS: "Floodplains",
  FEATURE_BURNING_FOREST: "Forest", FEATURE_BURNT_FOREST: "Forest",
  FEATURE_BURNING_JUNGLE: "Jungle", FEATURE_BURNT_JUNGLE: "Jungle",
};
const mountainName = (stem: string, variant: number): string =>
  `SV_TerrainMountain_${stem === "GRASS" ? "Grassland" : BASES[stem]}_Color_0${stem === "GRASS" ? variant + 1 : variant}`;
const hillName = (stem: string, variant: number): string =>
  `SV_Sprites_Hills${BASES[stem]}_Color_${stem === "PLAINS" ? "Plains_Hill_" : ""}${variant}`;
const file = (name: string): string => `civ6-terrain/${name}.png`;

export const TERRAIN_ART_FILES: readonly string[] = [
  ...Object.values(BASES).map((n) => `SV_TerrainHex${n}_Color.png`),
  ...["GRASS", "PLAINS", "DESERT", "TUNDRA", "SNOW"].flatMap((stem) =>
    [1, 2, 3].flatMap((v) => [hillName(stem, v) + ".png", mountainName(stem, v) + ".png"])),
  ...new Set(Object.values(FEATURES).map((n) => `Features_${n}_Visible.png`)),
];

export type TerrainArt = {
  readonly base: string;
  readonly relief?: { readonly href: string; readonly kind: "hill" | "mountain" };
  readonly feature?: string;
};

/** Stable coordinate variants do not change when tiles are reordered or redrawn. */
export function terrainArtFor(tile: Tile, pos: Axial): TerrainArt | undefined {
  if (tile.湖泊) return { base: file("SV_TerrainHexCoast_Color") };
  const match = /^TERRAIN_([A-Z]+)(?:_(HILLS|MOUNTAIN))?$/.exec(tile.地形);
  if (!match || !BASES[match[1]]) return undefined;
  const stem = match[1];
  const variant = ((pos.q * 31 + pos.r * 17) % 3 + 3) % 3 + 1;
  const relief = match[2] && !["COAST", "OCEAN"].includes(stem)
    ? { href: file(match[2] === "HILLS" ? hillName(stem, variant) : mountainName(stem, variant)),
        kind: match[2] === "HILLS" ? "hill" as const : "mountain" as const }
    : undefined;
  return {
    base: file(`SV_TerrainHex${BASES[stem]}_Color`), relief,
    feature: tile.地貌 && FEATURES[tile.地貌] ? file(`Features_${FEATURES[tile.地貌]}_Visible`) : undefined,
  };
}
