# 区域合法性系统后续验收记录

## 范围

本轮继续处理人口配额、资源冲突、奇观占用冲突、军事配置表 schema 和文档空白告警。

## 已完成

- 修复 `District.是否占区域配额` 未进入运行时解析的问题。
- 人口配额接入共享合法性入口，错误码为 `E17p`。
- 资源、自然奇观、世界奇观单格占用冲突接入共享合法性入口，错误码分别为 `E07`、`E08`、`E09`。
- `配置表/units.csv`、`配置表/combat_modifiers.csv` 已创建为正式 schema 空表；未填入未经核对的军事数值。
- 更新区域合法性 SDD、字段说明、README 和 GDD 状态说明。
- 清除既有 SDD 尾随空格告警。

## 自动验证

| 检查 | 结果 |
|---|---|
| `npm test` | PASS，101/101 |
| `git diff --check` | PASS |
| `python3 Tools/check_config.py` | PASS，0 错误；1 个既有韩国书院负相邻警告 |
| `python3 Tools/test_check_config.py` | PASS |
| `python3 Tools/check_links.py` | PASS，197 条本地链接，坏链 0 |
| `node Tools/studio_check.mjs --mode smoke` | PASS |
| `node Tools/studio_check.mjs --mode gate` | PASS |

自动检查报告：

- `production/qa/studio-smoke-2026-10-03T14-15-52-144Z-95298.md`
- `production/qa/studio-gate-2026-10-03T14-16-20-506Z-95400.md`

## 未完成 / 未验证

- 游戏内实测：`NOT RUN`。本机本轮没有启动《文明 VI》并读取人口解锁、资源覆盖、自然奇观占地或世界奇观 footprint 的游戏内读数。
- 人口公式 `floor(人口 / 3) + 1` 是 Demo 显式假设，不是本轮游戏内实测结论。
- 资源冲突目前按“目标格已有资源即阻止区域”处理，资源是否存在可移除、可覆盖或特殊例外仍待游戏内核对。
- 世界奇观目前按 `Tile.世界奇观` 单格标记处理，完整多格 footprint 尚未建模。
- `units.csv`、`combat_modifiers.csv` 只有 schema，军事单位数值、军事修正和军事关卡仍未完成。
- 现有开发/交付配置检查保留 1 个合法但罕见的韩国书院负相邻警告。

## 结论

区域规划子集的自动验证已通过；整体项目仍是 `CONCERNS`，原因是军事数据和上述游戏内实测证据缺口尚未解除。
