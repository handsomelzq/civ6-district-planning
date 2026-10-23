import test from "node:test";
import assert from "node:assert/strict";
import * as brushes from "../web/brush_info.ts";
import { R } from "./helpers.ts";
import { terrainArtFor } from "../web/terrain_art.ts";

test("丘陵笔刷说明把它归入地形，明确保留基础地形而非清除地貌", () => {
  const info = brushes.brushInfo({ kind: "丘陵" }, R, undefined, {});
  assert.equal(info.title, "丘陵");
  assert.ok(info.lines.some((line) => line.includes("地形")));
  assert.ok(info.lines.some((line) => line.includes("保留") && line.includes("冻土")));
  assert.ok(info.lines.some((line) => line.includes("森林") && line.includes("雨林")));
});

test("丘陵编辑保留五种基础地形，并支持将山脉改为同种丘陵", () => {
  for (const [input, expected] of [
    ["TERRAIN_GRASS", "TERRAIN_GRASS_HILLS"],
    ["TERRAIN_PLAINS", "TERRAIN_PLAINS_HILLS"],
    ["TERRAIN_DESERT", "TERRAIN_DESERT_HILLS"],
    ["TERRAIN_TUNDRA", "TERRAIN_TUNDRA_HILLS"],
    ["TERRAIN_SNOW", "TERRAIN_SNOW_HILLS"],
    ["TERRAIN_PLAINS_HILLS", "TERRAIN_PLAINS_HILLS"],
    ["TERRAIN_TUNDRA_MOUNTAIN", "TERRAIN_TUNDRA_HILLS"],
  ]) {
    assert.equal(brushes.hillsTerrainId?.(input), expected);
  }
});

test("丘陵编辑不能把海岸、海洋或未知地形变成虚构的水域丘陵", () => {
  for (const id of ["TERRAIN_COAST", "TERRAIN_OCEAN", "UNKNOWN"]) {
    assert.equal(brushes.hillsTerrainId?.(id), undefined);
  }
});

test("丘陵编辑后的地形可复用对应官方丘陵叠层，保留森林图层", () => {
  const id = brushes.hillsTerrainId?.("TERRAIN_TUNDRA");
  assert.equal(id, "TERRAIN_TUNDRA_HILLS");
  const art = terrainArtFor({ 地形: id!, 地貌: "FEATURE_FOREST" }, { q: 0, r: 0 });
  assert.equal(art?.relief?.kind, "hill");
  assert.ok(art?.relief?.href.includes("HillsTundra"));
  assert.ok(art?.feature?.includes("Forest"));
});
