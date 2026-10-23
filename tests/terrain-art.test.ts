import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMap } from "../web/render.ts";
import { R, board } from "./helpers.ts";
import { rat } from "../src/rational.ts";

// Removing the full-tile art branch must fail these tests, not just change a style string.
test("安装战略视图素材后，山脉使用地形底图与透明叠层，不再挤成角落图标", () => {
  const html = renderMap(R, board({ "-1,0": { 地形: "TERRAIN_GRASS_MOUNTAIN" } }), { terrainArt: true });
  assert.match(html, /class="terrain-base"/);
  assert.match(html, /class="terrain-sprite mountain"/);
  assert.match(html, /clip-path="url\(#terrain-clip-n1-p0\)"/);
  assert.match(html, /<clipPath id="terrain-clip-n1-p0"/);
  assert.doesNotMatch(html, /class="terrain-icon"/);
  assert.match(html, /data-xy="-1,0"/);
});

test("湖泊覆盖完整地块水面，森林用透明叠层且资源与区域仍保留", () => {
  const html = renderMap(R, board({
    "0,0": { 湖泊: true, 地形: "TERRAIN_GRASS_HILLS" },
    "1,0": { 地貌: "FEATURE_FOREST", 资源: "RESOURCE_IRON" },
    "0,1": { 区域: "DISTRICT_CAMPUS" },
  }), { terrainArt: true });
  const lake = renderMap(R, board({ "0,0": { 湖泊: true, 地形: "TERRAIN_GRASS_HILLS" } }), { terrainArt: true });
  assert.match(lake, /SV_TerrainHexCoast_Color\.png/);
  assert.doesNotMatch(lake, /class="terrain-sprite/);
  assert.match(html, /class="terrain-sprite feature"/);
  assert.match(html, /Features_Forest_Visible\.png/);
  assert.match(html, /RESOURCE_IRON\.png/);
  assert.match(html, /DISTRICT_CAMPUS\.png/);
});

test("素材可选：没有本机素材时回退原图标而不请求不存在的纹理", () => {
  const b = board({ "0,0": { 地形: "TERRAIN_GRASS_MOUNTAIN", 地貌: "FEATURE_FOREST" } });
  const html = renderMap(R, b, { terrainArt: false });
  assert.match(html, /class="terrain-icon"/);
  assert.match(html, /class="feature-icon"/);
  assert.doesNotMatch(html, /civ6-terrain/);
});

test("贴图不改变盘面、格子点击目标和遮罩；河流在贴图上方仍可见", () => {
  const b = board({ "0,0": { 河流边: true }, "1,0": { 河流边: true }, "2,0": { 河流边: true } });
  const before = JSON.stringify([...b.tiles]);
  const html = renderMap(R, b, {
    terrainArt: true, selected: { q: 0, r: 0 },
    blocked: new Map([["1,0", "缺少科技"]]), preview: new Map([["2,0", rat(2)]]),
  });
  assert.equal(JSON.stringify([...b.tiles]), before);
  assert.equal((html.match(/data-xy=/g) ?? []).length, 3);
  assert.match(html, /class="hex sel"/);
  assert.match(html, /class="veil"/);
  assert.match(html, /<title>缺少科技<\/title>/);
  assert.match(html, />\+2<\/text>/);
  assert.match(html, /class="terrain-base"/);
  assert.ok(html.indexOf('class="river-layer"') > html.lastIndexOf('class="terrain-base"'));
});

test("各纬度地形和常用地貌都能得到对应素材，未知地貌保留原图标", () => {
  for (const stem of ["GRASS", "PLAINS", "DESERT", "TUNDRA", "SNOW"]) {
    for (const suffix of ["", "_HILLS", "_MOUNTAIN"]) {
      const html = renderMap(R, board({ "0,0": { 地形: `TERRAIN_${stem}${suffix}` } }), { terrainArt: true });
      assert.match(html, /class="terrain-base"/);
      assert.doesNotMatch(html, /class="terrain-icon"/);
      if (suffix) assert.match(html, /class="terrain-sprite (hill|mountain)"/);
    }
  }
  const html = renderMap(R, board({ "0,0": { 地貌: "FEATURE_REEF" } }), { terrainArt: true });
  assert.match(html, /class="feature-icon"/);
});
