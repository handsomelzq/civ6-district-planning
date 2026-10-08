# Codex 游戏工作台 · 区域规划 Demo

安装日期：2026-10-02。已接入 8 个项目技能、6 个角色参考和自动检查脚本。
这是根据 Codex-Game-Studios 工作流制作的个人 Demo 适配版。
完整上游项目另存于本机 `gamejam/游戏制作学习/工具/Codex-Game-Studios/`。

## 如何使用

最好把 `区域规划demo` 作为 Codex 项目打开；新一轮对话可加载项目技能。
若当前仍在父目录 `gamejam`，直接说“使用区域规划demo 的 smoke-check 工作流”，
Codex 可由父目录 AGENTS.md 找到技能文件；父目录会话不一定把子目录技能列进补全菜单。
如果 `$技能名` 暂未显示，重新打开该项目任务，或明确要求读取下表对应文件。
本次已按路径验证技能；技能选择菜单是否刷新需由客户端加载后确认。

| 技能 | 本项目用途 | 可以直接发送的指令 |
|---|---|---|
| [start](../.agents/skills/start/SKILL.md) | 识别已有项目、待办和证据 | 使用 $start 整理区域规划 Demo 当前状态 |
| [setup-engine](../.agents/skills/setup-engine/SKILL.md) | 核对实际技术栈；按需规划 Unity 迁移 | 使用 $setup-engine 评估把求值器迁到 Unity 的工作量，先不改代码 |
| [brainstorm](../.agents/skills/brainstorm/SKILL.md) | 探索一项玩法或关卡选择 | 使用 $brainstorm 为区域相邻加成设计三个教学关卡方向 |
| [design-system](../.agents/skills/design-system/SKILL.md) | 写／审阅单个系统设计 | 使用 $design-system 检查自由模式导出关卡的规则与边界 |
| [create-architecture](../.agents/skills/create-architecture/SKILL.md) | 设计到模块、数据和测试的映射 | 使用 $create-architecture 分析导出关卡会影响哪些模块 |
| [dev-story](../.agents/skills/dev-story/SKILL.md) | 将已批准的需求实现并验收 | 使用 $dev-story 实现我已确认的任务卡，并执行对应测试 |
| [smoke-check](../.agents/skills/smoke-check/SKILL.md) | 日常自动检查，按需补浏览器验证 | 使用 $smoke-check 检查当前 Demo，记录已有问题 |
| [gate-check](../.agents/skills/gate-check/SKILL.md) | 判断是否具备演示／交付条件 | 使用 $gate-check 评估当前版本是否适合求职展示 |

轻量迭代顺序：明确体验目标 → 补充必要设计 → 确认影响范围 → 实现 → 自动检查与试玩。
小改动可以直接进入实现；无需为使用工具补齐整套大型工作室文档。

## 文档与角色

现有 `设计/`、`拆解/`、`配置表/` 保持原位置。
新任务需要记录时使用 [任务卡模板](templates/story.md)，只记录真实需求与验收标准。
需要归档新任务卡时放入 `production/stories/`，用实际任务名创建文件。
计划中的想法标为 Draft，用户批准后才能记为 Ready，不能因为出现在模板里就实施。

六个角色是按需读取的参考视角：

- [game-designer](roles/game-designer.md)：核心循环、关卡体验和玩家选择。
- [systems-designer](roles/systems-designer.md)：公式、配置、特殊规则和边界。
- [gameplay-programmer](roles/gameplay-programmer.md)：TypeScript 玩法及界面接线。
- [qa-tester](roles/qa-tester.md)：测试、复现步骤和证据。
- [producer](roles/producer.md)：范围、依赖和交付检查。
- [unity-specialist](roles/unity-specialist.md)：仅在明确涉及 Unity/C# 时使用。

当前 Codex 可以按这些视角顺序工作；安装并不等于六个独立代理同时运行。
Claude Hooks、自动任务委派、上游模型配置没有接入。

## 一键检查

从项目根目录执行，无需 npm install 或新增 Python 依赖：

```bash
node Tools/studio_check.mjs --mode smoke
node Tools/studio_check.mjs --mode gate
```

退出码 0 表示该模式下所有自动命令通过；1 表示失败或有必需命令未执行。
报告和完整命令日志写入 `production/qa/`。脚本会重建已忽略的 `web/dist/`，不重生成配置表。
gate 模式包含严格交付校验：缺表和待核条目可能导致失败，不能为通过而删除校验。
没有浏览器交互的运行，报告会明确标记试玩 NOT RUN。报告也不是发布授权。

## 更新和卸载

来源版本、改写边界与 MIT 许可见 [UPSTREAM.md](UPSTREAM.md) 和 [LICENSE](LICENSE)。
升级时先在学习目录审查新版本，再逐项合入适用改动；不要把上游同步脚本直接跑在本 Demo。
若要移除工作台，仅移除本次新增的技能、导航、studio 文档、检查脚本及接入报告，
保留后续自己创建的任务与验收记录；不触碰既有源码、CSV 或策划文档。
