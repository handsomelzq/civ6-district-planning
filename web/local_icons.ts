/** 统一使用随站点发布的文明 VI 图标资源。 */
const ICON_FALLBACKS: Record<string, string> = {
  // 当前本机提取包缺少这些罕见/状态地貌的独立图标，使用同类官方图标，
  // 避免地图退化为纯色或浏览器破图；条目名称仍保留真实数据名称。
  FEATURE_BERMUDA_TRIANGLE: "FEATURE_VOLCANO",
  FEATURE_BURNING_FOREST: "FEATURE_FOREST",
  FEATURE_BURNING_JUNGLE: "FEATURE_JUNGLE",
  FEATURE_BURNT_FOREST: "FEATURE_FOREST",
  FEATURE_BURNT_JUNGLE: "FEATURE_JUNGLE",
  FEATURE_EYJAFJALLAJOKULL: "FEATURE_VOLCANO",
  FEATURE_FOUNTAIN_OF_YOUTH: "FEATURE_OASIS",
  FEATURE_GIANTS_CAUSEWAY: "FEATURE_MATTERHORN",
  FEATURE_HA_LONG_BAY: "FEATURE_REEF",
  FEATURE_LYSEFJORDEN: "FEATURE_CLIFFS_DOVER",
  FEATURE_PAITITI: "FEATURE_MATTERHORN",
  FEATURE_ULURU: "FEATURE_MATTERHORN",
};

export function localIconSrc(id: string, _pageUrl?: string): string | undefined {
  if (!/^[A-Z][A-Z0-9_]+$/.test(id)) return undefined;
  return `civ6-ui/icons/${ICON_FALLBACKS[id] ?? id}.png`;
}
