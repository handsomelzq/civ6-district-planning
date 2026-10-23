# Resource Placement and City Territory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正资源格上的区域／城市中心规则，并让多城地图拥有唯一、共享且参与区域放置判定的城市边境。

**Architecture:** `resources.csv` 表达可收获性，`Rules` 提供只读资源语义；`src/board.ts` 统一计算城市领土；`src/legality.ts` 同时消费资源与领土规则；`web/render.ts` 从同一领土映射生成边界层，`web/app.ts` 只负责清除资源交互。

**Tech Stack:** Node 24 原生 TypeScript、node:test、SVG、Python 3.9 标准库。

**Spec:** `docs/superpowers/specs/2026-10-08-resource-territory-design.md`

## Global Constraints

- 保留当前脏工作树中的地形素材、丘陵、气候和随机水系改动。
- 不修改相邻产出、人口配额、水系、随机气候、政策、科技、市政、宗教或军事规则。
- 不安装依赖，不提交、推送或部署。
- 《文明 VI》静态资源数据取风云变幻最终加载结果；Demo 领土分区明确标为产品规则。

## Review Focus

1. 城市中心落在资源上时资源不能消失。
2. 加成资源没有 `Resource_Harvests` 行时不能被错误清除。
3. 两城等距地块必须唯一归属，不能同时着色或留夹缝。
4. 领土内部边不能被误画成城市边境，共享边只能输出一次。
5. 移动中心后已有区域若跨界，完整局面校验必须给出诊断。

## Task 1: 资源配置与规则模型

**Files:** `Tools/parse_civ6_xml.py`、`Tools/check_config.py`、`配置表/resources.csv`、`配置表/字段说明.md`、`src/rules.ts`、测试夹具。

- [x] 把 `Resource_Harvests` 加入解析表，输出 `是否可收获`、`收获前置科技`。
- [x] 更新配置 schema、布尔与科技外键校验，以及干净／破损夹具。
- [x] 扩展 `Resource` 类型并加入解析回归测试。
- [x] 运行配置校验器和相关 Node 测试。

## Task 2: 唯一城市领土

**Files:** `src/board.ts`、`tests/interface-changes.test.ts`。

- [x] 先用失败测试固定同距格唯一归属、范围外中立和中心自有。
- [x] 实现 `cityTerritoryOwners(board): ReadonlyMap<string,string>`，让 `cityTerritoryOwner` 复用它。
- [x] 保持单城旧局面兼容，运行相关测试。

## Task 3: 资源与跨城合法性

**Files:** `src/legality.ts`、`src/placement.ts`、`tests/legality.test.ts`。

- [x] 先用失败测试固定战略／奢侈／可收获加成资源行为。
- [x] 城市中心移动允许资源并保留资源。
- [x] 增加 `E16b`，放置和完整局面校验共用领土归属。
- [x] 运行合法性、求值器与多城测试。

## Task 4: 清除资源交互与共享边境

**Files:** `web/app.ts`、`web/brush_info.ts`、`web/render.ts`、`web/index.html`、`tests/interface-changes.test.ts`。

- [x] 新增自由模式“清除加成资源”工具及科技不足提示。
- [x] 从领土映射输出低透明度填色和独立边境线；共享边只画一次。
- [x] 更新地块信息显示动态领土归属，不再只看区域的 `所属城市`。
- [x] 运行 UI 源码测试与渲染测试。

## Task 5: 文档、全量检查与浏览器验收

**Files:** `设计/SDD-区域合法性系统.md`、`生产/QA 报告`。

- [x] 更新 SDD 的资源类别与 `E16b`。
- [x] 运行 `node Tools/studio_check.mjs --mode smoke` 并阅读警告。
- [x] 在本地浏览器验证资源清除提示、动态领土和共享边界；城市中心资源保留由自动测试覆盖。
- [x] 运行 `git diff --check`，记录未提交／未部署状态。

状态：实现与本地验收完成；工作树仍包含此前地形、气候与随机水系改动，未提交、未推送、未部署。
