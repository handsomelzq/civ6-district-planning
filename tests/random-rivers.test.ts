import test from "node:test";
import assert from "node:assert/strict";
import { emptyBoard } from "./helpers.ts";
import { neighbors, key, parseKey } from "../src/hex.ts";
import { type Tile } from "../src/board.ts";
import { randomFor, observe, water, vid, eid } from "./river-test-helpers.ts";
const gen = await import("../web/random_rivers.ts").catch(() => ({} as typeof import("../web/random_rivers.ts")));

const input = (): Map<string, Tile> => {
  const tiles = new Map(emptyBoard(7).tiles);
  for (const [id] of tiles) {
    const { q, r } = parseKey(id);
    if ((q >= 5 && r >= 0) || (r >= 6 && q >= -1)) tiles.set(id, { 地形: "TERRAIN_COAST" });
  }
  for (const id of ["2,3", "3,3", "2,4"]) tiles.set(id, { 地形: "TERRAIN_COAST", 湖泊: true });
  for (const id of ["-3,0", "-3,1", "-2,1", "0,-3", "1,-3"]) tiles.set(id, { 地形: "TERRAIN_GRASS_HILLS" });
  return tiles;
};

test("随机水系沿共享边连续入水，不绕环或跨越水面", () => {
  assert.equal(typeof gen.generateRandomRivers, "function", "需要有源头和出口的生成器");
  for (let seed = 1; seed <= 30; seed++) {
    const original = input(), before = JSON.stringify([...original]);
    const result = gen.generateRandomRivers(original, randomFor(seed));
    assert.equal(result.paths.length, 1);
    const path = result.paths[0], graph = observe(result.tiles);
    assert.ok(path.length >= 3);
    assert.equal(new Set(path.map(vid)).size, path.length);
    for (let i = 1; i < path.length; i++) {
      const banks = graph.edges.get(eid(path[i - 1], path[i]));
      assert.equal(banks?.length, 2);
      assert.ok(banks!.every((id) => !water(result.tiles.get(id)!)));
      assert.ok(!banks!.every((id) => result.tiles.get(id)!.地形.endsWith("_MOUNTAIN")));
    }
    const touchingWater = path.map((v) => graph.incident.get(vid(v))!.some((id) => water(result.tiles.get(id)!)));
    assert.ok(touchingWater.slice(0, -1).every((v) => !v));
    assert.equal(touchingWater.at(-1), true);
    assert.ok(result.mouthLand.size >= 2);
    const lowlands = [...result.mouthLand];
    assert.ok(lowlands.every((id) => ["TERRAIN_GRASS", "TERRAIN_PLAINS"].includes(result.tiles.get(id)!.地形)));
    assert.ok(lowlands.some((id) => neighbors(parseKey(id)).some((p) => result.mouthLand.has(key(p)))));
    assert.equal(JSON.stringify([...original]), before);
  }
});

test("固定随机源重现水系，没有丘陵时补合法源区且不残留丘陵沼泽", () => {
  assert.equal(typeof gen.generateRandomRivers, "function");
  const tiles = input();
  for (const [id, t] of tiles) if (!water(t)) tiles.set(id, { 地形: "TERRAIN_GRASS", 地貌: "FEATURE_MARSH" });
  const a = gen.generateRandomRivers(tiles, randomFor(66));
  const b = gen.generateRandomRivers(tiles, randomFor(66));
  assert.deepEqual(a, b);
  const hills = [...a.tiles.values()].filter((t) => t.地形.endsWith("_HILLS"));
  assert.ok(hills.length >= 2);
  assert.ok(hills.every((t) => t.地貌 !== "FEATURE_MARSH"));
});

test("无水出口或没有可通行陆地的输入明确失败而非无限生成", () => {
  assert.equal(typeof gen.generateRandomRivers, "function");
  const allWater = new Map([...emptyBoard(2).tiles].map(([id]) => [id, { 地形: "TERRAIN_COAST" }]));
  const isolated = new Map(allWater); isolated.set("0,0", { 地形: "TERRAIN_GRASS" });
  for (const tiles of [emptyBoard(2).tiles, allWater, isolated]) {
    assert.throws(() => gen.generateRandomRivers(tiles, randomFor(1)), /河流|河道|出口|水域/);
  }
});

test("已有山峰源头不可达时，补可达丘陵源区后生成而非提前报错", () => {
  const tiles = new Map(emptyBoard(7).tiles);
  for (const [id] of tiles) {
    const { q, r } = parseKey(id);
    if ((q >= 5 && r >= 0) || (r >= 6 && q >= -1)) tiles.set(id, { 地形: "TERRAIN_COAST" });
  }
  const isolated = new Set(["-4,0", "-3,0", "-4,1"]);
  for (const id of isolated) {
    tiles.set(id, { 地形: "TERRAIN_GRASS_MOUNTAIN" });
    for (const p of neighbors(parseKey(id))) if (!isolated.has(key(p))) {
      tiles.set(key(p), { 地形: "TERRAIN_COAST", 湖泊: true });
    }
  }
  const snapshot = JSON.stringify([...tiles]);
  const result = gen.generateRandomRivers(tiles, randomFor(1));
  const graph = observe(result.tiles), path = result.paths[0];
  assert.ok(path.length >= 3);
  assert.ok(graph.incident.get(vid(path[0]))!.filter((id) => result.tiles.get(id)!.地形.endsWith("_HILLS")).length >= 2);
  assert.ok(graph.incident.get(vid(path.at(-1)!))!.some((id) => water(result.tiles.get(id)!)));
  for (let i = 1; i < path.length; i++) {
    const owners = graph.edges.get(eid(path[i - 1], path[i]))!;
    assert.equal(owners.length, 2);
    assert.ok(owners.every((id) => !water(result.tiles.get(id)!)));
  }
  assert.equal(JSON.stringify([...tiles]), snapshot);
});
