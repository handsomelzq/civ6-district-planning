/** 应用层：状态、交互、两个模式的接线。
 *
 * 架构约束（GDD §7）：**模式层不得实现任何产出规则**。这里唯一碰数值的地方是
 * 「两次求值结果相减」得到悬停预览，而那两次都是 `evaluate()` 算的。
 */
import { Rules } from "../src/rules.ts";
import { TABLE_TEXTS } from "./tables.gen.js";      // 构建期生成，见 Tools/build_web.mjs
import { LEVEL_TEXTS } from "./levels.gen.js";      // 同上
import { BUILD_INFO } from "./build.gen.js";
import { PlanWorkspace } from "./workspace.ts";
import { MAX_PLAN_LENGTH } from "./plan_files.ts";
import { parseCsv } from "../src/csv.ts";
import { compareBoards } from "../src/compare.ts";
import { FEATURED_LEVELS, LESSONS, challengeStatus, challengeReview, playtestRecord } from "./challenge.ts";
import {
  evaluate, total, SUPPORTED_POLICY_IDS, SUPPORTED_BELIEF_IDS, type YieldTree,
} from "../src/evaluate.ts";
import {
  type BoardState, type Tile, withDistrict, districtPositions, inWorkRange,
  cityTerritoryOwner,
  moveCityCenter, withoutResource,
} from "../src/board.ts";
import {
  cityCenterPlacementConstraint, resourceClearanceConstraint,
} from "../src/placement.ts";
import { syncRiverBanks } from "../src/river.ts";
import {
  validateDistrictPlacement,
  type LegalityIssue,
} from "../src/legality.ts";
import { type Axial, key, parseKey, distance } from "../src/hex.ts";
import { fmt, cmp, sub, ZERO, isZero, type Rat } from "../src/rational.ts";
import {
  renderMap, renderTotals, renderBreakdown, yieldColor,
} from "./render.ts";
import {
  loadLevels, meetsGoal, starsOf, scoreOf, goalText, type Level,
} from "./levels.ts";
import { PRESETS, randomSandboxBoard, sandboxBoard, type PresetId } from "./presets.ts";
import {
  brushInfo, hillsTerrainId, formatLegalityIssue, formatResearchAlert, type InfoBrush,
} from "./brush_info.ts";
import { localIconSrc } from "./local_icons.ts";
import {
  eraName, loadProgression, prerequisiteClosure, progressionGraphLayout,
  type ProgressionData, type ProgressionNode, type TreeKind,
} from "./progression.ts";
import {
  MAP_PRESETS, MapGenerationError, generateSandboxMap, type MapGeneratorConfig,
} from "../src/map_generator.ts";
import { type MapGenerationReport } from "../src/map_report.ts";
import {
  mapConfigFromForm, mergeGeneratedBoard, renderMapGeneratorContent,
  captureMapState, restoreMapState, resetGeneratedBoard, refreshMapReport, renderMapReportSummary,
  type MapStateSnapshot,
} from "./map_generator_ui.ts";

const rules = new Rules(TABLE_TEXTS as never);
const { levels, problems } = loadLevels(rules, LEVEL_TEXTS as never);
const progression: ProgressionData = loadProgression({
  tech_tree: TABLE_TEXTS["tech_tree.csv"],
  civic_tree: TABLE_TEXTS["civic_tree.csv"],
  policy_cards: TABLE_TEXTS["policy_cards.csv"],
  religion_beliefs: TABLE_TEXTS["religion_beliefs.csv"],
});
const progressionName = (id: string): string =>
  progression.techs.get(id)?.name ?? progression.civics.get(id)?.name ?? rules.name(id);

// ── 可放置的区域调色板 ────────────────────────────────────────────────
// 只列首期用到的区域。取自 districts.csv，不硬编码名称。
const PALETTE = [
  "DISTRICT_CAMPUS", "DISTRICT_HOLY_SITE", "DISTRICT_GOVERNMENT",
  "DISTRICT_COMMERCIAL_HUB", "DISTRICT_THEATER", "DISTRICT_INDUSTRIAL_ZONE",
  "DISTRICT_ENCAMPMENT", "DISTRICT_HARBOR", "DISTRICT_AQUEDUCT",
].filter((d) => rules.districts.has(d));

const CIVS: [string, string][] = [
  ["CIVILIZATION_GERMANY", "德国 · 汉萨"],
  ["CIVILIZATION_JAPAN", "日本 · 明治维新"],
  ["CIVILIZATION_RUSSIA", "俄罗斯 · 拉夫拉"],
  ["CIVILIZATION_KOREA", "韩国 · 书院"],
];
const TERRAIN_EDIT: [string, string][] = [
  ["TERRAIN_GRASS", "草原"], ["TERRAIN_PLAINS", "平原"],
  ["TERRAIN_GRASS_MOUNTAIN", "山脉"], ["TERRAIN_COAST", "海岸"],
  ["TERRAIN_OCEAN", "海洋"], ["TERRAIN_DESERT", "沙漠"],
  ["TERRAIN_TUNDRA", "冻土"],
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
  | { kind: "地貌"; id: string }
  | { kind: "丘陵" }
  | { kind: "世界奇观"; id: string }
  | { kind: "清除资源" }
  | { kind: "城市中心" };

type App = {
  mode: "自由" | "挑战";
  board: BoardState;
  undo: MapStateSnapshot[];
  brush: Brush;
  selected?: Axial;
  hovered?: Axial;
  hoverBrush?: Brush;
  focusYield: string;
  level?: Level;
  /** 挑战模式：关卡初始局面（重试用）。 */
  levelStart?: BoardState;
  settled?: "达成" | "失败";
  preset: PresetId;
  randomSeed?: number;
  selectedCity: string;
  showDebug: boolean;
  progressionTab: "政策卡" | "宗教" | TreeKind;
  placementAlert?: { title: string; body: string };
  mapConfigDraft: MapGeneratorConfig;
  mapReport?: MapGenerationReport;
  mapGenerationError?: string;
  mapInitialBoard?: BoardState;
  mapReportBoard?: BoardState;
};

const app: App = {
  mode: "自由",
  board: sandboxBoard(),
  undo: [],
  brush: { kind: "区域", id: PALETTE[0] },
  focusYield: "科技",
  preset: "mountain", selectedCity: "A", randomSeed: undefined,
  showDebug: false,
  progressionTab: "政策卡",
  mapConfigDraft: MAP_PRESETS.balanced,
};

const workspace = new PlanWorkspace({ getItem: k => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v) }, rules,
  { techs: new Set(progression.techs.keys()), civics: new Set(progression.civics.keys()),
    improvements: new Set(parseCsv(TABLE_TEXTS["improvements.csv"]).map(r => r["改良设施id"])) }, BUILD_INFO.revision);
const restoredPlan = workspace.restore("current");
if (restoredPlan) Object.assign(app, restoreMapState(app, restoredPlan));
else {
  app.board = { ...app.board, 文明: CIVS[0][0], 领袖: rules.leadersByCiv.get(CIVS[0][0])?.[0]?.id };
  app.mapInitialBoard = app.board;
}
let freeState = restoredPlan ?? captureMapState(app);
let freeUndo: MapStateSnapshot[] = [];
let guideOpen = true;
let hintCount = 0;
let runStarted = 0;
let runRecorded = false;
let runMoves = 0;
let runUndos = 0;
const playRecords: object[] = [];
function recordRun(result: string) {
  if (!app.level || runRecorded) return;
  runRecorded = true;
  playRecords.push(playtestRecord(rules, app.level, app.board, {
    seconds: Math.max(0, Math.round((Date.now() - runStarted) / 1000)),
    hints: hintCount, undos: runUndos, moves: runMoves, result, build: BUILD_INFO.revision,
  }));
  if (playRecords.length > 100) playRecords.shift();
}

