/** 区域放置与局面合法性校验。
 *
 * 这里是 UI、求值器和关卡加载共同使用的结构化入口。它只负责判断规则
 * 和返回诊断，不修改 BoardState，也不负责写入区域。
 */
import { type Axial } from "./hex.ts";
import {
  type BoardState,
  cityFor,
  districtPositions,
  inWorkRange,
  isFreshWaterSource,
  neighborTiles,
  tileAt,
} from "./board.ts";
import { type District, type Rules } from "./rules.ts";

export type LegalityLayer = "地块" | "城市" | "玩家" | "研究" | "模式";
export type LegalitySeverity = "错误" | "警告";

export type LegalityIssue = {
  readonly code: string;
  readonly layer: LegalityLayer;
  readonly severity: LegalitySeverity;
  readonly message: string;
  readonly position?: Axial;
  readonly districtId?: string;
  readonly cityId?: string;
};

export type PlacementContext = {
  readonly mode?: "自由" | "挑战";
  readonly selectedCityId?: string;
  readonly challengeBudgetRemaining?: number;
  readonly protectInitialDistricts?: ReadonlySet<string>;
};

const issue = (
  code: string,
  layer: LegalityLayer,
  message: string,
  position: Axial | undefined,
  districtId: string | undefined,
  cityId?: string,
): LegalityIssue => ({
  code,
  layer,
  severity: "错误",
  message,
  position,
  districtId,
  ...(cityId === undefined ? {} : { cityId }),
});

const effectiveDistrict = (
  rules: Rules, districtId: string, board: BoardState,
): { id: string; district: District | undefined } => {
  const id = rules.effective(districtId, board.文明);
  return { id, district: rules.districts.get(id) };
};

/** 只检查目标地块及其邻格；允许调用方选择是否检查“目标格已有区域”。 */
export function validateDistrictTile(
  rules: Rules,
  board: BoardState,
  position: Axial,
  districtId: string,
  checkOccupied = true,
): LegalityIssue[] {
  const { id, district } = effectiveDistrict(rules, districtId, board);
  const tile = tileAt(board, position);
  if (!tile) {
    return [issue("E00", "地块", "目标坐标不存在于当前盘面", position, id)];
  }
  const out: LegalityIssue[] = [];
  if (checkOccupied && tile.区域 !== undefined) {
    out.push(issue("E01", "地块", "目标地块已有区域", position, id));
  }
  if (!rules.buildableTerrain.has(tile.地形)) {
    out.push(issue(
      "E02", "地块", `${rules.name(tile.地形)}不可建造区域`, position, id,
    ));
  }
  if (district && district.可建地形.size > 0 &&
      !district.可建地形.has(tile.地形)) {
    out.push(issue(
      "E03", "地块",
      `${rules.name(id)} 不可建在${rules.name(tile.地形)}上`,
      position, id,
    ));
  }
  if (tile.地貌 !== undefined && !rules.buildableFeatures.has(tile.地貌)) {
    out.push(issue(
      "E04", "地块",
      `${rules.name(id)} 不可建在${rules.name(tile.地貌)}上`,
      position, id,
    ));
  }

  const adjacent = neighborTiles(board, position);
  const touchesCity = adjacent.some((neighbor) =>
    neighbor.区域 !== undefined &&
    rules.effective(neighbor.区域, board.文明) === "DISTRICT_CITY_CENTER");
  if (district?.不可紧邻城市中心 && touchesCity) {
    out.push(issue(
      "E05", "地块", `${rules.name(id)} 不可紧邻城市中心`, position, id,
    ));
  }
  if (district?.是否引水渠类) {
    const touchesWater = adjacent.some(isFreshWaterSource);
    if (!touchesCity || !touchesWater) {
      out.push(issue(
        "E06", "地块",
        `${rules.name(id)} 需要紧邻城市中心与淡水来源`,
        position, id,
      ));
    }
  }
  return out;
}

const placementDistrictId = (
  rules: Rules, board: BoardState, districtId: string,
): string => rules.effective(districtId, board.文明);

