# 区域合法性系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将区域合法性规则统一为结构化共享校验入口，阻止非法挑战初始局面进入游戏，并在不降低合法性规则的前提下修复 9 个非法候选解和最优布局 fixture。

**Architecture:** 新增纯逻辑模块 `src/legality.ts`，把地块、城市、玩家和研究层的区域放置检查统一输出为 `LegalityIssue[]`。`src/evaluate.ts` 和 `web/levels.ts` 使用完整局面校验，`web/app.ts` 使用带交互上下文的放置校验；挑战预算和不可拆除初始区域仍属于模式层。共享校验稳定后，让关卡设计脚本过滤非法候选布局并重新生成最优解 fixture、阈值和基线。

**Tech Stack:** TypeScript + Node 24 原生类型剥离、Node `node:test`、Python 3 标准库关卡工具、CSV 配置、现有 Web 构建脚本。

**Spec:** `设计/SDD-区域合法性系统.md`

## Global Constraints

- 保留工作树中与本任务无关的既有未提交改动，不使用 `git reset --hard` 或 `git checkout --`。
- `withDistrict()` 继续是不可变数据构造函数，不在其中强制执行全部合法性校验。
- 本计划不实现人口区域配额、资源覆盖冲突、自然奇观 / 世界奇观完整占地冲突或建筑前置链。
- 不能通过删除 `E17b`、把错误降级为警告或绕过校验来保留旧关卡阈值。
- 不新增运行时依赖；继续使用 Node 内置测试和 Python 标准库工具。
- 中文 UI 文案由结构化错误集中生成，调用方不解析中文字符串决定逻辑。
- 关卡搜索、产品求值和 Web 加载必须按文明替换后的有效区域 id 计算区域上限。

## Review Focus

- 同一放置同时违反地块、研究和上限约束时，返回稳定且可解释的错误顺序；由 Task 1/2 的顺序测试固定。
- 多城中同类区域分属不同城市时应合法，但同城重复仍报 `E17c`；由 Task 2 的多城测试固定。
- 韩国学院替换为书院后，全局上限必须按书院计数；由 Task 2/3 的文明替换测试固定。
- 非法初始局面必须显示原因但不能进入挑战流程；由 Task 4 的加载和 UI 行为测试固定。
- 最优候选布局也必须合法，且不能只满足合法性检查而丢失原有母题、目标阈值和对照关判据；由 Task 5/6 的关卡回归测试固定。

---

### Task 1: 建立结构化合法性核心

**Files:**
- Create: `src/legality.ts`
- Modify: `src/placement.ts`
- Test: `tests/legality.test.ts`

**Interfaces:**
- Consumes: `Rules`、`BoardState`、`Tile`、`City`、`districtPlacementConstraint()`、`inWorkRange()`、`districtPositions()`、`cityFor()`。
- Produces: `LegalityLayer`、`LegalitySeverity`、`LegalityIssue`、`PlacementContext`、`validateDistrictPlacement()`、`validateBoard()`，供后续 UI、求值器和关卡加载使用。

- [ ] **Step 1: 写共享入口的失败测试**

在 `tests/legality.test.ts` 添加以下测试：

- `validateDistrictPlacement()` 对不存在坐标返回 `E00`；
- 已有区域返回 `E01`；
- 全局不可建地形返回 `E02`；
- 区域专属地形返回 `E03`；
- 不可建地貌返回 `E04`；
- 军营 / 城池紧邻城市中心返回 `E05`；
- 水渠缺少城市中心或淡水返回 `E06`；
- 超出 3 格工作范围返回 `E16`；
- 未解锁科技与市政分别返回 `E14t`、`E14c`；
- 一城重复区域返回 `E17c`；
- 全局唯一区域返回 `E17b`；
- 多城分属不同城市时不返回 `E17c`；
- 同一局面多项错误按规格中的固定顺序返回。

断言同时检查 `code`、`layer`、`position`、`districtId` 和可读 `message`，不要只检查中文文案。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/legality.test.ts`

Expected: FAIL，因为 `src/legality.ts` 尚不存在。

- [ ] **Step 3: 实现 `src/legality.ts`**

实现：

```ts
export type LegalityLayer =
  | "地块" | "城市" | "玩家" | "研究" | "模式";

export type LegalitySeverity = "错误" | "警告";

export type LegalityIssue = {
  readonly code: string;
  readonly layer: LegalityLayer;
  readonly severity: LegalitySeverity;
  readonly message: string;
  readonly position?: Axial;
  readonly districtId?: string;
  readonly cityId?: string;
};

