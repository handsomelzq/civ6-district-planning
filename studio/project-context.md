# 项目上下文

本页是工作流接入时的导航快照（2026-10-02），具体行为以当前代码、配置和用户最新决策为准。

## 已确认事实

- 现有技术栈：TypeScript + Web，Node 24 原生类型剥离，Python 标准库工具。
- 产品目标：文明 VI 区域规划、产出明细解释、自由模式与挑战模式，服务系统／数值策划作品集。
- 规则数据：`配置表/`；来源与语义见 `字段说明.md`、拆解和 SDD。不可混同静态数据与运行算法。
- 最新专项工作入口：`task_plan.md`，当前是 Civilopedia 基准化校对；工作台不另立一个平行产品路线。
- Unity/C# 是用户学习方向，尚不是该项目的运行环境。

## 需求到实现的导航

| 领域 | 设计入口（项目根目录相对路径） | 主要实现 | 验证入口 |
|---|---|---|---|
| 相邻、建筑与修正 | `设计/SDD-局面求值器.md` | `src/evaluate.ts`、`src/rules.ts`、`src/rational.ts` | `tests/calibration.test.ts`、`tests/categories.test.ts`、`tests/crosscheck.test.ts` |
| 落位和多城 | `设计/SDD-自由模式.md` | `src/placement.ts`、`src/board.ts`、`web/app.ts` | `tests/categories.test.ts`、`tests/multicity-japan.test.ts` |
| 研究和政策 | `设计/风云变幻版本对账.md` | `web/progression.ts`、`web/app.ts`、`src/evaluate.ts` | `tests/interface-changes.test.ts` |
| 挑战与关卡 | `设计/SDD-挑战模式.md`、`设计/关卡设计.md` | `web/levels.ts`、关卡 CSV | `tests/levels.test.ts`、`设计/测试清单.md` |
| 呈现与交互 | `设计/GDD总纲.md` | `web/render.ts`、`web/index.html`、`web/brush_info.ts` | `tests/interface-changes.test.ts`，另需浏览器交互 |

数据流：配置 CSV → Rules／BoardState → 共用落位约束与 evaluate → 产出明细树 → Web UI。
CSV 在构建时内联进入 `web/dist/`，产物不手工修改。

## 质量与范围

新增或改动玩法时，根据风险验证真实可观察行为，避免仅检测某行文案存在就声称界面可用。
输入不变性、相同局面结果一致性、顺序无关性、明细加和完整性已有 `tests/invariants.test.ts`。
UI 规则预览与最终求值必须使用同一语义；先查共享代码再改界面分支。

README 中记录了关卡唯一性／旧阈值、军事待核和类型检查等缺口。
这些记录可能落后于当前工作树；要发布时逐项核实，不以旧清单或全绿测试直接判定修复。
`web/civ6-ui/SOURCE.md` 是当前官方图标来源说明。本次安装不重新导出、上传或调整素材。

## Unity 工作的入口

仅当用户明确要求迁移时读取 `studio/roles/unity-specialist.md`。
先确定 Unity 编辑器版本与目标平台，再提出独立 Unity 工程方案。
可复用 CSV 规则和跨语言对账样例；TypeScript 源码不能直接充当 Unity C# 脚本。
优先做可独立测试的 C# 求值器，再接 MonoBehaviour／UI，分步对齐网页原型。
