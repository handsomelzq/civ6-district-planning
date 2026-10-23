# Random Map Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在自由模式加入可复现、可调参数、自动验收并能解释生成结果的随机地图规划器。

**Architecture:** 将现有随机地形、水域、河流和城市生成管线下沉到 `src/` 的纯逻辑模块；`src/map_generator.ts` 负责配置、预设、候选生成与有界重试，`src/map_report.ts` 只从最终局面复算统计和质量。`web/app.ts` 仅管理设置草稿、完整地图替换、撤销和报告渲染，不复制生成或合法性规则。

**Tech Stack:** Node 24 原生 TypeScript、`node:test`、原生 HTML/CSS/SVG、零新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-08-random-map-planner-design.md`

## Global Constraints

- 地图固定为半径 7、169 格；城市中心六边距离至少 4。
- 首版固定为 4 个预设、6 项三档参数、4 种极地选择、32 位无符号种子和最多 24 次候选尝试。
- 硬约束失败不替换旧地图；只有软参数偏差时展示最佳合法候选并明确警告。
- 河流必须沿真实六边格边连续通向湖海；沙漠连片；冻土只出现在一个南北边缘。
- 求值器、挑战关卡、相邻配置、政策、研究、宗教、地形素材和城市边境表现不变。
- 保留当前脏工作树中的地形素材、河流、资源和领土改动；不得重置或覆盖无关差异。
- 不安装依赖，不提交、不推送、不部署；用户另行明确要求时再执行这些外部动作。

## Fixed Target Bands

档位是软目标区间，分母均从最终地图复算。海洋以全部 169 格为分母；地势与沙漠以非水陆地为分母。

| 参数 | 低档 | 标准档 | 高档 |
|---|---|---|---|
| 海洋占比 | 6%–10% | 11%–17% | 18%–28% |
| 丘陵 + 山脉 | 10%–16% | 17%–25% | 26%–36% |
| 其中山脉 | 1%–4% | 4%–8% | 8%–13% |
| 沙漠覆盖 | 5%–9% | 10%–16% | 18%–28% |
| 资源密度 | 3%–5% | 6%–9% | 10%–14% |

河流不用地块占比：少量为 1 条、8–14 段；标准为 1 条、15–23 段；丰富为 2 条、合计 24–36 段。两条河可共享湖海出口顶点，但不得共享河段、交叉成环或产生不连续路径。

## Review Focus

1. `seed=0`、`seed=4294967295` 和超范围输入：归一化后必须确定性生成，不能把 0 当“未填写”。
2. 第二条河生成失败：丰富档候选应被淘汰或报告软偏差，不能返回断河、重复河段或挂死。
3. 极端“多海洋 + 4 城 + 崎岖”组合：24 次尝试必须有界结束，失败时旧地图保持不变且原因可读。
4. 报告与生成过程计数分离：手工修改最终局面后重新统计必须反映修改，不能复用缓存目标值。
5. 生成地图后的撤销：地图、城市、河道、文明、领袖、科技、市政、政策和宗教必须恢复为生成前状态。

---

### Task 1: 配置、预设与参数目标

**Files:**
- Create: `src/map_generator.ts`
- Create: `tests/map-generator-config.test.ts`

**Interfaces:**
- Produces: `MapGeneratorConfig`、`MapPresetId`、`MAP_PRESETS`、`MAP_GENERATOR_VERSION`、`normalizeMapConfig(input)`、`targetBands(config)`。
- Consumes: 无；该任务只定义配置语义，不生成局面。

- [ ] **Step 1: 写配置失败测试**

  覆盖四个预设的精确字段；任一字段变化得到 `preset="custom"`；城市数只接受 2/3/4；种子按 `>>> 0` 归一化且保留 0；海洋、地势、沙漠、资源档位返回上表固定区间；河流返回条数和河段区间。

- [ ] **Step 2: 运行测试并确认因接口不存在而失败**

  Run: `node --test tests/map-generator-config.test.ts`
  Expected: FAIL，提示缺少 `src/map_generator.ts` 或导出项。

- [ ] **Step 3: 实现配置模型**

  在 `src/map_generator.ts` 定义：

  ```ts
  export type MapPresetId = "balanced" | "mountain-basin" | "arid-valley" | "coastal-cities" | "custom";
  export type MapGeneratorConfig = {
    readonly preset: MapPresetId;
    readonly cityCount: 2 | 3 | 4;
    readonly ocean: "low" | "standard" | "high";
    readonly relief: "low" | "standard" | "high";
    readonly desert: "low" | "standard" | "high";
    readonly rivers: "low" | "standard" | "high";
    readonly resources: "low" | "standard" | "high";
    readonly polar: "none" | "north" | "south" | "random";
    readonly seed: number;
  };
  export const MAP_GENERATOR_VERSION = "1";
  export function normalizeMapConfig(input: MapGeneratorConfig): MapGeneratorConfig;
  export function targetBands(config: MapGeneratorConfig): MapTargetBands;
  ```

  `MAP_PRESETS` 使用设计稿 §3 的四组固定值；不接受未知枚举或非整数城市数，抛出包含字段名的 `MapConfigError`。

- [ ] **Step 4: 运行配置测试至通过**

  Run: `node --test tests/map-generator-config.test.ts`
  Expected: PASS。

### Task 2: 可配置候选生成管线

**Files:**
- Create: `src/random_rivers.ts`
- Modify: `web/random_rivers.ts`
- Modify: `src/map_generator.ts`
- Modify: `web/presets.ts:104-254`
- Create: `tests/map-generator-candidate.test.ts`
- Modify: `tests/random-map-climate.test.ts`
- Modify: `tests/random-map-rivers.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `MapGeneratorConfig` 和 `targetBands()`。
- Produces: `generateMapCandidate(config, candidateSeed): BoardState`；`generateRandomRivers(input, random, options)` 支持目标条数和总河段区间；`randomSandboxBoard(seed)` 作为均衡大陆兼容入口。

