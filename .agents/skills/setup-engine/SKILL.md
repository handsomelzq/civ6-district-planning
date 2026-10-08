---
name: setup-engine
description: "核对区域规划 Demo 的实际技术栈、运行条件，或在明确要求时制定 Unity/C# 迁移方案。"
---

# 技术栈核对与引擎规划

先读[项目约定](../../../AGENTS.md)和[上下文](../../../studio/project-context.md)。

1. 检查 package.json、构建入口和实际 Node/Python 版本；若存在 Unity 工程再检查 ProjectSettings/ProjectVersion.txt 与 Packages/manifest.json。
2. 现有运行方式是 Node 原生 TypeScript + Web。用户只要求环境检查时，报告现状与缺口，不改成 Unity。
3. 用户要求 Unity 学习或移植时，读[Unity 参考](../../../studio/roles/unity-specialist.md)，明确目标平台、编辑器版本和首个验证切片。
4. 按数据、纯逻辑、表现、测试分别列出可复用资产与需要重写的部分；复用 CSV 和对账用例，C# 逻辑与 MonoBehaviour 解耦。
5. 重要工程结构或配置先给方案；批准后按最小范围实施。缺引擎运行能力时明确记录，不宣称编译或 PlayMode 已通过。

涉及引擎版本、包 API、许可时核对当前官方资料，不沿用旧模板中的收费门槛。
引擎规划不要求安装依赖；需要新增依赖时遵守用户的本机环境约定。