const countDistricts = (
  rules: Rules,
  board: BoardState,
  candidate: { position: Axial; districtId: string } | undefined,
): {
  byPlayer: Map<string, Axial[]>;
  byCity: Map<string, Axial[]>;
  candidateCityId?: string;
} => {
  const byPlayer = new Map<string, Axial[]>();
  const byCity = new Map<string, Axial[]>();
  const add = (position: Axial, districtId: string, cityId: string): void => {
    const effective = placementDistrictId(rules, board, districtId);
    (byPlayer.get(effective) ?? byPlayer.set(effective, []).get(effective)!)
      .push(position);
    const cityKey = `${cityId}@${effective}`;
    (byCity.get(cityKey) ?? byCity.set(cityKey, []).get(cityKey)!)
      .push(position);
  };
  for (const position of districtPositions(board)) {
    const tile = tileAt(board, position);
    if (!tile?.区域) continue;
    add(position, tile.区域, cityFor(board, position)?.id ?? "未归属");
  }
  let candidateCityId: string | undefined;
  if (candidate) {
    candidateCityId = candidateCityIdFor(board, candidate.position);
    add(candidate.position, candidate.districtId, candidateCityId);
  }
  return { byPlayer, byCity, candidateCityId };
};

const candidateCityIdFor = (board: BoardState, position: Axial): string =>
  cityFor(board, position)?.id ?? "未归属";

const cityNameFor = (board: BoardState, cityId: string): string =>
  board.城市?.find((city) => city.id === cityId)?.名称 ??
  (cityId === "单城" ? "本城" : cityId);

const researchIssues = (
  district: District | undefined,
  rules: Rules,
  board: BoardState,
  position: Axial,
  districtId: string,
): LegalityIssue[] => {
  if (!district) return [];
  const out: LegalityIssue[] = [];
  const missingTech = district.前置科技.filter((tech) =>
    !board.已解锁科技.has(tech));
  const missingCivic = district.前置市政.filter((civic) =>
    !board.已解锁市政.has(civic));
  if (missingTech.length) {
    out.push(issue(
      "E14t", "研究",
      `${rules.name(districtId)} 缺少前置科技：${missingTech.map(rules.name.bind(rules)).join("、")}`,
      position, districtId,
    ));
  }
  if (missingCivic.length) {
    out.push(issue(
      "E14c", "研究",
      `${rules.name(districtId)} 缺少前置市政：${missingCivic.map(rules.name.bind(rules)).join("、")}`,
      position, districtId,
    ));
  }
  return out;
};

const limitIssues = (
  rules: Rules,
  board: BoardState,
  position: Axial,
  districtId: string,
  counts: ReturnType<typeof countDistricts>,
): LegalityIssue[] => {
  const { id, district } = effectiveDistrict(rules, districtId, board);
  if (!district) return [];
  const out: LegalityIssue[] = [];
  const playerCount = counts.byPlayer.get(id)?.length ?? 0;
  if (playerCount > district.每玩家上限) {
    out.push(issue(
      "E17b", "玩家",
      `${rules.name(id)} 放了 ${playerCount} 座，超过每玩家上限 ${district.每玩家上限}`,
      position, id,
    ));
  }
  const cityId = counts.candidateCityId ?? candidateCityIdFor(board, position);
  const cityCount = counts.byCity.get(`${cityId}@${id}`)?.length ?? 0;
  if (cityCount > district.每城上限) {
    out.push(issue(
      "E17c", "城市",
      `${rules.name(id)} 在${cityNameFor(board, cityId)}放了 ${cityCount} 座，超过每城上限 ${district.每城上限}`,
      position, id, cityId,
    ));
  }
  return out;
};

