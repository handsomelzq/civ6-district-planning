# 随机地图水系 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自由模式生成连续蜿蜒、入湖／入海的贴边河流，优先临河建城并形成温暖河口低地。

**Architecture:** 用可选整数顶点路径表达真实河道，共享边图派生兼容临河字段。水系与城市先后生成，渲染直接消费显式路径，旧配置保留回退。

**Tech Stack:** 本机Node24原生TypeScript类型剥离、node:test、现有SVG、Python标准库；零新依赖。

**Spec:** [已批准设计](random-river-system-2026-10-08-design.md)。

状态：已获用户批准，按Native执行；任务1—5完成，独立审查两项Important及修复期间发现的外围河道问题均已修复并回归验证。实际结果见[验收记录](random-river-system-2026-10-08-qa.md)。未提交、推送或部署。

## Global Constraints

- 保留现有169格地图、南北缘冻土带、连片沙漠、至少两座城市、城心六边距离至少4格。
- 本轮只生成一条主河，随机改变源头、路线和出口。
- 暂不加入支流、流量、侵蚀、洪水灾害、洪泛平原规则或新的产出加成。
- 不改政策、科技、市政、宗教、资源落位规则、菜单和美术素材，不提交、推送或部署。
- 现有未提交的地形素材、丘陵编辑、气候与贴边河流改动全部保留。
- 所有同步函数返回新局面，渲染和求值不得修改原数据。
- 百分比是固定种子1—200的Demo验收指标，不是文明VI规则。
- 生成代码只使用传入的种子随机源；不调用Math.random或依赖时间。

## Review Focus

1. 旧局面字段缺失与显式空列表不同：前者回退渲染，后者清除临河标记且不画河（任务1、4）。
2. 仅接触顶点的第三格不应取得临河加成；真实河段两岸应取得（任务1）。
3. 水陆手动转换、移动城心和撤销后，路径及临河字段不能失配（任务1、4、5）。
4. 无水出口、孤岛或全山地等异常输入不能无限寻路或静默画断河（任务2）。
5. 气候与城距回归：河口改地、湖泊和临河偏好不能切碎沙漠、冲掉极地或把城市挤在一起（任务3）。

## Task 1: 真实边图与临河兼容层

**Files:** 修改`src/board.ts`；新增`src/river.ts`、`tests/river-topology.test.ts`。

**Interfaces:**

- `src/board.ts`定义`RiverVertex = {readonly x:number; readonly y:number}`、`RiverPath = readonly RiverVertex[]`及`BoardState.河道?: readonly RiverPath[]`；x/y是整数格网，不是像素。
- `src/river.ts`导出`vertexKey(v:RiverVertex):string`、`edgeKey(a:RiverVertex,b:RiverVertex):string`、`tileVertices(p:Axial):readonly RiverVertex[]`。
- `RiverEdge = {readonly a:RiverVertex; readonly b:RiverVertex; readonly tiles:readonly string[]}`。
- `RiverGraph = {readonly vertices:ReadonlyMap<string,RiverVertex>; readonly edges:ReadonlyMap<string,RiverEdge>; readonly adjacent:ReadonlyMap<string,readonly string[]>; readonly incidentTiles:ReadonlyMap<string,readonly string[]>}`。
- `buildRiverGraph(tiles:ReadonlyMap<string,Tile>):RiverGraph`收集全部格边及共享关系；路线生成另行过滤只有一个所属格的地图外缘边。
- `riverBankKeys(tiles:ReadonlyMap<string,Tile>,paths:readonly RiverPath[]):ReadonlySet<string>`按真实边的所属格判定，两岸陆地加入，湖泊／海岸／海洋排除。不存在的边明确抛错。
- `syncRiverBanks(b:BoardState):BoardState`无路径字段时原样返回；有字段时不可变地同步全部格的兼容字段。空列表清掉全部旧临河标记。

- [x] **Step 1: 写失败测试。** 在`board({"0,0":{},"1,0":{},"0,1":{},"1,-1":{}})`上取路径`[{x:1,y:-1},{x:1,y:1},{x:0,y:2}]`：第一段属于`0,0`与`1,0`，第二段属于`0,0`与`0,1`；三格都标临河，`1,-1`只触源点，不标临河。两岸转为水后不标临河。断边、缺格报错；缺字段不改变旧局面；空列表清标记；输入Map／Tile／路径不被修改。
- [x] **Step 2: 运行失败验证。** `node --test tests/river-topology.test.ts`；记录新增模块／接口缺失的实际失败，不将语法错误作为预期行为。
- [x] **Step 3: 实现接口。** 使用设计§2整数偏移和无向规范边键；禁止像素舍入后再判断共享关系。河岸同步只改临河字段，不触碰其他属性。
- [x] **Step 4: 复跑同一测试。** 所有上述断言通过后继续。

