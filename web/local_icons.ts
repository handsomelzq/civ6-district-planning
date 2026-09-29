/** 统一使用随站点发布的文明 VI 图标资源。 */
export function localIconSrc(id: string, _pageUrl?: string): string | undefined {
  if (!/^[A-Z][A-Z0-9_]+$/.test(id)) return undefined;
  return `civ6-ui/icons/${id}.png`;
}
