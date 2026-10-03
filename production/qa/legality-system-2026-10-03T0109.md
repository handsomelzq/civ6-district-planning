# 区域合法性系统 QA 记录

- 日期：2026-10-03（Asia/Shanghai）
- 代码版本：`b047bfe`（`fix: rebuild challenge levels with legal district layouts`）
- 验证范围：共享区域合法性校验、挑战关卡加载拦截、设计期关卡搜索唯一性、9 个挑战关卡重建

## 结果摘要

- Node 全量测试：98/98 通过
- 关卡对账：13/13 通过
- Python 关卡搜索唯一性测试：7/7 通过
- 配置开发模式：错误 0，警告 3
- 配置校验器回归：全部断言通过
- 文档链接：197 条本地链接，坏链 0
- Web 构建：通过
- `web/dist/app.bundle.js` 语法检查：通过
- 9 个挑战关卡初始局面：全部合法、未提前达成目标
- 9 个最优候选布局：全部无 E14/E17b/E17c 合法性错误
- L-08/L-09 文明交叉代入：双向劣化通过

## 已执行命令

```text
npm test
node --test tests/levels.test.ts
python3 -m unittest Tools/test_design_levels.py
python3 Tools/check_config.py --mode dev
python3 Tools/test_check_config.py
python3 Tools/check_links.py
node Tools/build_web.mjs
node --check web/dist/app.bundle.js
node Tools/studio_check.mjs --mode smoke
node Tools/studio_check.mjs --mode gate
```

## 关卡结果

设计期搜索器现在在 `frontier()`、`enumerate_layouts()`、`greedy()` 扩展候选前，按文明替换后的有效区域 ID检查每城上限和每玩家上限。`levels.csv` 同步写入候选区域所需的科技 / 市政解锁集合。

9 个交付关卡均通过：

- 初始局面加载校验；
- 目标值、二星 / 三星阈值与 `levels_oracle.json` 对账；
- 最优候选布局合法性校验；
- 普通关贪心基线约束；
- L-08/L-09 双向文明交叉代入劣化。

L-04「一格双优」仍是设计脚本中的反向回归用例，因强贪心基线已达标而不进入交付配置。

## 已知警告与验收边界

开发配置模式有 3 个已知警告：

1. `units.csv` 尚未生成；
2. `combat_modifiers.csv` 尚未生成；
3. 韩国书院负向相邻规则为合法但罕见的数据提示。

`studio_check --mode smoke` 和 `--mode gate` 的自动检查结论为 FAIL，但失败项不是本轮区域合法性回归：

- `git diff --check` 被既有的 `设计/SDD-区域合法性系统.md:4` 尾随空格拦截；
- delivery 配置模式因 `units.csv` / `combat_modifiers.csv` 缺失而失败。

其余 smoke/gate 项目，包括 Node 测试、配置开发校验、配置回归、链接、Web 构建、bundle 语法和既有母题检查均通过。自动化检查不包含浏览器交互或游戏内实测。

本轮没有完成、也没有声称完成：

- 人口配额规则；
- 资源冲突规则；
- 世界奇观占地 / 冲突规则；
- 尚未进行的游戏内实测事项。