export type PlacementContext = {
  readonly mode?: "自由" | "挑战";
  readonly selectedCityId?: string;
  readonly challengeBudgetRemaining?: number;
};

export function validateDistrictPlacement(
  rules: Rules,
  board: BoardState,
  position: Axial,
  districtId: string,
  context?: PlacementContext,
): LegalityIssue[];

export function validateBoard(
  rules: Rules,
  board: BoardState,
): LegalityIssue[];
```

将现有地块级判断复用到结构化结果中；不通过解析旧的中文字符串来生成错误码。`validateBoard()` 先做全局 / 分城计数，再逐个区域检查工作范围和地块级规则，保留所有问题而不是只返回首个问题。

- [ ] **Step 4: 保留 `src/placement.ts` 的兼容边界**

让 `districtPlacementConstraint()` 继续提供空字符串 / 首个地块级原因的旧接口，内部可复用 `src/legality.ts` 的地块级辅助函数，但不能反向依赖 Web。

- [ ] **Step 5: 运行核心测试**

Run: `node --test tests/legality.test.ts`

Expected: PASS，覆盖所有本阶段错误码和稳定顺序。

- [ ] **Step 6: Commit**

```bash
git add src/legality.ts src/placement.ts tests/legality.test.ts
git commit -m "feat: add structured district legality validation"
```

### Task 2: 迁移求值器并统一非法诊断

**Files:**
- Modify: `src/evaluate.ts`
- Modify: `tests/categories.test.ts`
- Modify: `tests/multicity-japan.test.ts`
- Test: `tests/legality.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `validateBoard(rules, board)` 与 `LegalityIssue`。
- Produces: `YieldTree.诊断` 中稳定、可读、可追溯的合法性诊断；产出树行为保持不变。

- [ ] **Step 1: 写迁移前失败 / 回归测试**

补充测试：

- `evaluate()` 将 `validateBoard()` 的 `E16`、`E05`、`E06`、`E17c`、`E17b` 转换为现有 `Diagnostic` 结构；
- 同一非法局面中所有合法性错误均保留；
- `evaluate()` 不检查挑战预算；
- 非法区域仍保留在产出树中，不被静默删除；
- 现有 `checkAdditive()`、I1–I4 和多城唯一性行为不变。

- [ ] **Step 2: 实现求值器迁移**

在 `evaluate()` 的合法性阶段调用 `validateBoard()`，集中转换为现有 `Diagnostic` 格式。删除或停止维护与共享入口重复的唯一性 / 地块合法性分支，但保留产出计算所需的诊断上下文。不要改变相邻加成、文明替换、建筑继承或有理数计算。

- [ ] **Step 3: 运行求值器回归**

Run: `node --test tests/categories.test.ts tests/multicity-japan.test.ts tests/invariants.test.ts`

Expected: PASS，且产出数值与原有结果一致。

- [ ] **Step 4: Commit**

```bash
git add src/evaluate.ts tests/categories.test.ts tests/multicity-japan.test.ts tests/legality.test.ts
git commit -m "refactor: route evaluator legality diagnostics through shared validator"
```

### Task 3: 迁移 Web 放置判断

