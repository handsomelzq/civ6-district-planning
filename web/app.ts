/** 应用层：状态、交互、两个模式的接线。
 *
 * 架构约束（GDD §7）：**模式层不得实现任何产出规则**。这里唯一碰数值的地方是
 * 「两次求值结果相减」得到悬停预览，而那两次都是 `evaluate()` 算的。
 */
import { Rules } from "../src/rules.ts";
import { TABLE_TEXTS } from "./tables.gen.js";      // 构建期生成，见 Tools/build_web.mjs
import { LEVEL_TEXTS } from "./levels.gen.js";      // 同上
import { evaluate, total, type YieldTree } from "../src/evaluate.ts";
import {
  type BoardState, type Tile, withDistrict, districtPositions, inWorkRange,
} from "../src/board.ts";
import { type Axial, key, parseKey, disc } from "../src/hex.ts";
import { fmt, cmp, sub, ZERO, isZero, type Rat } from "../src/rational.ts";
import {
  renderMap, renderTotals, renderBreakdown, yieldColor,
} from "./render.ts";
import {
  loadLevels, meetsGoal, starsOf, scoreOf, goalText, type Level,
} from "./levels.ts";

const rules = new Rules(TABLE_TEXTS as never);
const { levels, problems } = loadLevels(rules, LEVEL_TEXTS as never);

// ── 可放置的区域调色板 ────────────────────────────────────────────────
// 只列首期用到的区域。取自 districts.csv，不硬编码名称。
const PALETTE = [
  "DISTRICT_CAMPUS", "DISTRICT_HOLY_SITE", "DISTRICT_GOVERNMENT",
  "DISTRICT_COMMERCIAL_HUB", "DISTRICT_THEATER", "DISTRICT_INDUSTRIAL_ZONE",
  "DISTRICT_ENCAMPMENT", "DISTRICT_HARBOR", "DISTRICT_AQUEDUCT",
].filter((d) => rules.districts.has(d));

const CIVS: [string, string][] = [
  ["", "常规文明（无特色区域）"],
  ["CIVILIZATION_KOREA", "韩国 · 书院"],
  ["CIVILIZATION_GERMANY", "德国 · 汉萨"],
  ["CIVILIZATION_GREECE", "希腊 · 卫城"],
  ["CIVILIZATION_GAUL", "高卢 · 奥皮杜姆"],
  ["CIVILIZATION_VIETNAM", "越南 · 城池"],
];

const TERRAIN_EDIT: [string, string][] = [
  ["TERRAIN_GRASS", "草原"], ["TERRAIN_PLAINS", "平原"],
  ["TERRAIN_GRASS_MOUNTAIN", "山脉"], ["TERRAIN_COAST", "海岸"],
  ["TERRAIN_OCEAN", "海洋"], ["TERRAIN_DESERT", "沙漠"],
];
const FEATURE_EDIT: [string, string][] = [
  ["", "无地貌"], ["FEATURE_FOREST", "森林"], ["FEATURE_JUNGLE", "雨林"],
  ["FEATURE_MARSH", "沼泽"],
];

// ── 状态 ──────────────────────────────────────────────────────────────
type Brush =
  | { kind: "区域"; id: string }
  | { kind: "移除" }
  | { kind: "地形"; id: string }
  | { kind: "地貌"; id: string };

type App = {
  mode: "自由" | "挑战";
  board: BoardState;
  undo: BoardState[];
  brush: Brush;
  selected?: Axial;
  hovered?: Axial;
  focusYield: string;
  level?: Level;
  /** 挑战模式：关卡初始局面（重试用）。 */
  levelStart?: BoardState;
  settled?: "达成" | "失败";
};

