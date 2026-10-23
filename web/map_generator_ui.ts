import { type BoardState } from "../src/board.ts";
import {
  MAP_PRESETS, normalizeMapConfig, targetBands, applyMapContext,
  type Level3, type MapGeneratorConfig, type MapPresetId,
} from "../src/map_generator.ts";
import { analyzeGeneratedMap, type MapGenerationReport } from "../src/map_report.ts";
import { type Rules } from "../src/rules.ts";

export type MapConfigForm = Record<
  "preset" | "cityCount" | "ocean" | "relief" | "desert" | "rivers" |
  "resources" | "polar" | "seed", string>;

export function mapConfigFromForm(values: MapConfigForm): MapGeneratorConfig {
  return normalizeMapConfig({
    preset: values.preset as MapPresetId,
    cityCount: Number(values.cityCount) as 2 | 3 | 4,
    ocean: values.ocean as Level3,
    relief: values.relief as Level3,
    desert: values.desert as Level3,
    rivers: values.rivers as Level3,
    resources: values.resources as Level3,
    polar: values.polar as MapGeneratorConfig["polar"],
    seed: Number(values.seed),
  });
}

export const mergeGeneratedBoard = (old: BoardState, generated: BoardState): BoardState => ({
  ...generated,
  文明: old.文明,
  领袖: old.领袖,
  已解锁科技: old.已解锁科技,
  已解锁市政: old.已解锁市政,
  已装配政策: old.已装配政策,
  已选宗教信条: old.已选宗教信条,
});

export const preserveBoardOnGenerationFailure = (old: BoardState): BoardState => old;

export type MapStateSnapshot = {
  board: BoardState; mapConfigDraft: MapGeneratorConfig; mapReport?: MapGenerationReport;
  randomSeed?: number; selectedCity: string; mapInitialBoard?: BoardState;
};
export const captureMapState = (state: MapStateSnapshot): MapStateSnapshot => ({
  board: state.board, mapConfigDraft: state.mapConfigDraft, mapReport: state.mapReport,
  randomSeed: state.randomSeed, selectedCity: state.selectedCity, mapInitialBoard: state.mapInitialBoard,
});
export const restoreMapState = <T extends MapStateSnapshot>(state: T, saved: MapStateSnapshot): T =>
  ({ ...state, ...saved });
export const resetGeneratedBoard = (current: BoardState, initial: BoardState): BoardState =>
  applyMapContext(initial, current);
export const refreshMapReport = (rules: Rules, board: BoardState, report: MapGenerationReport): MapGenerationReport =>
  analyzeGeneratedMap(rules, board, report.config, report.metadata);

const PRESET_NAMES: Record<Exclude<MapPresetId, "custom">, string> = {
  balanced: "均衡大陆", "mountain-basin": "山脉盆地",
  "arid-valley": "干旱河谷", "coastal-cities": "海湾群城",
};
const LEVEL_NAMES: Record<Level3, string> = { low: "少", standard: "标准", high: "多" };
const POLAR_NAMES: Record<MapGeneratorConfig["polar"], string> = {
  none: "无", north: "北缘", south: "南缘", random: "随机",
};
const field = (
  name: "ocean" | "relief" | "desert" | "rivers" | "resources",
  label: string, value: Level3,
): string => `<fieldset class="map-option"><legend>${label}</legend>${(["low", "standard", "high"] as const)
  .map((level) => `<label><input type="radio" name="${name}" value="${level}" ${value === level ? "checked" : ""}>${LEVEL_NAMES[level]}</label>`).join("")}</fieldset>`;

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const esc = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const reportMessage = (report: MapGenerationReport): string => report.status === "error"
  ? `当前地图检查：${report.checks.filter((x) => x.severity === "error").map((x) => x.message).join("；")}`
  : report.warning ?? "全部参数目标命中";
export const renderMapReportSummary = (report: MapGenerationReport): string =>
  `<section class="map-report ${report.status}"><b>${esc(reportMessage(report))}</b>
  <small> · ${report.cities.length} 城 · ${report.rivers.count} 条河 · 基础种子 ${report.metadata.baseSeed}</small></section>`;