**Files:**
- Modify: `web/app.ts`
- Modify: `web/brush_info.ts`
- Modify: `tests/interface-changes.test.ts`
- Modify: `tests/legality.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `validateDistrictPlacement()`、`LegalityIssue[]`。
- Produces: UI 的禁用地图、点击反馈和研究弹窗都由结构化问题生成。

- [ ] **Step 1: 写 UI 共享判断测试**

测试：

- `blockReason()` 使用统一校验结果；
- 区域置灰原因与 `validateDistrictPlacement()` 的首个错误一致；
- 科技与市政缺口可以合并成一个研究弹窗；
- 挑战预算耗尽返回 `G5`；
- 现有“移动城市中心”逻辑不被区域校验迁移破坏。

- [ ] **Step 2: 迁移 `web/app.ts`**

删除 `blockReason()` 中重复的研究、工作范围、每城和每玩家计数逻辑，改为调用 `validateDistrictPlacement()`，将挑战模式剩余预算通过 `PlacementContext` 传入。保留挑战模式初始区域不可拆除的 `G4` 判断在移除交互层，不把它伪装成区域落位错误。

- [ ] **Step 3: 集中生成文案**

新增或调整 UI 辅助函数，把 `LegalityIssue` 转为地图提示和研究弹窗；逻辑只看 `code` / `layer`，不通过正则匹配中文文案。

- [ ] **Step 4: 运行 UI 相关测试和构建**

Run: `node --test tests/interface-changes.test.ts tests/legality.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/app.ts web/brush_info.ts tests/interface-changes.test.ts tests/legality.test.ts
git commit -m "refactor: use shared legality results for district placement UI"
```

### Task 4: 拦截非法挑战关卡

**Files:**
- Modify: `web/levels.ts`
- Modify: `web/app.ts`
- Modify: `tests/levels.test.ts`
- Modify: `tests/interface-changes.test.ts`

**Interfaces:**
- Consumes: Task 1/2 的 `validateBoard()` 或其转换后的诊断。
- Produces: 关卡状态中的 `可开始` / 问题信息；非法初始局面不进入挑战模式。

- [ ] **Step 1: 写关卡加载失败测试**

添加测试验证：

- 构造一个非法初始局面的测试 fixture，确认它进入 `problems`；
- 合法关卡没有合法性错误；
- 关卡状态暴露可开始标志或等价的不可开始信息；
- `startLevel()` 对不可开始关卡不切换到游戏界面；
- 加载问题仍显示具体错误原因。

- [ ] **Step 2: 修改 `Level` 与 `loadLevels()`**

在 `Level` 中增加只读合法性状态，例如 `可开始: boolean` 和 `问题: readonly string[]`，或者使用等价的现有项目风格。加载时调用共享校验；G1/G2/G3 与合法性问题统一进入该关卡状态。不要让 `levels` 继续包含一个可点击但非法的可玩关卡。

- [ ] **Step 3: 修改关卡列表与 `startLevel()`**

非法关卡显示禁用开始按钮和问题摘要；`startLevel()` 再做一次防御性检查，非法状态直接返回，不改变当前游戏界面。

- [ ] **Step 4: 保留候选解问题的临时回归基线**

在候选解 fixture 尚未重做前，暂时保留 `KNOWN_E17B`，但新增断言区分初始局面合法性与最优候选布局合法性；不要把当前候选解违规误报为初始加载错误。

- [ ] **Step 5: 运行关卡测试**

Run: `node --test tests/levels.test.ts tests/interface-changes.test.ts`

Expected: 合法的当前初始关卡继续通过；独立的非法加载 fixture 被拦截；候选解相关回归仍按当前 `KNOWN_E17B` 记录，等待 Task 6 清空。

- [ ] **Step 6: Commit**

```bash
git add web/levels.ts web/app.ts tests/levels.test.ts tests/interface-changes.test.ts
git commit -m "feat: block invalid challenge levels at load time"
```

### Task 5: 让关卡设计工具和最优解 fixture 遵守区域唯一性

**Files:**
- Modify: `Tools/design_levels.py`
- Modify: `Tools/prototype_eval.py`
- Create: `Tools/test_design_levels.py`

**Interfaces:**
- Consumes: 与产品规则一致的有效区域替换、每城上限、每玩家上限判断。
- Produces: 只包含合法区域布局的 `frontier()`、`greedy()`、多产出枚举和导出结果。

- [ ] **Step 1: 写关卡搜索失败测试**

新增 Python 测试：

- 预算内重复放置同一 `OnePerCity` 区域不会被枚举；
- 两座市政广场不会被枚举；
- 两个基础学院在韩国下按两座书院计数；
- 允许 `OnePerCity=false` 的区域重复；
- 搜索结果与产品端有效区域 id 规则一致。

- [ ] **Step 2: 实现原型合法性过滤**

在 `Tools/prototype_eval.py` 或其现有 Board 辅助逻辑中增加最小合法性判断，优先复用 CSV 解析出的 `每城上限`、`每玩家上限` 和 `effective()`。`frontier()`、`enumerate_layouts()`、`greedy()` 在尝试扩展局面前过滤非法候选，不改变产出公式。

- [ ] **Step 3: 运行工具测试**

Run: `python3 -m unittest Tools/test_design_levels.py`

Expected: PASS，且旧关卡生成结果会因非法重复区域被排除而发生预期变化。

- [ ] **Step 4: Commit**

```bash
git add Tools/design_levels.py Tools/prototype_eval.py Tools/test_design_levels.py
git commit -m "fix: enforce district uniqueness during level search"
```

### Task 6: 重做 9 个挑战关卡并更新证据

**Files:**
- Modify: `配置表/levels.csv`
- Modify: `配置表/level_tiles.csv`
- Modify: `tests/fixtures/levels_oracle.json`
- Modify: `设计/关卡设计.md`
- Modify: `README.md`
- Modify: `progress.md`
- Modify: `tests/levels.test.ts`
- Test: `Tools/test_design_levels.py`

**Interfaces:**
- Consumes: Task 4 的初始关卡加载拦截、Task 5 的合法布局搜索。
- Produces: 9 个初始局面合法、最优候选布局合法的挑战关卡，保留或明确记录每关母题、目标、阈值和基线。

- [ ] **Step 1: 先运行旧关卡生成与记录失败**

Run: `python3 Tools/design_levels.py`

记录每关原最优布局、候选空间、非法原因和可保留的母题；初始 `level_tiles.csv` 只在确有变化时更新，不直接把旧产物当作新数据。

- [ ] **Step 2: 为每关选择合法候选组合**

按 SDD 的修复原则逐关处理：

- L-01/L-02/L-03/L-05：用不同区域承担山脉、抱团、枢纽、组团母题；
- L-06/L-07：市政广场最多一座，使用其他区域保留复合相邻目标；
- L-08/L-09：重建德国 / 韩国对照关，保持不同文明交叉代入劣化；
- L-10：使用合法区域组合同时满足科技和信仰目标。

每个候选布局先通过共享规则等价的原型校验，再进入阈值计算。

- [ ] **Step 3: 生成关卡配置与 fixture**

使用 `Tools/design_levels.py` 或其修复后的输出流程生成：

- 初始地块；
- 目标值；
- 二星 / 三星阈值；
- 贪心基线；
- 最优布局 fixture。

- [ ] **Step 4: 更新关卡说明**

在 `设计/关卡设计.md` 中记录每关新的合法区域组合和母题变化；在 `README.md`、`progress.md` 中删除“9 关全部非法”的当前状态，改为实际验证结果。保留历史原因和修复日期，不伪造游戏内实测。

- [ ] **Step 5: 清理候选解冻结集合并运行关卡测试**

删除 `KNOWN_E17B`，改为对所有最终最优候选布局断言无 `E17b` 错误；同时保留初始局面加载合法性、阈值、普通关贪心失败和对照关双向劣化断言。

Run: `node --test tests/levels.test.ts`

Expected:

- 9 个关卡初始局面 `errs === []`；
- 9 个最优候选布局 `errs === []`；
- 所有阈值与 fixture 最优产出一致；
- 普通关贪心基线低于目标；
- 对照关双向代入仍劣化；
- 不再存在 `KNOWN_E17B`。

- [ ] **Step 6: Commit**

```bash
git add 配置表/levels.csv 配置表/level_tiles.csv tests/fixtures/levels_oracle.json \
  设计/关卡设计.md README.md progress.md tests/levels.test.ts