function sandboxBoard(): BoardState {
  const tiles = new Map<string, Tile>();
  for (const p of disc(3)) tiles.set(key(p), { 地形: "TERRAIN_GRASS" });
  // 预置一点地形，让玩家一进来就能看到相邻加成在动
  const set = (k: string, t: Partial<Tile>) =>
    tiles.set(k, { ...tiles.get(k)!, ...t });
  set("0,0", { 区域: "DISTRICT_CITY_CENTER", 建筑: ["BUILDING_PALACE"] });
  for (const k of ["2,-1", "2,0", "1,-2"]) set(k, { 地形: "TERRAIN_GRASS_MOUNTAIN" });
  for (const k of ["-1,1", "-2,1", "-1,2"]) set(k, { 地貌: "FEATURE_FOREST" });
  for (const k of ["0,-2", "1,-3"]) set(k, { 地貌: "FEATURE_JUNGLE" });
  set("-2,0", { 河流边: true });
  set("-1,0", { 河流边: true });
  set("1,1", { 资源: "RESOURCE_IRON" });
  for (const k of ["3,-3", "3,-2", "2,1", "3,0"]) set(k, { 地形: "TERRAIN_COAST" });
  return {
    tiles, 中心: { q: 0, r: 0 }, 人口: 10, 文明: undefined, 领袖: undefined,
    已解锁科技: new Set(["TECH_WRITING"]), 已解锁市政: new Set(),
  };
}

const app: App = {
  mode: "自由",
  board: sandboxBoard(),
  undo: [],
  brush: { kind: "区域", id: PALETTE[0] },
  focusYield: "科技",
};

// ── 交互：放置 / 编辑 / 撤销 ──────────────────────────────────────────
/** 不可放置的原因。空字符串表示可放。规则来自求值器侧的约束，不在这里另立。 */
function blockReason(b: BoardState, p: Axial, districtId: string): string {
  const t = b.tiles.get(key(p));
  if (!t) return "不在盘面上";
  if (t.区域) return `已有 ${rules.name(rules.effective(t.区域, b.文明))}`;
  if (!rules.buildableTerrain.has(t.地形)) return "该地形不可建区域";
  if (!inWorkRange(b, p)) return "超出城市 3 格工作范围（E16）";
  if (app.mode === "挑战" && remainingBudget() <= 0) return "放置配额已用完";
  return "";
}

function blockedMap(): Map<string, string> {
  const m = new Map<string, string>();
  if (app.brush.kind !== "区域") return m;
  for (const p of disc(3, app.board.中心)) {
    if (!app.board.tiles.has(key(p))) continue;
    const why = blockReason(app.board, p, app.brush.id);
    if (why) m.set(key(p), why);
  }
  return m;
}

const remainingBudget = (): number => {
  if (!app.level || !app.levelStart) return Infinity;
  const used = districtPositions(app.board).length -
    districtPositions(app.levelStart).length;
  return app.level.约束值 - used;
};

function push() { app.undo.push(app.board); if (app.undo.length > 200) app.undo.shift(); }

function onClick(p: Axial) {
  if (app.settled) return;
  app.selected = p;
  const k = key(p);
  const t = app.board.tiles.get(k);
  if (!t) return;
  const b = app.brush;
  if (b.kind === "区域") {
    if (blockReason(app.board, p, b.id)) { render(); return; }
    push();
    app.board = withDistrict(app.board, p, b.id, rules.removedByDistrict);
  } else if (b.kind === "移除") {
    // 挑战模式里不许拆关卡自带的区域 —— 那是残局的一部分
    const start = app.levelStart?.tiles.get(k);
    if (app.mode === "挑战" && start?.区域) { render(); return; }
    if (!t.区域) { render(); return; }
    push();
    const tiles = new Map(app.board.tiles);
    const { 区域, 建筑, ...rest } = t;
    tiles.set(k, rest as Tile);
    app.board = { ...app.board, tiles };
  } else if (app.mode === "自由") {
    push();
    const tiles = new Map(app.board.tiles);
    if (b.kind === "地形") tiles.set(k, { ...t, 地形: b.id });
    else tiles.set(k, { ...t, 地貌: b.id || undefined });
    app.board = { ...app.board, tiles };
  }
  checkSettlement();
  render();
}