## Task 2: 山丘源头、蜿蜒路径和湖海出口

**Files:** 新增`web/random_rivers.ts`、`tests/random-rivers.test.ts`。

**Interfaces:**

- 消费任务1的`buildRiverGraph`、`tileVertices`、`RiverGraph`与`RiverPath`。
- `RandomRiverResult = {readonly tiles:ReadonlyMap<string,Tile>; readonly paths:readonly RiverPath[]; readonly mouthLand:ReadonlySet<string>}`。
- `generateRandomRivers(tiles:ReadonlyMap<string,Tile>,random:()=>number):RandomRiverResult`返回一条源头→出口路径，以及河口低地保护集合；不负责气候、湖泊、城址或兼容临河同步。

- [x] **Step 1: 写失败测试。** 用169格草原、东南海岸、三格内陆湖和两块源区丘陵构造输入；相同随机源得到同结果。独立从格角抽边，断言每段共享两个地块、点不重复、至少两段、中途顶点不接水、最后顶点接水、没有双山峰边。温暖河口至少两格相邻且为平坦草原／平原，原输入不变。无水、只有水、只剩孤立陆地等输入明确抛错。
- [x] **Step 2: 运行失败验证。** `node --test tests/random-rivers.test.ts`；记录接口未实现的失败。
- [x] **Step 3: 实现有限寻路。** 在陆地共享边图中选山丘近源与湖／海交界出口；设置空间连贯种子代价、山谷偏好和随机走向引导，避免仅最短横线。通常选择至少8边的路线；设计最低保证仍是2边。最多32次候选尝试后枚举可达组合兜底；确无路则抛错，不生成横线替代。源区无可用地势时仅在温暖陆地补一对丘陵，移除不兼容沼泽。河口至少选两个相邻温暖陆地格转为草原／平原，保持其他合法属性和极地不变。
- [x] **Step 4: 复跑同一测试。** 包含源区补丘陵、有限失败和水面出口断言；不要引入新增规则、流量或洪泛平原。

## Task 3: 随机模板接线与临河城址

**Files:** 修改`web/presets.ts`；新增`tests/random-map-rivers.test.ts`；沿用`tests/random-map-climate.test.ts`。

**Interfaces:**

- 保持`randomSandboxBoard(seed?:number):BoardState`不变，新增返回字段仅为可选`河道`。
- 本文件导出`selectRiverCityCenters(tiles:ReadonlyMap<string,Tile>,random:()=>number):readonly Axial[]`供批量和退路测试；接收已经同步临河字段的地图。
- 消费任务2的`generateRandomRivers`；完成生成后调用任务1的`syncRiverBanks`。

- [x] **Step 1: 写失败测试。** 种子1—200每图169格、2—4城、每城为非水非山地且距原点≤5，城心两两距离4—6，至少一城临河；总体临河城市≥60%。至少80%源点接触两块及以上丘陵／山峰。出口含入湖及入海；温暖河口至少两块相邻平坦草原／平原。路径签名随种子变化且同种子可重现。至少50%路线最大偏离首尾直线达一格宽；用物理比例坐标`(sqrt(3)*x,y)`计算距离，阈值`2*sqrt(3)`。城市候选不足的合成输入明确报错，不退回可能是水／山的固定(4,0)。
- [x] **Step 2: 运行失败验证。** `node --test tests/random-map-rivers.test.ts tests/random-map-climate.test.ts`；新路径缺失的断言失败，记录既有气候基线。
- [x] **Step 3: 重排模板生成。** 基础气候→原海岸→随机三格相邻内陆湖→水系与低地→避开低地的连片沙漠→同步河岸→城址→现有资源与城市落位→最终同步河岸。湖泊只在温暖内陆候选片区，不能把冻土片区割断。保持原资源代码及已知资源问题，不顺带修复。
- [x] **Step 4: 实现城址选择。** 目标城数一次抽2—4；先尝试多组临河起点，扩展满足4—6间距的组合。以完成目标城数、临河数量、湖边数量排序，种子随机打散同分；不足目标数量时允许回退至少两城，但必须保持一城临河。非临河可选陆地兜底，禁止固定坐标或压缩间距。
- [x] **Step 5: 复跑批量与气候测试。** 输出临河比例、源头地势比例、宏观弯曲比例、出口分布的实际值；全部达标且既有5项气候回归通过后继续，不降低阈值凑通过。

