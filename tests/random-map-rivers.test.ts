import test from "node:test";
import assert from "node:assert/strict";
import * as presets from "../web/presets.ts";
import { distance, neighbors, key, parseKey } from "../src/hex.ts";
import { type BoardState } from "../src/board.ts";
import { board } from "./helpers.ts";
import { observe, water, vid, eid, macroDeviation, randomFor } from "./river-test-helpers.ts";

let boards: BoardState[] | undefined;
const samples = (): BoardState[] => boards ??= Array.from({ length: 200 }, (_, i) => presets.randomSandboxBoard(i + 1));

test("200张随机图有显式连续主河、真实双岸与湖海出口", () => {
  const outlets = new Set<string>();
  for (const [i, b] of samples().entries()) {
    assert.equal(b.河道?.length, 1, `seed=${i + 1}需要真实路径`);
    assert.equal(b.tiles.size, 169);
    const path = b.河道![0], graph = observe(b.tiles), banks = new Set<string>();
    assert.ok(path.length >= 3);
    assert.equal(new Set(path.map(vid)).size, path.length);
    for (let j = 1; j < path.length; j++) {
      const owners = graph.edges.get(eid(path[j - 1], path[j]));
      assert.equal(owners?.length, 2);
      assert.ok(owners!.every((id) => !water(b.tiles.get(id)!)));
      assert.ok(!owners!.every((id) => b.tiles.get(id)!.地形.endsWith("_MOUNTAIN")));
      owners!.forEach((id) => banks.add(id));
    }
    assert.deepEqual([...b.tiles].filter(([, t]) => t.河流边).map(([id]) => id).sort(), [...banks].sort());
    for (const v of path.slice(0, -1)) assert.ok(graph.incident.get(vid(v))!.every((id) => !water(b.tiles.get(id)!)));
    const waterIds = graph.incident.get(vid(path.at(-1)!))!.filter((id) => water(b.tiles.get(id)!));
    assert.ok(waterIds.length);
    outlets.add(waterIds.some((id) => b.tiles.get(id)!.湖泊) ? "湖" : "海");
    const land = graph.incident.get(vid(path.at(-1)!))!.filter((id) => !water(b.tiles.get(id)!) &&
      !/^TERRAIN_(TUNDRA|SNOW)/.test(b.tiles.get(id)!.地形));
    if (land.length) {
      const low = [...new Set(land.flatMap((id) => [id, ...neighbors(parseKey(id)).map(key)]))]
        .filter((id) => ["TERRAIN_GRASS", "TERRAIN_PLAINS"].includes(b.tiles.get(id)?.地形 ?? ""));
      assert.ok(low.length >= 2, `seed=${i + 1}：温暖河口低地`);
      assert.ok(low.some((id) => neighbors(parseKey(id)).some((p) => low.includes(key(p)))));
    }
  }
  assert.deepEqual([...outlets].sort(), ["海", "湖"].sort());
});

test("临河城址优先但不牺牲4至6格间距，第一城不再固定中心", () => {
  let riverside = 0, count = 0;
  const firstCities = new Set<string>();
  for (const [i, b] of samples().entries()) {
    const cities = b.城市!;
    assert.ok(cities.length >= 2 && cities.length <= 4);
    firstCities.add(key(cities[0].中心));
    let local = 0;
    for (const c of cities) {
      const t = b.tiles.get(key(c.中心))!;
      assert.ok(!water(t) && !t.地形.endsWith("_MOUNTAIN"));
      assert.ok(distance(c.中心, { q: 0, r: 0 }) <= 5);
      if (t.河流边) { local++; riverside++; }
      count++;
    }
    assert.ok(local >= 1, `seed=${i + 1}至少一城临河`);
    for (let a = 0; a < cities.length; a++) for (let z = a + 1; z < cities.length; z++) {
      const d = distance(cities[a].中心, cities[z].中心);
      assert.ok(d >= 4 && d <= 6, `seed=${i + 1}城距=${d}`);
    }
  }
  assert.ok(riverside / count >= 0.6, `临河比例=${riverside}/${count}`);
  assert.ok(firstCities.size >= 10, "不能只在(0,0)附近微调第一城");
  console.log(`临河城市 ${riverside}/${count} (${(100 * riverside / count).toFixed(1)}%)`);
});

test("山丘源区与宏观弯曲达到设计比例，不只是横排六边形锯齿", () => {
  let elevated = 0, curved = 0;
  const shapes = new Set<string>();
  for (const b of samples()) {
    assert.ok(b.河道, "需要显式路径");
    const path = b.河道[0], graph = observe(b.tiles);
    if (graph.incident.get(vid(path[0]))!.filter((id) => /_(HILLS|MOUNTAIN)$/.test(b.tiles.get(id)!.地形)).length >= 2) elevated++;
    if (macroDeviation(path) >= 2 * Math.sqrt(3)) curved++;
    shapes.add(JSON.stringify(path));
  }
  assert.ok(elevated >= 160, `山丘源头=${elevated}/200`);
  assert.ok(curved >= 100, `宏观弯曲=${curved}/200`);
  assert.ok(shapes.size >= 150);
  console.log(`山丘源头 ${elevated}/200；宏观弯曲 ${curved}/200；不同路径 ${shapes.size}`);
});

test("固定种子连同水系和城市完全重现，非法城址输入明确失败", () => {
  assert.equal(typeof presets.selectRiverCityCenters, "function");
  assert.deepEqual(presets.randomSandboxBoard(12345), presets.randomSandboxBoard(12345));
  assert.throws(() => presets.selectRiverCityCenters(board({ "0,0": { 河流边: true } }).tiles, randomFor(1)), /城址|城市/);
});

test("内陆湖必须与海岸隔开，seed251不能生成淡水海湾", () => {
  for (const seed of [251, ...Array.from({ length: 200 }, (_, i) => i + 1)]) {
    const b = presets.randomSandboxBoard(seed);
    const lakes = [...b.tiles].filter(([, t]) => t.湖泊).map(([id]) => id);
    assert.equal(lakes.length, 3);
    for (const id of lakes) for (const p of neighbors(parseKey(id))) {
      const t = b.tiles.get(key(p));
      assert.ok(!t || !water(t) || t.湖泊, `seed=${seed}：湖格${id}不能连接海水${key(p)}`);
    }
  }
});

test("seed39的河道不能全在外围而让选城范围内没有临河地块", () => {
  const b = presets.randomSandboxBoard(39);
  assert.ok(b.城市!.some((c) => b.tiles.get(key(c.中心))?.河流边));
});