// ── 交互：放置 / 编辑 / 撤销 ──────────────────────────────────────────
/** 不可放置的原因。空字符串表示可放。规则来自求值器侧的约束，不在这里另立。 */
function placementIssues(
  b: BoardState, p: Axial, districtId: string,
): LegalityIssue[] {
  return validateDistrictPlacement(rules, b, p, districtId, {
    mode: app.mode,
    selectedCityId: app.mode === "自由" ? app.selectedCity : undefined,
    challengeBudgetRemaining: app.mode === "挑战" ? remainingBudget() : undefined,
  });
}

function blockReason(b: BoardState, p: Axial, districtId: string): string {
  const first = placementIssues(b, p, districtId)[0];
  return first ? formatLegalityIssue(first) : "";
}

function sandboxCurrent(): BoardState {
  if (app.mapInitialBoard) return app.mapInitialBoard;
  return app.randomSeed === undefined
    ? sandboxBoard(app.preset)
    : randomSandboxBoard(app.randomSeed);
}

function showPlacementAlert(issues: readonly LegalityIssue[]): void {
  if (!issues.length) return;
  app.placementAlert = {
    title: "无法建造区域",
    body: [...new Set(issues.map(formatLegalityIssue))].join("；"),
  };
  const modal = document.getElementById("placement-alert");
  if (!modal) return;
  const title = document.getElementById("placement-alert-title");
  const body = document.getElementById("placement-alert-body");
  if (title) title.textContent = app.placementAlert.title;
  if (body) body.textContent = app.placementAlert.body;
  modal.hidden = false;
}

