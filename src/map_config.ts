export type MapPresetId =
  "balanced" | "mountain-basin" | "arid-valley" | "coastal-cities" | "custom";
export type Level3 = "low" | "standard" | "high";
export type MapGeneratorConfig = {
  readonly preset: MapPresetId;
  readonly cityCount: 2 | 3 | 4;
  readonly ocean: Level3;
  readonly relief: Level3;
  readonly desert: Level3;
  readonly rivers: Level3;
  readonly resources: Level3;
  readonly polar: "none" | "north" | "south" | "random";
  readonly seed: number;
};
export type Band = readonly [number, number];
export type MapTargetBands = {
  readonly ocean: Band;
  readonly relief: Band;
  readonly mountains: Band;
  readonly desert: Band;
  readonly resources: Band;
  readonly rivers: { readonly count: 1 | 2; readonly segments: Band };
};

export const MAP_GENERATOR_VERSION = "1";

export const MAP_PRESETS: Readonly<Record<Exclude<MapPresetId, "custom">, MapGeneratorConfig>> = {
  balanced: { preset: "balanced", cityCount: 3, ocean: "standard", relief: "standard",
    desert: "standard", rivers: "standard", resources: "standard", polar: "random", seed: 0 },
  "mountain-basin": { preset: "mountain-basin", cityCount: 2, ocean: "low", relief: "high",
    desert: "low", rivers: "standard", resources: "standard", polar: "none", seed: 0 },
  "arid-valley": { preset: "arid-valley", cityCount: 3, ocean: "low", relief: "standard",
    desert: "high", rivers: "high", resources: "low", polar: "none", seed: 0 },
  "coastal-cities": { preset: "coastal-cities", cityCount: 4, ocean: "high", relief: "low",
    desert: "low", rivers: "low", resources: "high", polar: "random", seed: 0 },
};

export class MapConfigError extends Error {}

const values = {
  cityCount: [2, 3, 4], ocean: ["low", "standard", "high"],
  relief: ["low", "standard", "high"], desert: ["low", "standard", "high"],
  rivers: ["low", "standard", "high"], resources: ["low", "standard", "high"],
  polar: ["none", "north", "south", "random"],
} as const;

export function normalizeMapConfig(input: MapGeneratorConfig): MapGeneratorConfig {
  for (const [field, allowed] of Object.entries(values)) {
    if (!(allowed as readonly unknown[]).includes(input[field as keyof MapGeneratorConfig])) {
      throw new MapConfigError(`${field} 不是有效值`);
    }
  }
  if (!Number.isInteger(input.seed)) throw new MapConfigError("seed 必须是整数");
  const seed = input.seed >>> 0;
  const comparable = { ...input, seed: 0, preset: undefined };
  const matched = Object.values(MAP_PRESETS).find((preset) =>
    JSON.stringify({ ...preset, seed: 0, preset: undefined }) === JSON.stringify(comparable));
  return { ...input, seed, preset: matched?.preset ?? "custom" };
}

const bands: Record<"ocean" | "relief" | "mountains" | "desert" | "resources",
  Record<Level3, Band>> = {
  ocean: { low: [0.06, 0.10], standard: [0.11, 0.17], high: [0.18, 0.28] },
  relief: { low: [0.10, 0.16], standard: [0.17, 0.25], high: [0.26, 0.36] },
  mountains: { low: [0.01, 0.04], standard: [0.04, 0.08], high: [0.08, 0.13] },
  desert: { low: [0.05, 0.09], standard: [0.10, 0.16], high: [0.18, 0.28] },
  resources: { low: [0.03, 0.05], standard: [0.06, 0.09], high: [0.10, 0.14] },
};

export function targetBands(input: MapGeneratorConfig): MapTargetBands {
  const config = normalizeMapConfig(input);
  return {
    ocean: bands.ocean[config.ocean], relief: bands.relief[config.relief],
    mountains: bands.mountains[config.relief], desert: bands.desert[config.desert],
    resources: bands.resources[config.resources],
    rivers: config.rivers === "low" ? { count: 1, segments: [8, 14] }
      : config.rivers === "standard" ? { count: 1, segments: [15, 23] }
      : { count: 2, segments: [24, 36] },
  };
}
