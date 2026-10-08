/** 区域落位的地块级合法性。
 *
 * 这里不处理科技、市政、区域数量上限或挑战配额，只处理由目标格及其
 * 邻格决定的 Civilization VI 放置约束。UI 与静态求值器共用本模块，
 * 避免出现“界面能放、求值器判非法”的两套规则。
 */
import { distance, key, type Axial } from "./hex.ts";
import {
  MIN_CITY_CENTER_DISTANCE, type BoardState, isFreshWaterSource,
  tileAt,
} from "./board.ts";
import { type Rules } from "./rules.ts";
import { validateDistrictTile } from "./legality.ts";

export function districtPlacementConstraint(
  rules: Rules, board: BoardState, p: Axial, districtId: string,
): string {
  return validateDistrictTile(rules, board, p, districtId, false)[0]?.message ?? "";
}

/** 自由模式中移动城市中心的地块级约束。 */
export function cityCenterPlacementConstraint(
  board: BoardState, p: Axial, cityId: string,
): string {
  const tile = tileAt(board, p);
  if (!tile) return "不在盘面上";
  const current = board.城市?.find((city) => city.id === cityId);
  if (!current) return "未找到所选城市";
  if (key(current.中心) === key(p)) return "";
  if (tile.区域) return "目标地块已有区域";
  if (tile.资源) return "城市中心不能放在资源上";
  if (tile.世界奇观 || tile.自然奇观) return "城市中心不能放在奇观上";
  if (tile.地形 === "TERRAIN_OCEAN" || tile.地形.endsWith("_MOUNTAIN")) {
    return "城市中心不能放在海洋或山脉上";
  }
  for (const other of board.城市 ?? []) {
    if (other.id === cityId) continue;
    const gap = distance(other.中心, p);
    if (gap < MIN_CITY_CENTER_DISTANCE) {
      return `距离${other.名称}不足，城市中心至少相隔 ${MIN_CITY_CENTER_DISTANCE} 格`;
    }
  }
  return "";
}
