import test from "node:test";
import assert from "node:assert/strict";
import { board } from "./helpers.ts";
import { type BoardState } from "../src/board.ts";

const river = await import("../src/river.ts").catch(() => ({} as typeof import("../src/river.ts")));
const path = [{ x: 1, y: -1 }, { x: 1, y: 1 }, { x: 0, y: 2 }];
const fixture = (): BoardState => ({
  ...board({ "0,0": {}, "1,0": {}, "0,1": {}, "1,-1": {} }), 河道: [path],
});

test("真实边图使用共享整数顶点，河岸不包含只接触顶点的第三格", () => {
  assert.equal(typeof river.buildRiverGraph, "function", "需要真实河流边图接口");
  const b = fixture();
  const graph = river.buildRiverGraph(b.tiles);
  assert.deepEqual(graph.edges.get(river.edgeKey(path[0], path[1]))?.tiles.sort(), ["0,0", "1,0"]);
  assert.deepEqual([...river.riverBankKeys(b.tiles, b.河道!)].sort(), ["0,0", "0,1", "1,0"]);
  assert.equal(river.vertexKey(path[0]), "1,-1");
  assert.equal(river.edgeKey(path[0], path[1]), river.edgeKey(path[1], path[0]));
  assert.deepEqual(river.tileVertices({ q: 0, r: 0 }), [
    { x: 0, y: -2 }, { x: 1, y: -1 }, { x: 1, y: 1 },
    { x: 0, y: 2 }, { x: -1, y: 1 }, { x: -1, y: -1 },
  ]);
});

test("河岸同步不可变，不给水面或仅接触顶点的格子临河标记", () => {
  assert.equal(typeof river.syncRiverBanks, "function");
  const b = fixture();
  const snapshot = JSON.stringify([...b.tiles]);
  const result = river.syncRiverBanks(b);
  assert.equal(result.tiles.get("0,0")?.河流边, true);
  assert.equal(result.tiles.get("1,-1")?.河流边, undefined);
  assert.equal(JSON.stringify([...b.tiles]), snapshot);
  assert.equal(result.河道, b.河道);
  const tiles = new Map(result.tiles);
  tiles.set("0,0", { 地形: "TERRAIN_COAST" });
  tiles.set("1,0", { 地形: "TERRAIN_COAST", 湖泊: true });
  const water = river.syncRiverBanks({ ...result, tiles });
  assert.ok(!water.tiles.get("0,0")?.河流边);
  assert.ok(!water.tiles.get("1,0")?.河流边);
  assert.equal(water.tiles.get("0,1")?.河流边, true);
});

test("旧局面不重算临河标记，显式空河道清除标记", () => {
  assert.equal(typeof river.syncRiverBanks, "function");
  const b = board({ "0,0": { 河流边: true } });
  assert.equal(river.syncRiverBanks(b), b);
  const result = river.syncRiverBanks({ ...b, 河道: [] });
  assert.ok(!result.tiles.get("0,0")?.河流边);
  assert.equal(b.tiles.get("0,0")?.河流边, true);
});

test("河岸同步拒绝断边、重复点和缺失的真实格边", () => {
  assert.equal(typeof river.riverBankKeys, "function");
  const b = fixture();
  for (const bad of [
    [path[0], { x: 20, y: 20 }, path[2]],
    [path[0], path[0], path[2]],
    [{ x: 50, y: 50 }, { x: 51, y: 51 }, { x: 51, y: 53 }],
  ]) assert.throws(() => river.riverBankKeys(b.tiles, [bad]), /河道|河段/);
});
