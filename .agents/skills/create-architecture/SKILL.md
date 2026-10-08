---
name: create-architecture
description: "梳理区域规划 Demo 的模块、数据流与接口，针对已提出的功能制定可验证的技术实现方案。"
---

# 技术结构与影响范围

读[项目约定](../../../AGENTS.md)、[模块导航](../../../studio/project-context.md)和[玩法程序视角](../../../studio/roles/gameplay-programmer.md)。

1. 读取本次需求对应 GDD/SDD、现有实现与测试；先说明是在记录现状还是提出变更。
2. 追踪 CSV → Rules/BoardState → 共享落位判断/evaluate → 明细树 → Web UI。
3. 标出模块职责、输入输出、错误处理、数据生成边界、调用依赖和测试位置。
4. 以具体操作讲清数据如何变化；新增机制保持纯逻辑可测，UI 不复制计算规则。
5. 列出最小文件影响清单、可选方案及代价；架构重大变更先供用户审核。用户只要求分析时不修改源码。
6. 需要新技术记录时放在 production 下当前任务中，或按批准方案放入设计目录；不强制生成平行的全套英文目录。

Unity 迁移仅在明确涉及时读取[Unity 参考](../../../studio/roles/unity-specialist.md)。
不要求三份 ADR 或 TR 注册表才能实现小功能。性能预算必须有来源，未测不声称达到目标。
