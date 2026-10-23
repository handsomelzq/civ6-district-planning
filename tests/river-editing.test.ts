import test from "node:test";
import assert from "node:assert/strict";
import { withDistrict, withBuilding, moveCityCenter } from "../src/board.ts";
import { syncRiverBanks } from "../src/river.ts";
import { randomSandboxBoard } from "../web/presets.ts";
import { key, parseKey } from "../src/hex.ts";

test("地形转水清除河岸、转陆恢复，撤销快照保留路径和原临河状态", () => {
  const b = randomSandboxBoard(52);
  const id = [...b.tiles].find(([, t]) => t.河流边 && !t.区域)![0];
  const history = [b], snapshot = JSON.stringify([...b.tiles]);
  const tiles = new Map(b.tiles);
  tiles.set(id, { ...tiles.get(id)!, 地形: "TERRAIN_COAST" });
  const water = syncRiverBanks({ ...b, tiles });
  assert.ok(!water.tiles.get(id)!.河流边);
  assert.equal(water.河道, b.河道);
  assert.ok([...water.tiles].some(([, t]) => t.河流边));
  const land = new Map(water.tiles);
  land.set(id, { ...land.get(id)!, 地形: "TERRAIN_GRASS" });
  assert.equal(syncRiverBanks({ ...water, tiles: land }).tiles.get(id)!.河流边, true);
  const restored = history.pop()!;
  assert.equal(restored.河道, b.河道);
  assert.equal(restored.tiles.get(id)!.河流边, true);
  assert.equal(JSON.stringify([...b.tiles]), snapshot);
});

test("区域建筑、移动城心、政策研究宗教更新都保留显式路径", () => {
  const b = randomSandboxBoard(33);
  const id = [...b.tiles].find(([, t]) => !t.区域 && t.地形 === "TERRAIN_GRASS")![0];
  const p = parseKey(id), snapshot = JSON.stringify([...b.tiles]);
  const district = withDistrict(b, p, "DISTRICT_CAMPUS", new Set());
  const building = withBuilding(district, p, "BUILDING_LIBRARY");
  const moved = moveCityCenter(b, b.城市![0].id, p);
  const changed = { ...b, 已解锁科技: new Set(["TECH_WRITING"]), 已解锁市政: new Set(["CIVIC_THEOLOGY"]),
    已装配政策: new Set(["POLICY_NATURAL_PHILOSOPHY"]), 已选宗教信条: new Set(["BELIEF_WORK_ETHIC"]) };
  for (const state of [district, building, moved, changed]) assert.equal(state.河道, b.河道);
  assert.equal(building.tiles.get(key(p))?.区域, "DISTRICT_CAMPUS");
  assert.equal(JSON.stringify([...b.tiles]), snapshot);
});
