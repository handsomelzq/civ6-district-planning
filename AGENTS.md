# 文明 VI 区域规划 · Codex 工作约定

## 项目定位与入口

这是已有的 TypeScript + Web 区域规划 Demo，兼顾规则拆解与系统／数值策划作品集。
本仓库目前没有 Unity 工程；学习 Unity/C# 不表示已经决定迁移此项目。
先读 `.agentlens/INDEX.md`，按任务读取 `studio/project-context.md` 及现有文档。

## 已有结构是正式来源

- `拆解/`：参考游戏的机制和证据；区分数据读取、游戏内实测、待核推断。
- `设计/`：本 Demo 的立项、GDD、SDD、关卡、数值与测试清单。
- `配置表/`：项目运行使用的 CSV 与字段说明。查清解析脚本和生成关系再改表。
- `src/`：纯逻辑求值器、精确有理数、六边形坐标、盘面及共用落位规则。
- `web/`：状态接线、交互和 SVG 渲染；`web/dist/` 是生成物。
- `tests/`：Node 内置测试；`Tools/`：标准库脚本与构建工具。
- `task_plan.md`、`findings.md`、`progress.md`：已有专项任务记录；不以新工作流覆盖它们。
- `production/`：本次接入及后续任务的验收证据；`studio/`：工作流、角色与模板。

## 可用技能

`.agents/skills/` 中安装了 `start`、`setup-engine`、`brainstorm`、`design-system`、
`create-architecture`、`dev-story`、`smoke-check`、`gate-check`。
按需读取对应 SKILL.md；其中文项目适配版是这里的执行入口。
详细用途与自然语言示例见 `studio/README.md`。

角色参考位于 `studio/roles/`。角色表示检查视角，不意味着已启动独立代理。
默认由当前 Codex 顺序执行；不模拟 Claude Task、Hooks 或 Slash Command 已经生效。
用户要求委派时使用当前环境真实可用的能力；没有能力时如实说明。

## 工作边界

1. 开始前检查 `git status --short` 和涉及文件的差异，保留已有未提交工作。
2. 修改重要策划案、配置或架构前先展示具体方案；已有明确批准不重复索要同一批准。
3. 以用户明确要求为范围；读取分析不自动变成玩法修改、数据重生成或公开发布。
4. 手工编辑使用 apply_patch。新增工作流文档不要求搬动或重写已有设计文档。
5. 求值器保持可独立测试；共享规则放在 `src/`，避免 UI 与求值器各写一份落位规则。
6. 数值／公式变动要能追溯到配置、拆解和测试；保留待核标记，不把静态 XML 当运行语义实测。
7. 当前使用 Node 24 原生 TypeScript 类型剥离与 Python 标准库；类型剥离不等于类型检查。
8. 不把模板要求的 TR 注册表、三份 ADR、四位总监签字变成个人 Demo 的前置条件。
9. 上游源码和完整模板存放于学习目录；不运行其同步脚本覆盖本项目独立改写的技能。
10. 官方图标的现有来源说明是 `web/civ6-ui/SOURCE.md`；工作流安装不改变资源或发布范围。

## 验证

在本项目根目录运行：

```bash
node Tools/studio_check.mjs --mode smoke
node Tools/studio_check.mjs --mode gate
```

`smoke` 校验技能／角色引用、运行自动测试、开发模式配置校验、校验器回归、文档链接、
网页构建与包语法检查；`gate` 额外运行现有 CI 的母题脚本和严格交付数据检查。
报告写入 `production/qa/`，每次独立命名。失败、未执行和通过分别记录。
这个脚本只检查自动化项目，不替代 `$gate-check` 对目标与证据的人工判断。
UI 修改需要浏览器交互证据；测试通过不代表游戏内实测、可玩性或公开发布条件全部满足。