function blockedMap(): Map<string, string> {
  const m = new Map<string, string>();
  if (app.brush.kind === "清除资源") {
    for (const k of app.board.tiles.keys()) {
      const reason = resourceClearanceConstraint(rules, app.board, parseKey(k));
      if (reason) m.set(k, reason);
    }
    return m;
  }
  if (app.brush.kind === "丘陵") {
    for (const [k, tile] of app.board.tiles) {
      if (tile.湖泊 || !hillsTerrainId(tile.地形)) {
        m.set(k, "丘陵只能设置在陆地上，不能用于海岸、湖泊或海洋");
      }
    }
    return m;
  }
  if (app.brush.kind === "城市中心") {
    for (const k of app.board.tiles.keys()) {
      const reason = cityCenterPlacementConstraint(app.board, parseKey(k), app.selectedCity);
      if (reason) m.set(k, reason);
    }
    return m;
  }
  if (app.brush.kind !== "区域") return m;
  for (const k of app.board.tiles.keys()) {
    const p = parseKey(k);
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

function push() { app.undo.push(captureMapState(app)); if (app.undo.length > 200) app.undo.shift(); }

function onClick(p: Axial) {
  if (app.settled) return;
  app.selected = p;
  const k = key(p);
  const t = app.board.tiles.get(k);
  if (!t) return;
  const b = app.brush;
  if (b.kind === "区域") {
    const issues = placementIssues(app.board, p, b.id);
    if (issues.length) { showPlacementAlert(issues); render(); return; }
    push();
    app.board = withDistrict(app.board, p, b.id, rules.removedByDistrict,
      app.mode === "自由" ? app.selectedCity : undefined);
  } else if (b.kind === "城市中心") {
    if (app.mode !== "自由") { render(); return; }
    const reason = cityCenterPlacementConstraint(app.board, p, app.selectedCity);
    if (reason) {
      const modal = document.getElementById("placement-alert");
      const title = document.getElementById("placement-alert-title");
      const body = document.getElementById("placement-alert-body");
      if (title) title.textContent = "无法移动城市中心";
      if (body) body.textContent = reason;
      if (modal) modal.hidden = false;
      render();
      return;
    }
    push();
    app.board = moveCityCenter(app.board, app.selectedCity, p);
  } else if (b.kind === "清除资源") {
    if (app.mode !== "自由") { render(); return; }
    const reason = resourceClearanceConstraint(rules, app.board, p);
    if (reason) {
      const modal = document.getElementById("placement-alert");
      const title = document.getElementById("placement-alert-title");
      const body = document.getElementById("placement-alert-body");
      if (title) title.textContent = "无法清除资源";
      if (body) body.textContent = reason;
      if (modal) modal.hidden = false;
      render();
      return;
    }
    push();
    app.board = withoutResource(app.board, p);
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
    if (b.kind === "世界奇观" && b.id && (t.区域 || t.世界奇观 ||
        !rules.buildableTerrain.has(t.地形) || !inWorkRange(app.board, p, app.selectedCity))) {
      render(); return;
    }
    if (b.kind === "世界奇观" && !b.id && !t.世界奇观) { render(); return; }
    const hillTerrain = b.kind === "丘陵" ? hillsTerrainId(t.地形) : undefined;
    if (b.kind === "丘陵" && (t.湖泊 || !hillTerrain || hillTerrain === t.地形)) {
      render(); return;
    }
    push();
    const tiles = new Map(app.board.tiles);
    if (b.kind === "地形") tiles.set(k, { ...t, 地形: b.id });
    else if (b.kind === "丘陵") tiles.set(k, { ...t, 地形: hillTerrain! });
    else if (b.kind === "地貌") tiles.set(k, { ...t, 地貌: b.id || undefined });
    else if (b.kind === "世界奇观") tiles.set(k, { ...t, 世界奇观: b.id || undefined });
    app.board = { ...app.board, tiles };
    if (b.kind === "地形" || b.kind === "丘陵") app.board = syncRiverBanks(app.board);
  }
  if (app.mode === "挑战") runMoves++;
  checkSettlement();
  render();
}

function checkSettlement() {
  if (app.mode !== "挑战" || !app.level || app.settled) return;
  const status = challengeStatus(rules, app.level, app.board, PALETTE);
  if (status.terminal) app.settled = status.passed ? "达成" : "失败";
}

// ── 预览：两次求值之差 ────────────────────────────────────────────────
function previewMap(tree: YieldTree): Map<string, Rat> {
  const out = new Map<string, Rat>();
  if (app.brush.kind !== "区域" || app.settled) return out;
  const before = total(tree, app.focusYield);
  for (const k of app.board.tiles.keys()) {
    const p = parseKey(k);
    if (blockReason(app.board, p, app.brush.id)) continue;
    const after = total(
      evaluate(rules, withDistrict(app.board, p, app.brush.id, rules.removedByDistrict,
        app.mode === "自由" ? app.selectedCity : undefined)),
      app.focusYield);
    out.set(k, sub(after, before));
  }
  return out;
}

// ── 渲染 ──────────────────────────────────────────────────────────────
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function render() {
  if (app.mode === "自由" && app.mapReport && app.mapReportBoard !== app.board) {
    app.mapReport = refreshMapReport(rules, app.board, app.mapReport);
    app.mapReportBoard = app.board;
  }
  const reportSummary = document.getElementById("map-generation-summary");
  if (reportSummary) {
    reportSummary.hidden = app.mode !== "自由" || !app.mapReport;
    reportSummary.innerHTML = app.mapReport ? renderMapReportSummary(app.mapReport) : "";
  }
  const tree = evaluate(rules, app.board);
  $("map").classList.toggle("multi", app.mode === "自由" && (app.board.城市?.length ?? 0) > 1);
  $("map").innerHTML = renderMap(rules, app.board, {
    selected: app.selected, hovered: app.hovered,
    preview: previewMap(tree), 预览产出: app.focusYield,
    blocked: blockedMap(), selectedCity: app.mode === "自由" ? app.selectedCity : undefined,
  });
  $("totals").innerHTML = renderTotals(tree, app.focusYield);
  $("citytotals").innerHTML = app.mode === "自由" ? cityTotals(tree) : "";
  $("breakdown").innerHTML = renderBreakdown(tree, undefined, app.showDebug);
  $("tileinfo").innerHTML = tileInfo();
  $("impact").innerHTML = impactHtml();
  $("quick-guide").innerHTML = `<button id="guide-toggle" aria-expanded="${guideOpen}">${guideOpen ? "收起引导" : "操作引导"}</button>${guideOpen
    ? `<p>① 观察地形与城市边界　② 选区域、悬停比较收益　③ 放置后查看收益来源　④ 撤销调整，在「方案」中比较 A/B</p>` : ""}`;
  $("modebar").innerHTML = modeBar(tree);
  $("palette").innerHTML = paletteHtml();
  showBrushInfo(app.hoverBrush ?? app.brush);
  $("diag").innerHTML = tree.诊断.length === 0 ? "" :
    tree.诊断.map((d) => `<div class="warn">⚠ ${esc(d.说明)}</div>`).join("");
  const mapGenerator = document.getElementById("map-generator");
  if (mapGenerator) mapGenerator.hidden = app.mode !== "自由";
  $("plans").hidden = app.mode !== "自由";
  for (const id of ["policies", "religion", "tech-tree", "civic-tree"]) $(id).hidden = app.mode !== "自由";
  if (app.mode === "自由") {
    freeState = captureMapState(app); workspace.update(freeState);
    $("save-status").textContent = workspace.status;
  } else $("save-status").textContent = "挑战不覆盖自由局面 · 试玩记录仅在本次窗口";
  if (app.settled) recordRun(app.settled);
  wire();
}

function showBrushInfo(brush: InfoBrush) {
  const info = brushInfo(brush, rules, app.board.文明, TABLE_TEXTS);
  $("brushinfo").innerHTML = `<b>${esc(info.title)}</b>${info.lines.map((line) =>
    `<div>${esc(line)}</div>`).join("")}`;
}

function removalButton(brush: Brush, label: string): string {
  const on = JSON.stringify(app.brush) === JSON.stringify(brush);
  return `<button class="tool-button ${on ? "on" : ""}" data-brush='${JSON.stringify(brush)}'
    aria-pressed="${on}">${label}</button>`;
}

function tileInfo(): string {
  const p = app.hovered ?? app.selected;
  if (!p) return `<span class="muted">悬停或点击格子看它的属性</span>`;
  const t = app.board.tiles.get(key(p));
  if (!t) return "";
  const bits = [`地形 ${esc(rules.name(t.地形))}`];
  if (t.地貌) bits.push(`地貌 ${esc(rules.name(t.地貌))}`);
  if (t.资源) bits.push(`资源 ${esc(rules.name(t.资源))}`);
  const territory = cityTerritoryOwner(app.board, p);
  if (territory) bits.push(`领土 ${esc(app.board.城市?.find((c) => c.id === territory)?.名称 ?? territory)}`);
  else if (app.board.城市?.length) bits.push("中立地块 · 不属于任何城市");
  if (t.世界奇观) bits.push(`世界奇观 ${esc(t.世界奇观)}`);
  if (t.河流边) bits.push("临河");
  if (t.湖泊) bits.push("湖泊");
  if (t.区域) {
    const did = rules.effective(t.区域, app.board.文明);
    bits.push(`区域 ${esc(rules.name(did))}`);
    if (did !== t.区域) bits.push(`（替换了 ${esc(rules.name(t.区域))}）`);
  }
  return `(${p.q},${p.r})　` + bits.join("　·　");
}

function modeBar(tree: YieldTree): string {
  if (app.mode === "自由") {
    const opts = CIVS.map(([id, nm]) =>
      `<option value="${id}" ${app.board.文明 === id ? "selected" : ""}>${esc(nm)}</option>`).join("");
    const leaders = rules.leadersByCiv.get(app.board.文明 ?? "") ?? [];
    const leaderOpts = leaders.map((l) =>
      `<option value="${esc(l.id)}" ${app.board.领袖 === l.id ? "selected" : ""}>${esc(l.名称)}</option>`).join("");
    const cityOpts = (app.board.城市 ?? []).map((c) =>
      `<option value="${c.id}" ${app.selectedCity === c.id ? "selected" : ""}>${esc(c.名称)}</option>`).join("");
    const civAbility = rules.civAbility.get(app.board.文明 ?? "") ?? "";
    return `${app.randomSeed === undefined ? "" : `<span class="civ-ability">种子 ${app.randomSeed}</span>`}
      <label>当前建设城市 <select id="city">${cityOpts}</select></label>
      <label>文明 <select id="civ">${opts}</select></label>
      <label>领袖 <select id="leader">${leaderOpts}</select></label>
      <button id="undo" ${app.undo.length ? "" : "disabled"}>撤销（${app.undo.length}）</button>
      <button id="reset">重置</button>
      <span class="civ-ability"><b>${esc(rules.name(app.board.文明 ?? ""))}</b> · ${esc(civAbility)}</span>`;
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
    </div>${bars}<div class="tool-group">设置 ${removalButton({ kind: "移除" }, "移除区域")}</div>${settleHtml(tree)}`;
}

function cityTotals(tree: YieldTree): string {
  return (app.board.城市 ?? []).map((c) => {
    const ys = tree.城市合计.get(c.id) ?? new Map();
    const values = [...ys].filter(([, n]) => !isZero(n))
      .map(([y, n]) => `${esc(y)} ${fmt(n)}`).join(" · ") || "暂无区域产出";
    return `<div class="citysum ${app.selectedCity === c.id ? "active" : ""}" data-city="${c.id}">
      <b>${esc(c.名称)}</b><span>${values}</span></div>`;
  }).join("");
}

function settleHtml(tree: YieldTree): string {
  const lesson = LESSONS[app.level!.关卡id];
  const hints = lesson ? `<div class="lesson"><b>${esc(lesson.title)}</b>
    ${lesson.hints.slice(0, hintCount).map((h,i) => `<p>提示 ${i+1}：${esc(h)}</p>`).join("")}
    <button id="next-hint" ${hintCount >= lesson.hints.length ? "disabled" : ""}>${hintCount ? "再给一点提示" : "需要提示"}</button></div>` : "";
  if (!app.settled) return `${hints}<div class="lvfoot">
      ${meetsGoal(app.level!, tree.合计) ? `<span>已达标，可继续冲三星</span><button id="finish-level">按当前成绩结算</button>` : ""}
      <button id="undo" ${app.undo.length ? "" : "disabled"}>撤销</button>
      <button id="retry">重试</button>
      <button id="tolist">返回关卡表</button>
    </div>`;
  const lv = app.level!;
  const stars = starsOf(lv, tree.合计);
  const s = scoreOf(lv, tree.合计);
  const review = challengeReview(rules, lv, app.board);
  const comparison = compareBoards(rules, lv.初始局面, app.board);
  const reason = challengeStatus(rules, lv, app.board, PALETTE).reason;
  return `<div class="settle ${app.settled === "达成" ? "win" : "lose"}">
    <div class="stitle">${app.settled === "达成" ? "关卡达成" : "本次未达成"}</div>
    <div class="stars">${"★".repeat(stars)}${"☆".repeat(3 - stars)}</div>
    <table class="sgrid">
      <tr><td>目标</td><td>${esc(goalText(lv))}</td></tr>
      <tr><td>你的产出合计</td><td><b>${fmt(s)}</b></td></tr>
      <tr><td>二星 / 三星</td><td>${fmt(lv.二星阈值)} / ${fmt(lv.三星阈值)}</td></tr>
    </table>
    <p>${esc(reason)} · 距三星合计差 ${fmt(review.gap)}${review.goals.some(g => !g.passed) ? "（仍需逐项达标）" : ""}</p>
    <p>${esc(lesson?.review ?? "比较各个区域的贡献，尝试用不同的放置顺序改进。")}</p>
    <p>${[...lv.目标].map(([y,v]) => `${esc(y)}：${fmt(tree.合计.get(y) ?? ZERO)} / ${fmt(v)}`).join(" · ")}</p>
    <details><summary>关键落位带来的贡献变化</summary>${changesHtml(comparison)}</details>
    <details><summary>查看本次布局的收益来源</summary>${renderBreakdown(tree, undefined, false)}</details>
    <div class="lvfoot"><button id="continue-level">继续调整（不重复记录本次成绩）</button><button id="retry">重试</button>
      <button id="export-playtest">导出试玩记录</button>
      <button id="tolist">返回关卡表</button></div></div>`;
}

function paletteHtml(): string {
  const btn = (b: Brush, label: string, sub = "") => {
    const on = JSON.stringify(app.brush) === JSON.stringify(b);
    const id = b.kind === "区域" ? rules.effective(b.id, app.board.文明) :
      b.kind === "丘陵" ? "TERRAIN_GRASS_HILLS" :
      b.kind === "城市中心" ? "DISTRICT_CITY_CENTER" :
      b.kind === "清除资源" ? "RESOURCE_STONE" :
      b.kind === "移除" ? "" : b.id;
    const icon = localIconSrc(id);
    return `<button class="pb ${on ? "on" : ""}" data-brush='${JSON.stringify(b)}'>
      ${icon ? `<img class="pb-icon" src="${icon}" alt="" onerror="this.hidden=true">` : ""}
      <span>${esc(label)}${sub ? `<i>${esc(sub)}</i>` : ""}</span></button>`;
  };
  const districts = PALETTE.map((d) => {
    const eff = rules.effective(d, app.board.文明);
    const nm = rules.name(eff);
    return btn({ kind: "区域", id: d }, nm,
      eff !== d ? `替换 ${rules.name(d)}` : "");
  }).join("");
  let html = `<div class="pgroup"><h4>放置区域</h4><div class="prow">${districts}</div></div>`;
  if (app.mode === "自由") {
    html += `<div class="pgroup"><h4>城市编辑</h4><div class="prow">${
      btn({ kind: "城市中心" }, "移动城市中心", "当前城市")}</div></div>`;
    html += `<div class="pgroup"><h4>改地形</h4><div class="prow">${
      TERRAIN_EDIT.map(([id, nm]) => btn({ kind: "地形", id }, nm)).join("") +
      btn({ kind: "丘陵" }, "丘陵")}</div></div>`;
    html += `<div class="pgroup"><h4>改地貌</h4><div class="prow">${
      FEATURE_EDIT.map(([id, nm]) => btn({ kind: "地貌", id }, nm)).join("")}</div></div>`;
    html += `<div class="pgroup"><h4>世界奇观</h4><div class="prow">${btn({ kind: "世界奇观", id: "BUILDING_PYRAMIDS" }, "金字塔")}</div></div>`;
  }
  return `<div class="palette-items">${html}</div><div id="brushinfo" class="brush-info" aria-live="polite"></div>`;
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
      <td>${lv.可开始
        ? `<button class="play" data-lv="${esc(lv.关卡id)}">开始</button>`
        : `<button class="play" data-lv="${esc(lv.关卡id)}" disabled title="${esc(lv.问题.join("；"))}">不可开始</button>
           <small class="muted">${esc(lv.问题[0] ?? "关卡校验失败")}</small>`}</td>
    </tr>`).join("");
  const warn = problems.length === 0 ? "" :
    `<div class="warn">加载校验发现 ${problems.length} 个问题：<br>${
      problems.map(esc).join("<br>")}</div>`;
  const featured = FEATURED_LEVELS.map((id,i) => {
    const lv = levels.find(l => l.关卡id === id);
    return lv ? `<button class="play route-card" data-lv="${id}" ${lv.可开始 ? "" : "disabled"}>
      <small>0${i+1} / ${id}</small><b>${esc(LESSONS[id].title)}</b><span>${esc(goalText(lv))}</span></button>` : "";
  }).join("");
  return `${warn}<h2>从读图到多目标规划</h2><p>推荐按顺序体验这五关；第三、四关对照文明差异。</p><div class="level-route">${featured}</div>
    <button id="export-playtest">导出本次窗口试玩记录</button><details><summary>全部关卡与设计指标</summary><table class="lvlist"><thead><tr>
    <th>关卡</th><th>名称</th><th>类别</th><th>母题</th><th>文明</th>
    <th>目标</th><th>约束</th><th>基线</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="hint">「贪心基线」是每步选当前收益最高能达到的上限。<b>普通关的基线严格低于目标值</b>——
    这是关卡有规划含量的可计算定义（关卡设计 §1）。教学关与对照关各有自己的判据。</p></details>`;
}

function startLevel(id: string) {
  const lv = levels.find((l) => l.关卡id === id);
  if (!lv || !lv.可开始) return;
  recordRun("重试或切换关卡");
  app.level = lv;
  app.randomSeed = undefined;
  app.levelStart = lv.初始局面;
  app.board = lv.初始局面;
  app.undo = [];
  app.settled = undefined;
  hintCount = 0; runStarted = Date.now(); runRecorded = false; runMoves = 0; runUndos = 0;
  app.selected = undefined;
  app.focusYield = [...lv.目标.keys()][0];
  app.brush = { kind: "区域", id: PALETTE[0] };
  $("levellist").style.display = "none";
  $("play").style.display = "";
  render();
}

function settingsHtml(): string {
  return `<div class="settings-grid">
    <section class="settings-card">
      <span class="settings-kicker">工具</span>
      <h3>编辑工具</h3>
      <p>编辑工具只影响当前沙盒布局。</p>
      <div class="settings-actions">
        ${removalButton({ kind: "移除" }, "移除区域")}
        ${removalButton({ kind: "世界奇观", id: "" }, "移除奇观")}
        ${removalButton({ kind: "清除资源" }, "清除加成资源")}
      </div>
    </section>
    <section class="settings-card">
      <span class="settings-kicker">显示</span>
      <h3>信息密度</h3>
      <label class="switch-row"><input id="show-rules" type="checkbox" ${app.showDebug ? "checked" : ""}>
        <span>显示规则编号</span><small>用于核对配置表</small></label>
    </section>
    <section class="settings-card">
      <span class="settings-kicker">资料</span>
      <h3>规则来源</h3>
      <a href="https://github.com/handsomelzq/civ6-district-planning/tree/main/设计" target="_blank" rel="noreferrer">打开拆解文档 ↗</a>
      <a href="https://github.com/handsomelzq/civ6-district-planning/blob/main/README.md" target="_blank" rel="noreferrer">项目说明 ↗</a>
    </section>
  </div>`;
}

function progressionNodeButton(kind: TreeKind, node: ProgressionNode): string {
  const unlocked = kind === "科技"
    ? app.board.已解锁科技.has(node.id)
    : app.board.已解锁市政.has(node.id);
  const icon = kind === "科技"
    ? (node.focus ? "DISTRICT_CAMPUS" : "BUILDING_GREAT_LIBRARY")
    : (node.focus ? "DISTRICT_GOVERNMENT" : "BUILDING_FORBIDDEN_CITY");
  return `<button class="progression-node ${node.focus ? "focus" : ""} ${unlocked ? "unlocked" : ""}"
      data-progression-kind="${kind}" data-progression-id="${esc(node.id)}"
      title="${esc(node.functionText)}${node.unlocks.length ? `｜解锁：${node.unlocks.join("；")}` : ""}">
      <span class="node-top"><i class="node-era">${esc(eraName(node.era))}</i><b>${unlocked ? "已解锁" : `成本 ${esc(node.cost)}`}</b></span>
      <span class="node-title"><img class="node-icon" src="${localIconSrc(icon)}" alt=""><strong>${esc(node.name)}</strong></span>
      <span class="node-bottom">${node.focus ? "区域规划重点" : node.prereqs.length ? `前置 ${node.prereqs.length}` : "起始节点"}</span>
    </button>`;
}

function progressionTree(kind: TreeKind, nodes: ReadonlyMap<string, ProgressionNode>): string {
  const positions = progressionGraphLayout(nodes);
  const columns = [...nodes.values()].sort((a, b) =>
    (positions.get(a.id)?.column ?? 0) - (positions.get(b.id)?.column ?? 0)
    || (positions.get(a.id)?.row ?? 0) - (positions.get(b.id)?.row ?? 0)
    || a.name.localeCompare(b.name, "zh-CN"));
  const nodeW = 214, nodeH = 34, right = 78;
  const maxColumn = Math.max(...[...positions.values()].map((point) => point.column), 0);
  const maxRow = Math.max(...[...positions.values()].map((point) => point.row), 0);
  const width = Math.max(980, 52 + maxColumn * 288 + nodeW + right);
  const height = Math.max(520, 46 + maxRow * 38 + nodeH + 22);
  const lines: string[] = [];
  for (const node of columns) {
    const to = positions.get(node.id)!;
    for (const parent of node.prereqs) {
      const from = positions.get(parent);
      if (!from) continue;
      const x1 = from.x + nodeW, y1 = from.y + nodeH / 2;
      const x2 = to.x, y2 = to.y + nodeH / 2;
      const bend = (x1 + x2) / 2;
      const parentUnlocked = kind === "科技"
        ? app.board.已解锁科技.has(parent)
        : app.board.已解锁市政.has(parent);
      lines.push(`<path class="tree-branch ${node.focus ? "focus" : ""} ${parentUnlocked ? "unlocked" : ""}" d="M${x1},${y1} C${bend},${y1} ${bend},${y2} ${x2},${y2}"/>`);
    }
  }
  const layers = Array.from({ length: maxColumn + 1 }, (_, column) =>
    `<div class="tree-layer" style="left:${52 + column * 288}px">研究层 ${String(column + 1).padStart(2, "0")}</div>`).join("");
  const cards = columns.map((node) => {
    const p = positions.get(node.id)!;
    return `<div class="tree-node-wrap" style="left:${p.x}px;top:${p.y}px;width:${nodeW}px">${
      progressionNodeButton(kind, node)}</div>`;
  }).join("");
  return `<div class="tree-canvas ${kind === "科技" ? "science-tree" : "civic-tree"}" style="width:${width}px;height:${height}px">${layers}<svg aria-hidden="true" viewBox="0 0 ${width} ${height}">${lines.join("")}</svg>${cards}</div>`;
}

function progressionHoverHtml(kind: TreeKind, node?: ProgressionNode): string {
  if (!node) return `<b>悬停查看节点</b><p>将鼠标移到任一${kind}节点上，查看其功能、前置条件和解锁内容。</p>
    <small>点击节点会自动补全并解锁通往该节点的前置链。</small>`;
  const prereqs = node.prereqs.map(progressionName);
  return `<b>${esc(node.name)}</b><p>${esc(node.functionText)}</p>
    <small>${prereqs.length ? `前置：${esc(prereqs.join("、"))}` : "无前置节点"}${node.unlocks.length
      ? `　｜　解锁：${esc(node.unlocks.join("；"))}` : ""}</small>`;
}

function progressionHtml(): string {
  if (app.progressionTab === "政策卡") {
    const active = app.board.已装配政策;
    const slots = Array.from({ length: 3 }, (_, index) => {
      const id = [...active][index];
      const policy = progression.policies.find((p) => p.id === id);
      return `<div class="policy-equipped ${policy ? "filled" : ""}">
        <span>政策槽 ${index + 1}</span><b>${policy ? esc(policy.name) : "空闲"}</b>
        ${policy ? `<button data-policy-remove="${esc(policy.id)}" aria-label="卸下${esc(policy.name)}">×</button>` : ""}
      </div>`;
    }).join("");
    const cards = progression.policies.filter((p) => SUPPORTED_POLICY_IDS.has(p.id)).map((p) => {
      const on = active.has(p.id);
      const icon = p.id === "POLICY_NATURAL_PHILOSOPHY" ? "DISTRICT_CAMPUS"
        : p.id === "POLICY_SCRIPTURE" ? "DISTRICT_HOLY_SITE"
        : p.id === "POLICY_AESTHETICS" ? "DISTRICT_THEATER"
        : p.id === "POLICY_CRAFTSMEN" ? "DISTRICT_INDUSTRIAL_ZONE"
        : "DISTRICT_CITY_CENTER";
      return `<button class="policy-card ${on ? "on" : ""}" data-policy-id="${p.id}">
        <span class="policy-card-head"><img class="policy-icon" src="${localIconSrc(icon)}" alt=""><span class="policy-slot">${esc(p.slot)}</span></span>
        <strong>${esc(p.name)}</strong><small>${esc(p.tag)}</small>
        <p>${esc(p.functionText)}</p>
        <em>前置市政：${esc(progressionName(p.prereqCivic))}</em>
        <b class="policy-state">${on ? "已装配" : "加入政策栏"}</b>
      </button>`;
    }).join("");
    return `<div class="policy-slots">${slots}</div>
      <div class="progression-summary"><b>已装配 ${active.size} / 3</b>
      <span>卡面规则来自游戏本体；装配后立即计入当前局面。</span></div>
      <div class="policy-grid">${cards}</div>`;
  }
  if (app.progressionTab === "宗教") {
    const active = app.board.已选宗教信条 ?? new Set<string>();
    const grouped = new Map<string, typeof progression.beliefs>();
    for (const belief of progression.beliefs.filter((b) => SUPPORTED_BELIEF_IDS.has(b.id))) {
      grouped.set(belief.beliefClass, [...(grouped.get(belief.beliefClass) ?? []), belief]);
    }
    return `<div class="progression-summary"><b>已选择 ${active.size} 项信条</b>
      <span>不模拟城市宗教归属；选中后效果直接作用于当前规划局面。</span></div>
      <div class="belief-groups">${[...grouped].map(([beliefClass, beliefs]) =>
        `<section class="belief-group"><h3>${esc(beliefClass)}</h3><div class="belief-grid">${beliefs.map((belief) => {
          const on = active.has(belief.id);
          return `<button class="policy-card belief-card ${on ? "on" : ""}" data-belief-id="${belief.id}">
            <span class="policy-card-head"><img class="policy-icon" src="${localIconSrc("DISTRICT_HOLY_SITE")}" alt=""><span class="policy-slot">${esc(belief.beliefClass)}</span></span><strong>${esc(belief.name)}</strong>
            <p>${esc(belief.functionText)}</p><b class="policy-state">${on ? "已采用" : "选择信条"}</b>
          </button>`;
        }).join("")}</div></section>`).join("")}</div>`;
  }
  const nodes = app.progressionTab === "科技" ? progression.techs : progression.civics;
  const unlocked = app.progressionTab === "科技"
    ? app.board.已解锁科技.size : app.board.已解锁市政.size;
  return `<div class="progression-summary"><b>${app.progressionTab} ${unlocked} / ${nodes.size}</b>
    <span>点击节点自动解锁完整前置链；悬停查看具体功能。</span>
    <span class="focus-legend">金色节点 = 区域规划相关</span></div>
    <div id="progression-hover" class="progression-hover" aria-live="polite">${progressionHoverHtml(app.progressionTab)}</div>
    <div class="tree-board">${progressionTree(app.progressionTab, nodes)}</div>`;
}

function renderProgression() {
  $("progression-content").innerHTML = progressionHtml();
}

function openProgression(tab: "政策卡" | "宗教" | TreeKind = app.progressionTab) {
  if (app.mode !== "自由") return;
  app.progressionTab = tab;
  $("progression-title").textContent = tab === "政策卡" ? "政策" : tab === "宗教" ? "宗教" : `${tab}树`;
  renderProgression();
  $("progression-modal").hidden = false;
  wire();
}

function selectProgressionNode(kind: TreeKind, id: string) {
  if (app.mode !== "自由") return;
  push();
  if (kind === "科技") {
    const next = new Set(app.board.已解锁科技);
    for (const item of prerequisiteClosure(progression.techs, id)) next.add(item);
    app.board = { ...app.board, 已解锁科技: next };
  } else {
    const next = new Set(app.board.已解锁市政);
    for (const item of prerequisiteClosure(progression.civics, id)) next.add(item);
    app.board = { ...app.board, 已解锁市政: next };
  }
  render();
  renderProgression();
  wire();
}

function togglePolicy(id: string) {
  if (app.mode !== "自由") return;
  push();
  const next = new Set(app.board.已装配政策);
  if (next.has(id)) next.delete(id);
  else if (next.size < 3) next.add(id);
  app.board = { ...app.board, 已装配政策: next };
  render();
  renderProgression();
  wire();
}

function toggleBelief(id: string) {
  if (app.mode !== "自由") return;
  push();
  const selected = new Set(app.board.已选宗教信条 ?? []);
  const belief = progression.beliefs.find((item) => item.id === id);
  if (!belief) return;
  if (selected.has(id)) selected.delete(id);
  else {
    // 文明 VI 每种信条类别在一个宗教中至多选择一项；选择同类新项时替换旧项。
    for (const other of progression.beliefs) {
      if (other.beliefClass === belief.beliefClass) selected.delete(other.id);
    }
    selected.add(id);
  }
  app.board = { ...app.board, 已选宗教信条: selected };
  render();
  renderProgression();
  wire();
}

function enterMode(mode: "自由" | "挑战") {
  $("home-screen").hidden = true;
  $("app-shell").hidden = false;
  setMode(mode);
}

function openSettings() {
  $("settings-content").innerHTML = settingsHtml();
  $("settings-modal").hidden = false;
  wire();
}

function renderMapGeneratorModal(): void {
  $("map-generator-content").innerHTML = renderMapGeneratorContent(
    app.mapConfigDraft, app.mapReport, app.mapGenerationError,
  );
}

function openMapGenerator(): void {
  if (app.mode !== "自由") return;
  renderMapGeneratorModal();
  $("map-generator-modal").hidden = false;
  wire();
}

function leaveApp() {
  if (app.mode === "挑战") recordRun("返回入口");
  closePlans();
  $("settings-modal").hidden = true;
  $("map-generator-modal").hidden = true;
  $("progression-modal").hidden = true;
  $("app-shell").hidden = true;
  $("home-screen").hidden = false;
}

// 方案比较与放置预览均复用同一求值器，不复制规则。
const signed = (v: Rat) => `${cmp(v, ZERO) > 0 ? "+" : ""}${fmt(v)}`;
const deltaText = (values: ReadonlyMap<string, Rat>) => [...values].filter(([,v]) => !isZero(v))
  .map(([y,v]) => `${esc(y)} ${signed(v)}`).join(" · ") || "无净变化";
function changesHtml(comparison: ReturnType<typeof compareBoards>, target?: string): string {
  return comparison.changes.map(c => `<div class="change-row"><b>${esc(c.source)}${c.position ? ` @ ${esc(c.position)}` : ""}
    ${target ? c.position === target ? "（本格）" : "（已有区域）" : ""}</b>
    <span>${esc(c.yield)} ${signed(c.delta)} <small>(${fmt(c.before)} → ${fmt(c.after)})</small></span>
    <small>${esc(c.explanation)}</small>${app.showDebug ? `<code>${esc(c.rule)}</code>` : ""}</div>`).join("");
}
function impactHtml(): string {
  const p = app.hovered ?? app.selected;
  if (!p || app.brush.kind !== "区域" || app.settled) return `<small>选择区域并悬停地块，查看放置前后的变化。</small>`;
  const issues = placementIssues(app.board, p, app.brush.id);
  if (issues.length) return `<b>此处不可放置</b>${[...new Set(issues.map(formatLegalityIssue))].map(s => `<p>${esc(s)}</p>`).join("")}`;
  const after = withDistrict(app.board, p, app.brush.id, rules.removedByDistrict,
    app.mode === "自由" ? app.selectedCity : undefined);
  const comparison = compareBoards(rules, app.board, after);
  return `<b>放置后：${deltaText(comparison.delta)}</b>
    ${comparison.cities.filter(c => [...c.delta.values()].some(v => !isZero(v)))
      .map(c => `<p>${esc(c.name)}：${deltaText(c.delta)}</p>`).join("")}
    ${changesHtml(comparison, key(p)) || "<p>此处没有产出变化。</p>"}`;
}
function downloadJson(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let planMessage = "";
let planFocus: HTMLElement | null = null;
let planPending: (() => void) | undefined;
let planQuestion = "";
function closePlans() { $("plans-modal").hidden = true; planPending = undefined; planFocus?.focus(); }
function applyPlan(state: MapStateSnapshot) {
  push(); Object.assign(app, restoreMapState(app, state));
  app.mapReportBoard = undefined; app.selected = app.hovered = undefined;
  app.settled = undefined; render();
}
function renderPlans() {
  $("plans-content").innerHTML = `<p role="status">${esc(planMessage || workspace.status)}</p>
    <div class="plan-slots">${(["A", "B"] as const).map(id => `<section class="settings-card"><span class="settings-kicker">方案 ${id}</span>
      <h3>${workspace.saved[id] ? "已保存快照" : "空方案"}</h3><button data-save-plan="${id}">${workspace.saved[id] ? "覆盖为当前局面" : "保存当前局面"}</button>
      <button data-load-plan="${id}" ${workspace.saved[id] ? "" : "disabled"}>载入 ${id}</button></section>`).join("")}</div>
    <div class="lvfoot"><button id="export-plan">导出当前 JSON</button>
      <label class="import-plan">导入 JSON <input id="import-plan" type="file" accept=".json,application/json"></label>
      <button id="compare-plans" ${workspace.saved.A && workspace.saved.B ? "" : "disabled"}>比较 A → B</button></div>
    <small>完整保存地图、城市、区域、建筑、研究、政策、宗教和生成模板。撤销历史不导出；A/B 不随自动保存改变。</small>
    ${planPending ? `<div class="plan-confirm" role="alert"><p>${esc(planQuestion)}</p><button id="plan-confirm">确认</button><button id="plan-cancel">取消</button></div>` : ""}
    <div id="plan-comparison"></div>`;
  const confirm = (question: string, action: () => void) => { planQuestion = question; planPending = action; renderPlans(); $("plan-cancel").focus(); };
  document.querySelectorAll<HTMLElement>("[data-save-plan]").forEach(b => b.onclick = () => {
    const id = b.dataset.savePlan as "A" | "B";
    const save = () => {
      try { workspace.saveSlot(id, captureMapState(app)); planMessage = `方案 ${id} 已更新。${workspace.status}`; }
      catch (e) { planMessage = `保存失败，原快照未修改：${(e as Error).message}`; }
      renderPlans();
    };
    if (workspace.saved[id]) confirm(`覆盖方案 ${id}？原快照将被替换。`, save); else save();
  });
  document.querySelectorAll<HTMLElement>("[data-load-plan]").forEach(b => b.onclick = () => {
    const state = workspace.restore(b.dataset.loadPlan as "A" | "B");
    if (state) confirm("载入将替换当前局面，可用撤销恢复。", () => { applyPlan(state); planMessage = "已载入，可关闭窗口继续规划。"; renderPlans(); });
  });
  const yes = document.getElementById("plan-confirm");
  if (yes) yes.onclick = () => { const action = planPending; planPending = undefined; action?.(); };
  const no = document.getElementById("plan-cancel");
  if (no) no.onclick = () => { planPending = undefined; renderPlans(); };
  $("export-plan").onclick = () => {
    try { downloadJson("civ6-plan.json", workspace.encode(captureMapState(app))); }
    catch (e) { planMessage = `导出失败：${(e as Error).message}`; renderPlans(); }
  };
  ($("import-plan") as HTMLInputElement).onchange = async event => {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
    try {
      if (file.size > MAX_PLAN_LENGTH) throw new Error("存档超过 2 MB，请选择本工具导出的存档");
      const state = workspace.parse(await file.text());
      if (app.mode !== "自由" || $("plans-modal").hidden) return;
      confirm("文件校验通过。导入将替换当前局面，可撤销。", () => { applyPlan(state); planMessage = "导入成功。"; renderPlans(); });
    } catch (e) { planMessage = `导入失败，当前局面未修改：${(e as Error).message}`; renderPlans(); }
  };
  $("compare-plans").onclick = () => {
    const a = workspace.restore("A"), b = workspace.restore("B"); if (!a || !b) return;
    const c = compareBoards(rules, a.board, b.board);
    $("plan-comparison").innerHTML = `<h3>A → B：${deltaText(c.delta)}</h3>
      <p>${c.sameGeography ? "同一地图结构，可以比较布局与文明体系差异。" : "地图或城市结构不同；差值同时包含环境变化，不是纯布局对照。"}</p>
      ${c.cities.map(city => `<p>${esc(city.name)}：${deltaText(city.delta)}</p>`).join("")}
      <h4>非零贡献变化</h4>${changesHtml(c) || "<p>没有产出贡献变化。</p>"}`;
  };
}
$("plans").onclick = () => {
  if (app.mode !== "自由") return;
  planFocus = document.activeElement as HTMLElement; planMessage = ""; planPending = undefined;
  renderPlans(); $("plans-modal").hidden = false; $("plans-close").focus();
};
$("plans-close").onclick = closePlans;
$("plans-modal").onclick = e => { if (e.target === $("plans-modal")) closePlans(); };
document.addEventListener("keydown", e => {
  if ($("plans-modal").hidden) return;
  if (e.key === "Escape") { e.preventDefault(); closePlans(); }
  if (e.key === "Tab") {
    const items = [...$("plans-modal").querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),[tabindex='0']")];
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
});

// ── 事件接线 ──────────────────────────────────────────────────────────
function wire() {
  const guide = document.getElementById("guide-toggle");
  if (guide) guide.onclick = () => { guideOpen = !guideOpen; render(); };
  const hint = document.getElementById("next-hint");
  if (hint) hint.onclick = () => { hintCount++; render(); };
  const finish = document.getElementById("finish-level");
  if (finish) finish.onclick = () => { app.settled = "达成"; render(); };
  const resume = document.getElementById("continue-level");
  if (resume) resume.onclick = () => { app.settled = undefined; render(); };
  const exportPlay = document.getElementById("export-playtest");
  if (exportPlay) exportPlay.onclick = () => downloadJson("civ6-playtest.json", JSON.stringify({
    format: "civ6-local-playtest", version: 1, build: BUILD_INFO, records: playRecords }, null, 2));
  const treeBoard = document.querySelector<HTMLElement>(".tree-board");
  if (treeBoard) {
    let dragging = false;
    let startX = 0;
    let startScrollLeft = 0;
    treeBoard.onpointerdown = (event) => {
      // 节点本身保留点击研究功能；从画布空白区按下才启动平移。
      if (event.button !== 0 || (event.target as HTMLElement).closest(".progression-node")) return;
      dragging = true;
      startX = event.clientX;
      startScrollLeft = treeBoard.scrollLeft;
      treeBoard.classList.add("dragging");
      treeBoard.setPointerCapture(event.pointerId);
    };
    treeBoard.onpointermove = (event) => {
      if (!dragging) return;
      treeBoard.scrollLeft = startScrollLeft - (event.clientX - startX);
    };
    const stopDragging = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      treeBoard.classList.remove("dragging");
      if (treeBoard.hasPointerCapture(event.pointerId)) treeBoard.releasePointerCapture(event.pointerId);
    };
    treeBoard.onpointerup = stopDragging;
    treeBoard.onpointercancel = stopDragging;
    treeBoard.onpointerleave = (event) => {
      if (dragging && !treeBoard.hasPointerCapture(event.pointerId)) stopDragging(event);
    };
  }
  $("map").querySelectorAll<SVGGElement>("g.hex").forEach((g) => {
    const p = parseKey(g.dataset.xy!);
    g.onclick = () => onClick(p);
    g.onmouseenter = () => {
      app.hovered = p;
      const tileinfo = document.getElementById("tileinfo");
      if (tileinfo) tileinfo.innerHTML = tileInfo();
      $("impact").innerHTML = impactHtml();
    };
    g.onmouseleave = () => {
      app.hovered = undefined;
      const tileinfo = document.getElementById("tileinfo");
      if (tileinfo) tileinfo.innerHTML = tileInfo();
      $("impact").innerHTML = impactHtml();
    };
  });
  document.querySelectorAll<HTMLElement>(".pb, .tool-button").forEach((b) => {
    b.onmouseenter = b.onfocus = () => { app.hoverBrush = JSON.parse(b.dataset.brush!); showBrushInfo(app.hoverBrush!); };
    b.onmouseleave = b.onblur = () => { app.hoverBrush = undefined; showBrushInfo(app.brush); };
    b.onclick = () => {
      app.brush = JSON.parse(b.dataset.brush!);
      app.hoverBrush = undefined;
      if (app.brush.kind === "区域") {
        const did = rules.effective(app.brush.id, app.board.文明);
        const main = rules.adjacency.get(did)?.find((r) => r.目标类别 !== "自身");
        if (main) app.focusYield = main.产出类型;
      }
      render();
    };
  });
  document.querySelectorAll<HTMLElement>(".tot").forEach((t) => {
    t.onclick = () => { app.focusYield = t.dataset.yield!; render(); };
  });
  const civ = document.getElementById("civ") as HTMLSelectElement | null;
  if (civ) civ.onchange = () => {
    push();
    const leaders = rules.leadersByCiv.get(civ.value) ?? [];
    app.board = { ...app.board, 文明: civ.value, 领袖: leaders[0]?.id };
    render();
  };
  const leader = document.getElementById("leader") as HTMLSelectElement | null;
  if (leader) leader.onchange = () => {
    push(); app.board = { ...app.board, 领袖: leader.value }; render();
  };
  const city = document.getElementById("city") as HTMLSelectElement | null;
  if (city) city.onchange = () => { app.selectedCity = city.value; render(); };
  document.querySelectorAll<HTMLElement>(".citysum").forEach((el) => {
    el.onclick = () => { app.selectedCity = el.dataset.city!; render(); };
  });
  const undo = document.getElementById("undo");
  if (undo) undo.onclick = () => {
    const prev = app.undo.pop();
    if (prev) { if (app.mode === "挑战") runUndos++;
      Object.assign(app, restoreMapState(app, prev)); app.mapReportBoard = undefined;
      app.settled = undefined; render(); }
  };
  const reset = document.getElementById("reset");
  if (reset) reset.onclick = () => {
    push(); app.board = resetGeneratedBoard(app.board, sandboxCurrent()); render();
  };
  const retry = document.getElementById("retry");
  if (retry) retry.onclick = () => startLevel(app.level!.关卡id);
  const tolist = document.getElementById("tolist");
  if (tolist) tolist.onclick = () => {
    recordRun("返回关卡表");
    app.level = undefined; app.levelStart = undefined; app.settled = undefined;
    $("levellist").style.display = "";
    $("play").style.display = "none";
    $("levellist").innerHTML = levelListHtml(); wire();
  };
  document.querySelectorAll<HTMLElement>("button.play").forEach((b) => {
    b.onclick = () => startLevel(b.dataset.lv!);
  });
  document.querySelectorAll<HTMLElement>("tr[data-lv]").forEach((t) => {
    t.onclick = () => {
      const lv = levels.find((candidate) => candidate.关卡id === t.dataset.lv);
      if (lv?.可开始) startLevel(t.dataset.lv!);
    };
  });
  const settings = document.getElementById("settings");
  if (settings) settings.onclick = openSettings;
  const mapGenerator = document.getElementById("map-generator");
  if (mapGenerator) {
    mapGenerator.hidden = app.mode !== "自由";
    mapGenerator.onclick = openMapGenerator;
  }
  const mapGeneratorClose = document.getElementById("map-generator-close");
  if (mapGeneratorClose) mapGeneratorClose.onclick = () => { $("map-generator-modal").hidden = true; };
  const mapGeneratorModal = document.getElementById("map-generator-modal");
  if (mapGeneratorModal) mapGeneratorModal.onclick = (event) => {
    if (event.target === mapGeneratorModal) mapGeneratorModal.hidden = true;
  };
  document.querySelectorAll<HTMLElement>("[data-map-preset]").forEach((button) => {
    button.onclick = () => {
      const preset = button.dataset.mapPreset as keyof typeof MAP_PRESETS;
      app.mapConfigDraft = { ...MAP_PRESETS[preset], seed: app.mapConfigDraft.seed };
      app.mapGenerationError = undefined;
      renderMapGeneratorModal(); wire();
    };
  });
  const mapForm = document.getElementById("map-generator-form") as HTMLFormElement | null;
  if (mapForm) {
    const read = (): MapGeneratorConfig => {
      const data = new FormData(mapForm);
      return mapConfigFromForm(Object.fromEntries([
        "preset", "cityCount", "ocean", "relief", "desert", "rivers", "resources", "polar", "seed",
      ].map((name) => [name, String(data.get(name) ?? "")])) as never);
    };
    mapForm.onchange = () => {
      try { app.mapConfigDraft = read(); app.mapGenerationError = undefined; renderMapGeneratorModal(); wire(); }
      catch (error) { app.mapGenerationError = (error as Error).message; renderMapGeneratorModal(); wire(); }
    };
    mapForm.onsubmit = (event) => {
      event.preventDefault();
      try {
        app.mapConfigDraft = read();
        const result = generateSandboxMap(rules, app.mapConfigDraft, { context: app.board });
        push();
        app.board = mergeGeneratedBoard(app.board, result.board);
        app.mapReport = result.report;
        app.mapReportBoard = app.board;
        app.mapInitialBoard = app.board;
        app.mapGenerationError = undefined;
        app.randomSeed = app.mapConfigDraft.seed;
        app.selectedCity = app.board.城市?.[0]?.id ?? "A";
        app.selected = undefined;
        $("map-generator-modal").hidden = true;
        render();
      } catch (error) {
        app.mapGenerationError = error instanceof MapGenerationError
          ? error.message : `地图生成失败：${(error as Error).message}`;
        renderMapGeneratorModal(); wire();
      }
    };
  }
  const randomSeed = document.getElementById("map-random-seed");
  if (randomSeed) randomSeed.onclick = () => {
    app.mapConfigDraft = { ...app.mapConfigDraft, seed: Math.floor(Math.random() * 0x100000000) >>> 0 };
    app.mapGenerationError = undefined;
    renderMapGeneratorModal(); wire();
  };
  const closeSettings = document.getElementById("settings-close");
  if (closeSettings) closeSettings.onclick = () => { $("settings-modal").hidden = true; };
  const modal = document.getElementById("settings-modal");
  if (modal) modal.onclick = (event) => {
    if (event.target === modal) modal.hidden = true;
  };
  const placementClose = document.getElementById("placement-alert-close");
  if (placementClose) placementClose.onclick = () => {
    const placementModal = document.getElementById("placement-alert");
    if (placementModal) placementModal.hidden = true;
  };
  const placementModal = document.getElementById("placement-alert");
  if (placementModal) placementModal.onclick = (event) => {
    if (event.target === placementModal) placementModal.hidden = true;
  };
  const showRules = document.getElementById("show-rules") as HTMLInputElement | null;
  if (showRules) showRules.onchange = () => {
    app.showDebug = showRules.checked;
    render();
  };
  document.querySelectorAll<HTMLElement>(".progression-tab").forEach((tab) => {
    tab.onclick = () => openProgression(tab.dataset.progressionTab as "政策卡" | TreeKind);
  });
  document.querySelectorAll<HTMLElement>(".progression-node").forEach((node) => {
    const kind = node.dataset.progressionKind as TreeKind;
    const detail = () => {
      const current = (kind === "科技" ? progression.techs : progression.civics)
        .get(node.dataset.progressionId!);
      const panel = document.getElementById("progression-hover");
      if (panel) panel.innerHTML = progressionHoverHtml(kind, current);
    };
    const clearDetail = () => {
      const panel = document.getElementById("progression-hover");
      if (panel) panel.innerHTML = progressionHoverHtml(kind);
    };
    node.onmouseenter = node.onfocus = detail;
    node.onmouseleave = node.onblur = clearDetail;
    node.onclick = () => selectProgressionNode(
      kind, node.dataset.progressionId!);
  });
  document.querySelectorAll<HTMLElement>(".policy-card").forEach((card) => {
    if (card.dataset.policyId) card.onclick = () => togglePolicy(card.dataset.policyId!);
    if (card.dataset.beliefId) card.onclick = () => toggleBelief(card.dataset.beliefId!);
  });
  document.querySelectorAll<HTMLElement>("[data-policy-remove]").forEach((button) => {
    button.onclick = () => togglePolicy(button.dataset.policyRemove!);
  });
  const progressionClose = document.getElementById("progression-close");
  if (progressionClose) progressionClose.onclick = () => { $("progression-modal").hidden = true; };
  const progressionModal = document.getElementById("progression-modal");
  if (progressionModal) progressionModal.onclick = (event) => {
    if (event.target === progressionModal) progressionModal.hidden = true;
  };
}

function setMode(m: "自由" | "挑战") {
  if (app.mode === "挑战") recordRun("切换模式");
  if (app.mode === "自由" && m !== "自由") {
    freeState = captureMapState(app); freeUndo = app.undo; workspace.update(freeState);
  }
  const wasFree = app.mode === "自由";
  app.mode = m;
  app.settled = undefined;
  document.body.dataset.mode = m;
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) =>
    t.classList.toggle("on", t.dataset.mode === m));
  if (m === "自由") {
    app.level = undefined; app.levelStart = undefined;
    Object.assign(app, restoreMapState(app, freeState));
    if (!wasFree) app.undo = freeUndo;
    app.mapGenerationError = undefined; app.mapReportBoard = undefined;
    app.selected = app.hovered = undefined;
    app.brush = { kind: "区域", id: PALETTE[0] }; app.focusYield = "科技";
    $("levellist").style.display = "none";
    $("play").style.display = "";
    render();
  } else {
    app.level = undefined; app.levelStart = undefined;
    $("plans").hidden = true; $("map-generator").hidden = true;
    for (const id of ["policies", "religion", "tech-tree", "civic-tree"]) $(id).hidden = true;
    $("levellist").innerHTML = levelListHtml();
    $("levellist").style.display = "";
    $("play").style.display = "none";
    wire();
  }
}

document.querySelectorAll<HTMLElement>(".tab").forEach((t) => {
  t.onclick = () => setMode(t.dataset.mode as "自由" | "挑战");
});
// 首页按钮使用事件委托，避免入口内容被重绘或旧缓存部分加载时丢失绑定。
document.addEventListener("click", (event) => {
  const target = (event.target as Element | null)?.closest<HTMLElement>("[data-enter-mode]");
  const mode = target?.dataset.enterMode;
  if (mode === "自由" || mode === "挑战") enterMode(mode);
});
const home = document.getElementById("home");
if (home) home.onclick = leaveApp;
const homeSettings = document.getElementById("home-settings");
if (homeSettings) homeSettings.onclick = openSettings;
const homeProgression = document.getElementById("home-progression");
if (homeProgression) homeProgression.onclick = () => openProgression("政策卡");
const policiesButton = document.getElementById("policies");
if (policiesButton) policiesButton.onclick = () => openProgression("政策卡");
const religionButton = document.getElementById("religion");
if (religionButton) religionButton.onclick = () => openProgression("宗教");
const techTreeButton = document.getElementById("tech-tree");
if (techTreeButton) techTreeButton.onclick = () => openProgression("科技");
const civicTreeButton = document.getElementById("civic-tree");
if (civicTreeButton) civicTreeButton.onclick = () => openProgression("文化");
document.getElementById("settings")?.setAttribute("aria-label", "设置");
document.querySelectorAll<HTMLElement>("[data-build-version]").forEach(el => {
  el.textContent = `v${BUILD_INFO.version} · ${BUILD_INFO.revision} · ${BUILD_INFO.terrainArt ? "地形素材版" : "图标版"}`;
});