function checkSettlement() {
  if (app.mode !== "挑战" || !app.level || app.settled) return;
  const got = evaluate(rules, app.board).合计;
  // 边界 G8：达成与约束耗尽同时发生时**达成优先**
  if (meetsGoal(app.level, got)) { app.settled = "达成"; return; }
  if (remainingBudget() <= 0) { app.settled = "失败"; return; }
  // 边界 G6：没有合法空格可放但还有配额 —— 立即判定，不让玩家干等
  const anySpot = [...app.board.tiles.keys()].some(
    (k) => !blockReason(app.board, parseKey(k), "DISTRICT_CAMPUS"));
  if (!anySpot) app.settled = "失败";
}

// ── 预览：两次求值之差 ────────────────────────────────────────────────
function previewMap(tree: YieldTree): Map<string, Rat> {
  const out = new Map<string, Rat>();
  if (app.brush.kind !== "区域" || app.settled) return out;
  const before = total(tree, app.focusYield);
  for (const p of disc(3, app.board.中心)) {
    const k = key(p);
    if (!app.board.tiles.has(k)) continue;
    if (blockReason(app.board, p, app.brush.id)) continue;
    const after = total(
      evaluate(rules, withDistrict(app.board, p, app.brush.id, rules.removedByDistrict)),
      app.focusYield);
    out.set(k, sub(after, before));
  }
  return out;
}

// ── 渲染 ──────────────────────────────────────────────────────────────
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function render() {
  const tree = evaluate(rules, app.board);
  $("map").innerHTML = renderMap(rules, app.board, {
    selected: app.selected, hovered: app.hovered,
    preview: previewMap(tree), 预览产出: app.focusYield,
    blocked: blockedMap(),
  });
  $("totals").innerHTML = renderTotals(tree, app.focusYield);
  $("breakdown").innerHTML = renderBreakdown(tree, app.focusYield);
  $("tileinfo").innerHTML = tileInfo();
  $("modebar").innerHTML = modeBar(tree);
  $("palette").innerHTML = paletteHtml();
  $("diag").innerHTML = tree.诊断.length === 0 ? "" :
    tree.诊断.map((d) => `<div class="warn">⚠ ${esc(d.说明)}</div>`).join("");
  wire();
}

function tileInfo(): string {
  if (!app.selected) return `<span class="muted">点一个格子看它的属性</span>`;
  const t = app.board.tiles.get(key(app.selected));
  if (!t) return "";
  const bits = [`地形 ${esc(rules.name(t.地形))}`];
  if (t.地貌) bits.push(`地貌 ${esc(t.地貌.replace("FEATURE_", ""))}`);
  if (t.资源) bits.push(`资源 ${esc(rules.name(t.资源))}`);
  if (t.河流边) bits.push("临河");
  if (t.区域) {
    const did = rules.effective(t.区域, app.board.文明);
    bits.push(`区域 ${esc(rules.name(did))}`);
    if (did !== t.区域) bits.push(`（替换了 ${esc(rules.name(t.区域))}）`);
  }
  return `(${app.selected.q},${app.selected.r})　` + bits.join("　·　");
}

function modeBar(tree: YieldTree): string {
  if (app.mode === "自由") {
    const opts = CIVS.map(([id, nm]) =>
      `<option value="${id}" ${app.board.文明 === (id || undefined) ? "selected" : ""}>${esc(nm)}</option>`).join("");
    return `<label>文明 <select id="civ">${opts}</select></label>
      <button id="undo" ${app.undo.length ? "" : "disabled"}>撤销（${app.undo.length}）</button>
      <button id="reset">重置沙盒</button>
      <span class="hint">自由模式没有胜负。它要回答的是「这一点产出凭什么是这样」。</span>`;
  }
  const lv = app.level!;
  const got = tree.合计;
  const bars = [...lv.目标].map(([y, need]) => {
    const cur = got.get(y) ?? ZERO;
    const pct = Math.min(100, Number(fmt(cur)) / Number(fmt(need)) * 100);
    const ok = cmp(cur, need) >= 0;
    return `<div class="goal">
      <span class="gname" style="color:${yieldColor(y)}">${esc(y)}</span>
      <span class="gbar"><i style="width:${pct.toFixed(0)}%;background:${yieldColor(y)}"></i></span>
      <span class="gnum ${ok ? "ok" : ""}">${fmt(cur)} / ${fmt(need)}</span></div>`;
  }).join("");
  const left = remainingBudget();
  return `<div class="lvhead">
      <b>${esc(lv.关卡id)}「${esc(lv.名称)}」</b>
      <span class="chip">${esc(lv.关卡类别)}关</span>
      ${lv.母题 !== "无" ? `<span class="chip">母题 ${esc(lv.母题)}</span>` : ""}
      <span class="chip">${esc(rules.name(lv.文明))}</span>
      <span class="chip">剩余配额 <b>${left}</b> / ${lv.约束值}</span>
    </div>${bars}${settleHtml(tree)}`;
}