## Task 4: 渲染与地形编辑同步

**Files:** 修改`web/render.ts`、`web/app.ts`、`tests/river-geometry.test.ts`；新增`tests/river-editing.test.ts`。

**Interfaces:**

- 保持`renderMap`现有签名及CSS类`river-edge`；有`河道`时按整数顶点转像素：`x*SIZE*sqrt(3)/2`、`y*SIZE/2`，精度与格角一致；缺字段才走现有旧临河轮廓适配。
- `web/app.ts`相关地形／丘陵编辑完成后的新局面调用任务1`syncRiverBanks`；不修改菜单、笔刷或其他交互。

- [x] **Step 1: 写失败测试。** 显式河道和临河轮廓不相同的小盘面，最终SVG必须逐点等于显式路径；没有字段走旧适配；空列表不画旧标记河流。素材与无素材两种分支都从最终SVG独立验证每段格边。
- [x] **Step 2: 写编辑与快照测试。** `moveCityCenter`、`withDistrict`、`withBuilding`及研究／政策／宗教的不可变更新后路径不变；地形转水后同步清该岸标记，另一岸保留，转陆恢复；存入历史的旧局面不变，取回后路径／标记恢复。另在浏览器测试真实撤销接线，不以快照单测冒充UI撤销已通过。
- [x] **Step 3: 运行失败验证。** `node --test tests/river-geometry.test.ts tests/river-editing.test.ts`；确认显式路径尚未渲染导致的失败。
- [x] **Step 4: 接线实现。** 不删除已有旧配置渲染回归；保留“200图连续一条、真实格边、城心不截断、渲染纯函数”强断言。手动改出口地形不自动重排路径；说明随机完成时入水保证与编辑后地理状态的区别。
- [x] **Step 5: 复跑本任务测试和`tests/hills-editor.test.ts`。** 全部通过，原丘陵编辑行为保持。

## Task 5: 完整回归、浏览器试玩和证据

**Files:** 新增`production/random-river-system-2026-10-08-qa.md`；构建仅重建`web/dist/`及生成独立smoke报告。

- [x] **Step 1: 运行完整自动检查。** `node Tools/studio_check.mjs --mode smoke`；等待完成，读取报告，分别记录失败／警告／实际测试总数，不沿用旧122测试结论。
- [x] **Step 2: 浏览器验证。** 重载`http://localhost:8123/web/`，进入自由模式连续生成至少5张地图；观察河道弯曲及湖海出口、点选城市确认临河、点选河岸查兼容标记、移动城心及撤销确认河线保持；地形转水／转陆及撤销确认河岸显示与最终求值一致。
- [x] **Step 3: 保存实际截图和QA记录。** 至少保留入湖、入海两个样例；记录样例来源、操作、结果及批量统计。浏览器不可用则标NOT RUN，不能宣称视觉验收通过。
- [x] **Step 4: 独立只读审查。** 执行方式选Native时，由当前agent实现全部任务后，使用真实可用子agent检查本次差异和设计验收；不授权审查者改文件。优先查可达性退路、临河错误获益、水陆编辑、气候和城距回归。
- [x] **Step 5: 交付。** 运行`git diff --check`，核对本次差异没有覆盖既有脏工作树；更新任务勾选和实际结果。给出本地试玩地址与未测事项，不提交／推送／部署。

## 自审与执行交接

设计§1—6分别由任务1—5覆盖；Review Focus全部有明确测试归属。类型、函数名、像素转换与统计范围在各任务保持一致，新增模块由现有构建脚本自动收集，无需改打包器或安装依赖。

建议Native：当前agent顺序实现，再由独立子agent只读审查。河道几何、生成、城址和渲染之间依赖紧密，顺序实现可减少接口漂移。子agent分工执行也可选，但不得并行修改同一脏文件。

用户已批准Native执行。勾选对应实际执行及验证；证据以验收记录和独立smoke报告为准，不以计划本身替代测试或浏览器结果。
