# 来源与适配边界

- 安装日期：2026-10-02。
- 上游原项目：https://github.com/Donchitos/Claude-Code-Game-Studios
- 本次采用的兼容 Fork：https://github.com/pa4uslf/Codex-Game-Studios
- 固定提交：`6035b28fd6f89c382b4d6216d47cf0c2d0105d9f`。
- 完整本地克隆：`/Users/liuziqiang/Desktop/gamejam/游戏制作学习/工具/Codex-Game-Studios`。
- 许可：MIT，保留 [LICENSE](LICENSE)。许可只覆盖该工作流软件及文档，不涉及文明 VI 美术。

使用 Codex skill-installer 从上述固定提交安装了 8 个 `.agents/skills/` 入口，
随后为本 Demo 独立改写其 SKILL.md。角色参考为面向当前项目的精简适配，
完整原文仍在学习目录克隆的 `.claude/agents/` 中。

## 为什么改写

原适配入口需继续读取 `.claude/skills/`、模板、引擎参考和完整制作阶段文件。
若只复制入口，来源文件会缺失。其 `../../../.claude/…` 相对路径在按 SKILL.md
所在目录解析时也少向上一层；同步检查只比较生成文本，不能发现该引用问题。

本项目的 8 个 SKILL.md 是自包含流程，公共引用使用已核对的
`../../../studio/…` 与 `../../../AGENTS.md`；不再依赖 `.claude/` 或学习目录绝对路径运行。
同一仓库克隆到另一台机器也能读取工作流所需文件。

保留的设计思想：从已有项目接入、体验目标先行、规则与实现可追溯、按验收条件实现、
区分自动测试和实际试玩、阶段验收有证据。

具体适配：

| 上游机制 | 本项目处理 |
|---|---|
| `CLAUDE.md` 和 `.claude/` 指令 | 项目 `AGENTS.md`、独立技能与 `studio/` 参考 |
| 英文 `design/` 等文档路径 | 使用现有 `设计/`、`拆解/`、`配置表/` |
| `Task` 与专属角色工具／模型配置 | 当前 Codex 按角色视角执行；不宣称自动多代理 |
| Hooks 质量门禁 | 显式执行 `Tools/studio_check.mjs`，现有 CI 保持原样 |
| 完整 TR／ADR／总监签字前置条件 | 任务需要的设计依据、影响范围及验收证据 |
| 上游 `/命令` | Codex `$技能名` 或中文明确点名工作流 |
| 全量同步生成适配器 | 不在本 Demo 使用；更新需人工审查后合入 |

## 已验证与未验证

完整参考克隆的 `python3 tools/sync_codex_adapters.py --check` 已通过（73 个生成文件）。
这项结果不代表全部上游技能可在 Codex 运行。本次仅接入并校验列出的 8 个。
没有安装 Claude Hooks、MCP、Unity 编辑器、付费服务或其他引擎依赖。
技能自动发现依赖 Codex 的项目目录和客户端刷新，当前轮以显式路径读取执行。