function settleHtml(tree: YieldTree): string {
  if (!app.settled) return `<div class="lvfoot">
      <button id="undo" ${app.undo.length ? "" : "disabled"}>撤销（返还配额）</button>
      <button id="retry">重试</button>
      <button id="tolist">返回关卡表</button>
      <span class="hint">撤销会<b>返还</b>配额：约束是「最终布局用了几个区域」的预算，不是操作次数（G4）。</span>
    </div>`;
  const lv = app.level!;
  const stars = starsOf(lv, tree.合计);
  const s = scoreOf(lv, tree.合计);
  return `<div class="settle ${app.settled === "达成" ? "win" : "lose"}">
    <div class="stitle">${app.settled === "达成" ? "关卡达成" : "配额耗尽，未达成"}</div>
    <div class="stars">${"★".repeat(stars)}${"☆".repeat(3 - stars)}</div>
    <table class="sgrid">
      <tr><td>目标</td><td>${esc(goalText(lv))}</td></tr>
      <tr><td>你的产出合计</td><td><b>${fmt(s)}</b></td></tr>
      <tr><td>二星 / 三星阈值</td><td>${fmt(lv.二星阈值)} / ${fmt(lv.三星阈值)}（三星＝设计期穷举出的最优值）</td></tr>
      <tr><td>贪心基线</td><td>${esc(lv.贪心基线)}　<span class="muted">每步选当前收益最高，能达到的上限</span></td></tr>
    </table>
    <div class="lvfoot"><button id="retry">重试</button>
      <button id="tolist">返回关卡表</button></div></div>`;
}

function paletteHtml(): string {
  const btn = (b: Brush, label: string, sub = "") => {
    const on = JSON.stringify(app.brush) === JSON.stringify(b);
    return `<button class="pb ${on ? "on" : ""}" data-brush='${JSON.stringify(b)}'>
      ${esc(label)}${sub ? `<i>${esc(sub)}</i>` : ""}</button>`;
  };
  const districts = PALETTE.map((d) => {
    const eff = rules.effective(d, app.board.文明);
    const nm = rules.name(eff);
    return btn({ kind: "区域", id: d }, nm,
      eff !== d ? `替换 ${rules.name(d)}` : "");
  }).join("");
  let html = `<div class="pgroup"><h4>放置区域</h4><div class="prow">${districts}</div></div>`;
  html += `<div class="pgroup"><h4>其他</h4><div class="prow">${btn({ kind: "移除" }, "移除区域")}</div></div>`;
  if (app.mode === "自由") {
    html += `<div class="pgroup"><h4>改地形</h4><div class="prow">${
      TERRAIN_EDIT.map(([id, nm]) => btn({ kind: "地形", id }, nm)).join("")}</div></div>`;
    html += `<div class="pgroup"><h4>改地貌</h4><div class="prow">${
      FEATURE_EDIT.map(([id, nm]) => btn({ kind: "地貌", id }, nm)).join("")}</div></div>`;
  }
  return html;
}