const reportHtml = (report: MapGenerationReport): string => {
  const rows = report.targets.map((target) => `<tr><td>${target.label}</td><td>${target.passed ? "通过" : "偏差"}</td>
    <td>${target.code === "TARGET_RIVERS" ? `${target.actual} 段` : `${target.actual} / ${target.denominator}`}</td>
    <td>${target.code === "TARGET_RIVERS" ? `${report.rivers.count} 条` : pct(target.ratio)}</td>
    <td>${target.code === "TARGET_RIVERS" ? `${targetBands(report.config).rivers.count} 条 / ${target.target[0]}–${target.target[1]} 段` : `${pct(target.target[0])}–${pct(target.target[1])}`}</td></tr>`).join("");
  const s = report.surface;
  const cityRows = report.cities.map((c) => `<p>${esc(c.name)}：领土 ${c.territoryTiles} 格，
    可建地形 ${c.buildableTiles} 格；学院 ${c.districtCandidates.DISTRICT_CAMPUS}，圣地 ${c.districtCandidates.DISTRICT_HOLY_SITE}，
    商业中心 ${c.districtCandidates.DISTRICT_COMMERCIAL_HUB}，工业区 ${c.districtCandidates.DISTRICT_INDUSTRIAL_ZONE}</p>`).join("");
  const config = report.config;
  return `<section class="map-report ${report.status}"><h3>生成结果</h3>
    <p>${esc(reportMessage(report))} · 尝试 ${report.metadata.attempts} 次 · 实际种子 ${report.metadata.candidateSeed}</p>
    <div class="report-summary"><span>城市 ${report.cities.length}</span><span>河流 ${report.rivers.count} 条 / ${report.rivers.segments} 段</span><span>资源 ${report.resources.total}</span></div>
    <details><summary>查看请求与实际完整报告</summary><table><thead><tr><th>项目</th><th>结果</th><th>实际计数</th><th>实际</th><th>请求</th></tr></thead><tbody>${rows}</tbody></table>
    <p>版本 ${report.version} · 基础种子 ${report.metadata.baseSeed} · 选中第 ${report.metadata.candidateIndex ?? report.metadata.attempts} 个候选</p>
    <p>生成配置：${config.preset === "custom" ? "自定义" : PRESET_NAMES[config.preset]} · ${config.cityCount} 城；
    海洋 ${LEVEL_NAMES[config.ocean]}；山地 ${LEVEL_NAMES[config.relief]}；沙漠 ${LEVEL_NAMES[config.desert]}；
    河流 ${LEVEL_NAMES[config.rivers]}；资源 ${LEVEL_NAMES[config.resources]}；极地 ${POLAR_NAMES[config.polar]}</p>
    <p>水域 ${s.water}/${s.total}：海洋 ${s.ocean} 格，湖泊 ${s.lake} 格；丘陵 ${s.hills}/${s.land}（${pct(s.hills / s.land)}）；
    地势片区 ${s.reliefComponents}，沙漠片区 ${s.desertComponents}，冻土片区 ${s.tundraComponents}；
    实际极地 ${report.polarActual === "invalid" ? "异常" : POLAR_NAMES[report.polarActual]}，冻土 ${s.tundra} 格</p>
    <p>临河陆地 ${report.rivers.riversideLand}/${s.land}（${pct(report.rivers.riversideLandRatio)}）；
    入海 ${report.rivers.outlets.sea}，入湖 ${report.rivers.outlets.lake}；
    资源类别：${Object.entries(report.resources.byCategory).map(([kind, n]) => `${esc(kind)} ${n}`).join("、")}</p>
    ${cityRows}${report.checks.map((check) => `<p class="report-check ${check.severity}">${check.severity === "pass" ? "✓" : "!"} ${esc(check.message)}</p>`).join("")}</details></section>`;
};

export function renderMapGeneratorContent(
  input: MapGeneratorConfig, report?: MapGenerationReport, error?: string,
): string {
  const config = normalizeMapConfig(input), targets = targetBands(config);
  return `<div class="map-presets">${Object.entries(MAP_PRESETS).map(([id, preset]) =>
    `<button type="button" class="map-preset ${config.preset === id ? "on" : ""}" data-map-preset="${id}"><b>${PRESET_NAMES[id as keyof typeof PRESET_NAMES]}</b><small>${preset.cityCount} 城 · ${LEVEL_NAMES[preset.ocean]}海洋 · ${LEVEL_NAMES[preset.relief]}山地</small></button>`).join("")}</div>
    <form id="map-generator-form"><p>当前配置：${config.preset === "custom" ? "自定义" : PRESET_NAMES[config.preset]}。
      生成将替换当前地图，可撤销恢复。</p>
      <div class="map-options"><fieldset class="map-option"><legend>城市数量</legend>${([2, 3, 4] as const).map((n) =>
        `<label><input type="radio" name="cityCount" value="${n}" ${config.cityCount === n ? "checked" : ""}>${n} 城</label>`).join("")}</fieldset>
      ${field("ocean", "海洋占比", config.ocean)}${field("relief", "山地起伏", config.relief)}${field("desert", "沙漠覆盖", config.desert)}${field("rivers", "河流丰度", config.rivers)}${field("resources", "资源密度", config.resources)}
      <fieldset class="map-option"><legend>极地带</legend>${(["none", "north", "south", "random"] as const).map((polar) =>
        `<label><input type="radio" name="polar" value="${polar}" ${config.polar === polar ? "checked" : ""}>${POLAR_NAMES[polar]}</label>`).join("")}</fieldset></div>
      <input type="hidden" name="preset" value="${config.preset}">
      <div class="map-seed"><label>地图种子 <input name="seed" type="number" min="0" max="4294967295" step="1" value="${config.seed}"></label>
      <button type="button" id="map-random-seed">换一个种子</button></div>
      <p class="map-target-hint">请求：水域 ${pct(targets.ocean[0])}–${pct(targets.ocean[1])}；丘陵与山脉 ${pct(targets.relief[0])}–${pct(targets.relief[1])}；最多自动尝试 24 次。</p>
      ${error ? `<p class="warn">${esc(error)}</p>` : ""}<div class="map-actions"><button type="submit">生成地图</button></div>
    </form>${report ? reportHtml(report) : ""}`;
}
