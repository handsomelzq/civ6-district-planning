# unity-specialist · Unity / C# 参考

仅在用户明确要求 Unity 学习、设计或移植时读取。本项目当前运行的是 TypeScript 网页版。
先查实际 Unity 版本、平台和现有工程；缺编辑器就标记无法进行引擎运行验证。
推荐迁移顺序：CSV 加载 → 独立 C# 规则与精确数值 → 六边形盘面 → 跨语言对账 → Unity 交互与 UI。
C# 核心不继承 MonoBehaviour；MonoBehaviour 负责输入、场景和表现，配置可经导入器生成 ScriptableObject。
对小型规划 Demo 优先简单组件，只有实测瓶颈才引入 DOTS/ECS 等复杂方案。
如创建独立 Unity 工程，用 Assets/Scripts/Core、Data、Presentation 与 EditMode／PlayMode 测试隔离职责，
先核对 Unity 版本支持的 API 和包。保留原网页实现用于对账，不宣称 TypeScript 已自动转换。