function levelListHtml(): string {
  const rows = levels.map((lv) => `<tr data-lv="${esc(lv.关卡id)}">
      <td><b>${esc(lv.关卡id)}</b></td><td>${esc(lv.名称)}</td>
      <td><span class="chip">${esc(lv.关卡类别)}</span></td>
      <td>${lv.母题 === "无" ? "—" : esc(lv.母题)}</td>
      <td>${esc(rules.name(lv.文明))}</td>
      <td>${esc(goalText(lv))}</td>
      <td>配额 ${lv.约束值}</td>
      <td class="muted">贪心 ${esc(lv.贪心基线)}</td>
      <td><button class="play" data-lv="${esc(lv.关卡id)}">开始</button></td>
    </tr>`).join("");
  const warn = problems.length === 0 ? "" :
    `<div class="warn">加载校验发现 ${problems.length} 个问题：<br>${
      problems.map(esc).join("<br>")}</div>`;
  return `${warn}<table class="lvlist"><thead><tr>
    <th>关卡</th><th>名称</th><th>类别</th><th>母题</th><th>文明</th>
    <th>目标</th><th>约束</th><th>基线</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="hint">「贪心基线」是每步选当前收益最高能达到的上限。<b>普通关的基线严格低于目标值</b>——
    这是关卡有规划含量的可计算定义（关卡设计 §1）。教学关与对照关各有自己的判据。</p>`;
}

function startLevel(id: string) {
  const lv = levels.find((l) => l.关卡id === id)!;
  app.level = lv;
  app.levelStart = lv.初始局面;
  app.board = lv.初始局面;
  app.undo = [];
  app.settled = undefined;
  app.selected = undefined;
  app.focusYield = [...lv.目标.keys()][0];
  app.brush = { kind: "区域", id: PALETTE[0] };
  $("levellist").style.display = "none";
  $("play").style.display = "";
  render();
}

// ── 事件接线 ──────────────────────────────────────────────────────────
function wire() {
  $("map").querySelectorAll<SVGGElement>("g.hex").forEach((g) => {
    const p = parseKey(g.dataset.xy!);
    g.onclick = () => onClick(p);
    g.onmouseenter = () => { app.hovered = p; $("tileinfoHover").innerHTML = ""; };
  });
  document.querySelectorAll<HTMLElement>(".pb").forEach((b) => {
    b.onclick = () => { app.brush = JSON.parse(b.dataset.brush!); render(); };
  });
  document.querySelectorAll<HTMLElement>(".tot").forEach((t) => {
    t.onclick = () => { app.focusYield = t.dataset.yield!; render(); };
  });
  const civ = document.getElementById("civ") as HTMLSelectElement | null;
  if (civ) civ.onchange = () => {
    push();
    app.board = { ...app.board, 文明: civ.value || undefined };
    render();
  };
  const undo = document.getElementById("undo");
  if (undo) undo.onclick = () => {
    const prev = app.undo.pop();
    if (prev) { app.board = prev; app.settled = undefined; render(); }
  };
  const reset = document.getElementById("reset");
  if (reset) reset.onclick = () => {
    push(); app.board = sandboxBoard(); render();
  };
  const retry = document.getElementById("retry");
  if (retry) retry.onclick = () => startLevel(app.level!.关卡id);
  const tolist = document.getElementById("tolist");
  if (tolist) tolist.onclick = () => {
    app.level = undefined; app.levelStart = undefined; app.settled = undefined;
    $("levellist").style.display = "";
    $("play").style.display = "none";
  };
  document.querySelectorAll<HTMLElement>("button.play").forEach((b) => {
    b.onclick = () => startLevel(b.dataset.lv!);
  });
  document.querySelectorAll<HTMLElement>("tr[data-lv]").forEach((t) => {
    t.onclick = () => startLevel(t.dataset.lv!);
  });
}

function setMode(m: "自由" | "挑战") {
  app.mode = m;
  app.settled = undefined;
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) =>
    t.classList.toggle("on", t.dataset.mode === m));
  if (m === "自由") {
    app.level = undefined; app.levelStart = undefined;
    app.board = sandboxBoard(); app.undo = []; app.focusYield = "科技";
    $("levellist").style.display = "none";
    $("play").style.display = "";
    render();
  } else {
    $("levellist").innerHTML = levelListHtml();
    $("levellist").style.display = "";
    $("play").style.display = "none";
    wire();
  }
}

document.querySelectorAll<HTMLElement>(".tab").forEach((t) => {
  t.onclick = () => setMode(t.dataset.mode as "自由" | "挑战");
});
setMode("自由");
