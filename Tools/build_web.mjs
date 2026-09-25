/** 构建 web/dist/：把 src/*.ts 与 web/*.ts 剥掉类型写成 .js，并把配置表内联成一个模块。
 *
 * 跑：node Tools/build_web.mjs
 *
 * **零依赖**：类型剥离用 Node 自带的 `module.stripTypeScriptTypes`，
 * 不引 tsc、不引打包器。与 Tools/*.py 的「只用标准库」是同一条纪律。
 *
 * 为什么要把配置表内联而不是运行时 fetch：内联之后 `web/index.html` **双击就能打开**
 * （file:// 下 fetch 会被拦）。对一份作品集来说「点一下就能看到」是硬需求。
 * 代价是 dist 里有一份表的副本 —— 它是生成产物，改表后重跑本脚本即可。
 */
import { stripTypeScriptTypes } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "web", "dist");
const TABLES = [
  "adjacency_rules.csv", "districts.csv", "buildings.csv",
  "resources.csv", "terrains.csv", "features.csv", "excluded_adjacencies.csv",
  "civs.csv", "leaders.csv",
];

/** 剥类型 + 把 `./x.ts` 改写成 `./x.js`（浏览器只认 .js）。 */
function transpile(src) {
  const js = stripTypeScriptTypes(src, { mode: "strip" });
  return js.replace(/(\bfrom\s*["'])([^"']+)\.ts(["'])/g, "$1$2.js$3");
}

function emit(fromDir, names, outSub = "") {
  const outDir = path.join(DIST, outSub);
  mkdirSync(outDir, { recursive: true });
  for (const n of names) {
    const src = readFileSync(path.join(fromDir, n), "utf8");
    writeFileSync(path.join(outDir, n.replace(/\.ts$/, ".js")), transpile(src));
  }
  return names.length;
}

rmSync(DIST, { recursive: true, force: true });

// dist 的目录结构**镜像源码**：dist/src/ 与 dist/web/。
// 必须镜像，否则 `../src/x.js` 这类相对路径在构建产物里会指错地方。
//
// 1. 求值器核心（不含 rules_node.ts —— 它碰 fs，浏览器里用不上）
const coreNames = readdirSync(path.join(ROOT, "src"))
  .filter((f) => f.endsWith(".ts") && f !== "rules_node.ts").sort();
const nCore = emit(path.join(ROOT, "src"), coreNames, "src");

// 2. UI 层
const uiNames = readdirSync(path.join(ROOT, "web"))
  .filter((f) => f.endsWith(".ts")).sort();
const nUi = emit(path.join(ROOT, "web"), uiNames, "web");

// 3. 两个生成模块，emit 进 dist/web/ —— 与 UI 同级，于是源码里写 `./xxx.gen.js`
//    在源码与产物里都指向同一个位置。
const inline = (files) => files.map((f) => {
  const text = readFileSync(path.join(ROOT, "配置表", f), "utf8");
  return `  ${JSON.stringify(f)}: ${JSON.stringify(text)},`;
}).join("\n");
const genDir = path.join(DIST, "web");
writeFileSync(path.join(genDir, "tables.gen.js"),
  `/* 由 Tools/build_web.mjs 从 配置表/ 内联生成，勿手改。改表后重跑构建。 */\n` +
  `export const TABLE_TEXTS = {\n${inline(TABLES)}\n};\n`);
writeFileSync(path.join(genDir, "levels.gen.js"),
  `/* 由 Tools/build_web.mjs 生成，勿手改。 */\n` +
  `export const LEVEL_TEXTS = {\n${inline(["levels.csv", "level_tiles.csv"])}\n};\n`);

const kb = (p) => (readFileSync(p).length / 1024).toFixed(1);
console.log(`写出 web/dist/：求值器 ${nCore} 个模块、UI ${nUi} 个模块`);
console.log(`  tables.gen.js ${kb(path.join(genDir, "tables.gen.js"))} KB` +
            `｜levels.gen.js ${kb(path.join(genDir, "levels.gen.js"))} KB`);
console.log("打开方式：直接双击 web/index.html，或 node Tools/serve.mjs");
