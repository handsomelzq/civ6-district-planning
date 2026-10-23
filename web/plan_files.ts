import { boardToData, boardFromData, record, type ResearchCatalog } from "../src/board_file.ts";
import { type Rules } from "../src/rules.ts";
import { normalizeMapConfig } from "../src/map_config.ts";
import { analyzeGeneratedMap } from "../src/map_report.ts";
import { type MapStateSnapshot } from "./map_generator_ui.ts";

export const PLAN_FORMAT = "civ6-district-plan";
export const STORAGE_KEY = "civ6-planner-workspace-v1";
export const MAX_PLAN_LENGTH = 2_000_000;
export const planByteLength = (text: string): number => new TextEncoder().encode(text).byteLength;

export function serializePlan(state: MapStateSnapshot, build: string): string {
  const text = JSON.stringify({ format: PLAN_FORMAT, version: 1, build,
    state: { ...state, board: boardToData(state.board),
      mapInitialBoard: state.mapInitialBoard ? boardToData(state.mapInitialBoard) : undefined,
      mapReport: state.mapReport ? { config: state.mapReport.config, metadata: state.mapReport.metadata } : undefined } });
  if (planByteLength(text) > MAX_PLAN_LENGTH) throw new Error("存档超过 2 MB");
  return text;
}

export function parsePlan(text: string, rules: Rules, catalog: ResearchCatalog): MapStateSnapshot {
  if (planByteLength(text) > MAX_PLAN_LENGTH) throw new Error("存档超过 2 MB，请选择规划台导出的 JSON");
  const file = record(JSON.parse(text), "文件");
  if (file.format !== PLAN_FORMAT || file.version !== 1) throw new Error("存档格式或版本不支持（需要规划台 v1 存档）");
  const s = record(file.state, "状态"), board = boardFromData(s.board, rules, catalog);
  const config = (value: unknown) => {
    const raw = record(value, "地图配置");
    if (!Number.isInteger(raw.seed) || raw.seed < 0 || raw.seed > 0xFFFFFFFF)
      throw new Error("存档的地图配置种子无效");
    return normalizeMapConfig(raw as never);
  };
  const mapConfigDraft = config(s.mapConfigDraft);
  const initial = s.mapInitialBoard ? boardFromData(s.mapInitialBoard, rules, catalog) : board;
  if (typeof s.selectedCity !== "string" || (board.城市 && !board.城市.some(c => c.id === s.selectedCity)))
    throw new Error("存档的当前建设城市不存在");
  if (s.randomSeed !== undefined && (!Number.isInteger(s.randomSeed) || s.randomSeed < 0 || s.randomSeed > 0xFFFFFFFF))
    throw new Error("存档种子无效");
  let mapReport;
  if (s.mapReport) {
    const report = record(s.mapReport, "报告"), m = record(report.metadata, "报告元数据");
    for (const field of ["baseSeed", "candidateSeed", "attempts", "candidateIndex"]) {
      if (field === "candidateIndex" && m[field] === undefined) continue;
      const limit = field.includes("Seed") ? 0xFFFFFFFF : 24;
      if (!Number.isInteger(m[field]) || m[field] < (limit === 24 ? 1 : 0) || m[field] > limit)
        throw new Error("存档的生成报告元数据无效");
    }
    if (m.candidateIndex !== undefined && m.candidateIndex > m.attempts)
      throw new Error("存档的候选序号大于尝试次数");
    mapReport = analyzeGeneratedMap(rules, board, config(report.config), {
      baseSeed: m.baseSeed, candidateSeed: m.candidateSeed, attempts: m.attempts, candidateIndex: m.candidateIndex });
  }
  return { board, mapInitialBoard: initial, mapConfigDraft, mapReport,
    randomSeed: s.randomSeed, selectedCity: s.selectedCity };
}

export type SavedWorkspace = { current?: string; A?: string; B?: string };
export function readWorkspace(storage: Pick<Storage, "getItem">): SavedWorkspace {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {};
  if (planByteLength(raw) > MAX_PLAN_LENGTH * 3 + 100_000) throw new Error("本机工作区文件过大");
  const value = record(JSON.parse(raw), "工作区");
  if (value.version !== 1) throw new Error("本机工作区版本不支持");
  const out: SavedWorkspace = {};
  for (const id of ["current", "A", "B"] as const) if (value[id] !== undefined) {
    if (typeof value[id] !== "string" || planByteLength(value[id]) > MAX_PLAN_LENGTH) throw new Error("本机存档损坏");
    out[id] = value[id];
  }
  return out;
}
export function writeWorkspace(storage: Pick<Storage, "setItem">, workspace: SavedWorkspace): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...workspace }));
}