git commit -m "fix: rebuild challenge levels with legal district layouts"
```

### Task 7: 全量验证与交付记录

**Files:**
- Create: `production/qa/legality-system-<timestamp>.md`
- Modify: none unless verification reveals a scoped regression

**Interfaces:**
- Consumes: Tasks 1–6 的代码、配置和测试。
- Produces: 可复现的验证记录；不宣称尚未完成的人口、资源或奇观规则已解决。

- [ ] **Step 1: 运行单元测试**

Run: `npm test`

Expected: 全部测试通过，且测试数量较当前基线增加合法性与关卡校验覆盖。

- [ ] **Step 2: 运行配置与工具校验**

Run:

```bash
python3 Tools/check_config.py --mode dev
python3 Tools/test_check_config.py
python3 Tools/check_links.py
```

Expected: 配置错误为 0，校验器回归通过，本地链接无坏链；军事表缺失等既有警告单独记录。

- [ ] **Step 3: 构建 Web**

Run:

```bash
node Tools/build_web.mjs
node --check web/dist/app.bundle.js
git diff --check
```

Expected: 构建成功、浏览器包语法通过、无空白错误。

- [ ] **Step 4: 运行项目 smoke / gate**

Run:

```bash
node Tools/studio_check.mjs --mode smoke
node Tools/studio_check.mjs --mode gate
```

Expected: 记录通过、失败和未执行项目；若 gate 因本阶段明确非目标失败，不将其误报为已完成。

- [ ] **Step 5: 写验证报告并提交**

在 `production/qa/legality-system-<timestamp>.md` 记录：

- 代码与配置版本；
- 测试命令和结果；
- 9 关合法性结果；
- 已知警告；
- 尚未实现的人口配额、资源 / 奇观冲突；
- 未做游戏内实测的事项。

```bash
git add production/qa/legality-system-<timestamp>.md
git commit -m "qa: verify district legality system"
```