- [ ] **Step 1: 写候选生成失败测试**

  使用固定种子分别断言：精确城市数；明确 north/south/none 极地；低/标准/高档在 60 个相同种子样本中的水域、地势、沙漠和资源中位数单调；丰富河流返回 2 条且河段不重复；旧 `randomSandboxBoard(12345)` 仍可复现并返回 169 格。

- [ ] **Step 2: 运行测试并确认档位尚未生效**

  Run: `node --test tests/map-generator-candidate.test.ts tests/random-map-climate.test.ts tests/random-map-rivers.test.ts`
  Expected: FAIL，至少城市数、档位趋势、极地强制或双河断言失败。

- [ ] **Step 3: 把水系生成移到核心层**

  将 `web/random_rivers.ts` 的纯算法移到 `src/random_rivers.ts`；原文件只显式导入并重新导出，维持旧测试和浏览器模块路径。扩展签名：

  ```ts
  export type RandomRiverOptions = {
    readonly riverCount: 1 | 2;
    readonly segmentRange: readonly [number, number];
  };
  export function generateRandomRivers(
    input: ReadonlyMap<string, Tile>, random: () => number,
    options?: RandomRiverOptions,
  ): RandomRiverResult;
  ```

  第二条河必须在第一条河段集合之外寻路；无法满足时明确抛错，让候选重试层处理。

- [ ] **Step 4: 实现十阶段候选生成**

  在 `src/map_generator.ts` 实现 `generateMapCandidate()`：使用连续噪声／邻接生长产生连贯海岸和地势；极地按配置落在 `r<=-5` 或 `r>=5`；河流后生成河口低地；沙漠从单一起点连通生长；城址搜索接受精确 `cityCount`；资源只投放在合法非城市陆地。所有随机调用只使用 `candidateSeed` 初始化的 PRNG。

- [ ] **Step 5: 将旧入口改为兼容包装**

  `web/presets.ts` 保留三种手工教学环境；删除其中重复的随机算法，改为：

  ```ts
  export const randomSandboxBoard = (seed = randomSeed()): BoardState =>
    generateMapCandidate({ ...MAP_PRESETS.balanced, seed }, seed);
  ```

