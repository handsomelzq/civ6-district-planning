import { test } from "node:test";
import assert from "node:assert/strict";
import { localIconSrc } from "../web/local_icons.ts";

test("本地页面与公开页面使用同一套官方图标路径", () => {
  assert.equal(localIconSrc("DISTRICT_HANSA", "file:///demo/web/index.html"),
    "civ6-ui/icons/DISTRICT_HANSA.png");
  assert.equal(localIconSrc("FEATURE_FOREST", "http://localhost:8123/"),
    "civ6-ui/icons/FEATURE_FOREST.png");
  assert.equal(localIconSrc("DISTRICT_HANSA", "https://handsomelzq.github.io/civ6-district-planning/"),
    "civ6-ui/icons/DISTRICT_HANSA.png");
  assert.equal(localIconSrc("../../secret", "file:///demo/web/index.html"), undefined);
});