const placementIssues = (
  rules: Rules,
  board: BoardState,
  position: Axial,
  districtId: string,
  context: PlacementContext | undefined,
): LegalityIssue[] => {
  const { id, district } = effectiveDistrict(rules, districtId, board);
  const out: LegalityIssue[] = [];
  const tileIssues = validateDistrictTile(rules, board, position, districtId);
  out.push(...tileIssues);
  if (!district) return out;

  const cityId = context?.selectedCityId ?? candidateCityIdFor(board, position);
  if (!inWorkRange(board, position, context?.selectedCityId)) {
    out.push(issue(
      "E16", "城市",
      `${rules.name(id)} 超出城市 3 格工作范围`,
      position, id, cityId,
    ));
  }
  out.push(...researchIssues(district, rules, board, position, id));
  out.push(...limitIssues(rules, board, position, districtId, countDistricts(
    rules, board, { position, districtId },
  )));
  if (context?.mode === "挑战" &&
      (context.challengeBudgetRemaining ?? 0) <= 0) {
    out.push(issue(
      "G5", "模式", "挑战模式剩余放置预算不足", position, id,
    ));
  }
  return out;
};

/** 校验一次区域放置，问题顺序与 SDD §3.1 保持稳定。 */
export function validateDistrictPlacement(
  rules: Rules,
  board: BoardState,
  position: Axial,
  districtId: string,
  context?: PlacementContext,
): LegalityIssue[] {
  return placementIssues(rules, board, position, districtId, context);
}

/** 校验当前局面中的所有已放置区域，保留全部诊断而不是只返回首个问题。 */
export function validateBoard(
  rules: Rules,
  board: BoardState,
): LegalityIssue[] {
  const out: LegalityIssue[] = [];
  const counts = countDistricts(rules, board, undefined);
  const emittedCityLimits = new Set<string>();
  const emittedPlayerLimits = new Set<string>();
  for (const position of districtPositions(board)) {
    const tile = tileAt(board, position);
    if (!tile?.区域) continue;
    const { id, district } = effectiveDistrict(rules, tile.区域, board);
    const tileIssues = validateDistrictTile(
      rules, board, position, tile.区域, false,
    );
    out.push(...tileIssues);
    if (!district) continue;
    const city = cityFor(board, position);
    const cityId = city?.id ?? "未归属";
    if (!inWorkRange(board, position, city?.id)) {
      out.push(issue(
        "E16", "城市",
        `${rules.name(id)} 超出城市 3 格工作范围`,
        position, id, cityId,
      ));
    }
    out.push(...researchIssues(district, rules, board, position, id));
    const playerCount = counts.byPlayer.get(id)?.length ?? 0;
    const cityCount = counts.byCity.get(`${cityId}@${id}`)?.length ?? 0;
    const cityLimitKey = `${cityId}@${id}`;
    const sameLimit = district.每城上限 === district.每玩家上限;
    if (cityCount > district.每城上限 &&
        !(sameLimit && playerCount > district.每玩家上限) &&
        !emittedCityLimits.has(cityLimitKey)) {
      out.push(issue(
        "E17c", "城市",
        `${rules.name(id)} 在${cityNameFor(board, cityId)}放了 ${cityCount} 座，超过每城上限 ${district.每城上限}`,
        position, id, cityId,
      ));
      emittedCityLimits.add(cityLimitKey);
    }
    if (playerCount > district.每玩家上限 &&
        !emittedPlayerLimits.has(id)) {
      out.push(issue(
        "E17b", "玩家",
        `${rules.name(id)} 放了 ${playerCount} 座，超过每玩家上限 ${district.每玩家上限}`,
        position, id,
      ));
      emittedPlayerLimits.add(id);
    }
  }
  return out.sort((a, b) => {
    const order = new Map([
      ["E00", 0], ["E01", 1], ["E02", 2], ["E03", 3], ["E04", 4],
      ["E05", 5], ["E06", 6], ["E16", 7], ["E14t", 8], ["E14c", 9],
      ["E17c", 10], ["E17b", 11], ["G5", 12],
    ]);
    return (order.get(a.code) ?? 99) - (order.get(b.code) ?? 99) ||
      (a.position?.q ?? 0) - (b.position?.q ?? 0) ||
      (a.position?.r ?? 0) - (b.position?.r ?? 0);
  });
}