- [ ] **Step 6: 运行候选与既有气候／河流测试至通过**

  Run: `node --test tests/map-generator-candidate.test.ts tests/random-map-climate.test.ts tests/random-map-rivers.test.ts tests/random-rivers.test.ts tests/river-topology.test.ts tests/river-geometry.test.ts`
  Expected: PASS。

### Task 3: 最终局面报告与规划质量

**Files:**
- Create: `src/map_report.ts`
- Create: `tests/map-report.test.ts`
- Modify: `src/map_generator.ts`

**Interfaces:**
- Consumes: `Rules`、`BoardState`、`MapGeneratorConfig`、候选元数据。
- Produces: `MapGenerationReport`、`analyzeGeneratedMap(rules, board, config, metadata)`、`hardFailures(report)`、`candidateScore(report)`。

- [ ] **Step 1: 写报告失败测试**

  手工构造小局面并用字面量断言水域、陆地、丘陵、山脉、沙漠、冻土、资源类别、河流数／河段数、临河陆地比例、城市领土数和连通片区。修改一格后重新分析，断言结果变化，证明报告不读生成缓存。

- [ ] **Step 2: 写质量与异常输入测试**

  覆盖断河、无出口、重叠河段、错误极地、碎片沙漠、城数错误、城距不足、城市被封死、资源覆盖城心；每种返回稳定的检查 code 和可读中文说明。规划位检查使用全研究解锁副本调用共享 `validateDistrictPlacement()`，但不修改返回局面的研究状态。

- [ ] **Step 3: 运行测试并确认报告接口不存在**

  Run: `node --test tests/map-report.test.ts`
  Expected: FAIL，提示缺少模块或导出项。

- [ ] **Step 4: 实现纯报告模块**

  ```ts
  export function analyzeGeneratedMap(
    rules: Rules, board: BoardState, config: MapGeneratorConfig,
    metadata: { baseSeed: number; candidateSeed: number; attempts: number },
  ): MapGenerationReport;
  export function hardFailures(report: MapGenerationReport): readonly MapCheck[];
  export function candidateScore(report: MapGenerationReport): readonly number[];
  ```

  报告同时保存计数、分母和百分比；候选评分按“规划质量 → 命中项数 → 偏差 → 尝试序号”生成可稳定比较的元组。

- [ ] **Step 5: 运行报告测试至通过**

  Run: `node --test tests/map-report.test.ts`
  Expected: PASS。

### Task 4: 有界重试与失败契约

**Files:**
- Modify: `src/map_generator.ts`
- Create: `tests/map-generator-retry.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3 的候选生成和报告评分。
- Produces: `generateSandboxMap(rules, config): MapGenerationResult`、`MapGenerationError`。

- [ ] **Step 1: 写重试失败测试**

  通过可注入的候选构造器测试：首个合法且全达标候选立即返回；前 23 次硬失败、第 24 次合法可返回；24 次全部硬失败时抛 `MapGenerationError` 并包含按 code 聚合的原因；只有软偏差时选择评分最高候选并在报告中标为 warning；相同输入调用两次深度相等。

- [ ] **Step 2: 运行测试并确认正式入口不存在**

  Run: `node --test tests/map-generator-retry.test.ts`
  Expected: FAIL。

- [ ] **Step 3: 实现正式生成入口**

  ```ts
  export function generateSandboxMap(
    rules: Rules, config: MapGeneratorConfig,
    options?: { readonly buildCandidate?: CandidateBuilder; readonly maxAttempts?: number },
  ): MapGenerationResult;
  ```

  生产默认 `maxAttempts=24`；测试注入只替换候选来源，不替换报告和评分。候选种子为 `(config.seed + attempt) >>> 0`。全达标候选可提前返回；否则遍历满上限后选最佳合法候选。

- [ ] **Step 4: 用真实生成器跑组合样本**

  Run: `node --test tests/map-generator-retry.test.ts tests/map-generator-candidate.test.ts`
  Expected: PASS，且极端配置在测试时限内结束。

### Task 5: 自由模式设置面板、报告和撤销

**Files:**
- Modify: `web/app.ts:80-120, 313-388, 708-930`
- Modify: `web/index.html:186-251, 460-528`
- Create: `tests/map-generator-ui.test.ts`
- Modify: `tests/interface-changes.test.ts`

**Interfaces:**
- Consumes: `MAP_PRESETS`、`generateSandboxMap()`、`MapGenerationReport`。
- Produces: 顶部“地图生成”入口、设置草稿、生成操作、摘要／完整报告和失败提示。

- [ ] **Step 1: 写 UI 失败测试**

  断言自由模式有独立地图生成按钮和弹窗；4 张预设卡；城市、海洋、山地、沙漠、河流、资源、极地与种子控件；修改参数切换为自定义；报告显示请求／实际、计数／分母、尝试次数和警告；挑战模式不显示入口。

- [ ] **Step 2: 写状态行为测试**

  将“生成并保留上下文”和“生成失败保持旧地图”抽成可直接测试的纯函数：成功时只替换地图、城市、中心、人口、河道，保留文明、领袖、科技、市政、政策、宗教；失败返回原引用。撤销一次恢复完整旧局面，`seed=0` 能从表单提交。

- [ ] **Step 3: 运行 UI 测试并确认入口缺失**

  Run: `node --test tests/map-generator-ui.test.ts tests/interface-changes.test.ts`
  Expected: FAIL。

- [ ] **Step 4: 实现地图生成弹窗和报告**

  新增 `#map-generator-modal`、`#map-generator-content`；`App` 增加 `mapConfigDraft` 和 `mapReport`。生成成功前调用一次 `push()`，成功后保留选择的文明体系并关闭弹窗；失败不入撤销栈、不清空当前局面。软偏差报告使用 warning，不弹成硬错误。

- [ ] **Step 5: 更新 UI 样式与响应式布局**

  使用现有深色石板／金线视觉变量；预设卡在宽屏四列、窄屏一列，参数使用分段按钮，不引入滑杆。报告摘要常显，完整检查表使用原生 `<details>`；不改地图、研究树和右侧产出面板布局。

- [ ] **Step 6: 运行 UI 与构建测试至通过**

  Run: `node --test tests/map-generator-ui.test.ts tests/interface-changes.test.ts && node Tools/build_web.mjs`
  Expected: PASS，构建产出包含新模块且无语法错误。

### Task 6: 批量验收、文档与浏览器验证

**Files:**
- Create: `tests/map-generator-acceptance.test.ts`
- Modify: `设计/SDD-自由模式.md`
- Modify: `设计/GDD总纲.md`
- Modify: `README.md`
- Create: `production/random-map-planner-2026-10-08.md`

**Interfaces:**
- Consumes: 完整生成器与 UI。
- Produces: 可重复运行的验收证据和用户可读说明。

- [ ] **Step 1: 写批量验收测试**

  固定 200 个配置／种子样本验证全部硬约束；每个档位用相同 60 个种子统计中位数并验证单调；四个预设分别至少生成 20 张；对高海洋／高地势／4 城等压力组合断言在 24 次内返回或抛出结构化失败，不超时。

- [ ] **Step 2: 运行完整 Node 测试**

  Run: `npm test`
  Expected: 0 failures；记录测试总数、样本总数和任何结构化失败配置。

- [ ] **Step 3: 更新正式文档**

  在自由模式 SDD 增加配置、流程、失败与报告章节；GDD 系统清单加入“随机地图规划器”；README 更新自由模式能力和本地操作。明确这是 Demo 生成规则而不是《文明 VI》闭源算法复刻。

- [ ] **Step 4: 运行自动质量门**

  Run: `node Tools/studio_check.mjs --mode smoke && git diff --check`
  Expected: Automatic checks PASS；只允许已知且与本功能无关的配置警告。

- [ ] **Step 5: 浏览器逐项验收**

  在 `http://localhost:8123/web/` 验证四个预设、自定义档位、`seed=0`、同种子复现、生成报告、软偏差提示、硬失败保留地图和一次撤销。至少目视检查均衡大陆、山脉盆地、干旱河谷、海湾群城各一张，确认地形形态与报告吻合。

- [ ] **Step 6: 写验收记录**

  记录自动测试、浏览器检查、未达标配置、未执行项和当前 git 状态；不把本地通过写成已部署。
