# 设计文档：资产记忆与回放

## 概述

本设计负责把自动驾驶系统中所有中间产物和最终产物都保存下来，并提供回放、比较、回填和时间线能力。  

它是整个 SPEC 工作流的“记忆层”，决定系统是否会越用越聪明、越看越清楚。

在本轮改造中，这一层不只保存 routes、docs 和 previews，还要把 clarification、sandbox、role、crew、capability、preview、prompt 和 mission 事件都沉淀进时间线。

## 架构

```mermaid
graph TB
    Route[RouteSet] --> Ledger[Artifact Ledger]
    Tree[SpecTree] --> Ledger
    Docs[SpecDocument] --> Ledger
    Preview[EffectPreview] --> Ledger
    Prompt[PromptPackage] --> Ledger
    Run[EngineeringRun] --> Ledger
    Events[Runtime Event Stream] --> Ledger
    Ledger --> Timeline[Timeline View]
    Ledger --> Replay[Replay Engine]
    Replay --> Diff[Diff / Compare]
    Run --> Feedback[Feedback Backfill]
    Feedback --> Route
    Feedback --> Tree
    Feedback --> Docs
    Feedback --> Timeline
```

## 核心组件

### Artifact Ledger

负责统一保存各种产物，并记录来源、版本和时间戳。  
它是项目资产的事实来源之一。  
它还要承接统一事件流的结构化事件，并把事件和产物放进同一条时间线。

### Event Timeline Ingestor

负责把 clarification.*、sandbox.*、role.*、crew.*、capability.*、route.*、spec.*、preview.*、prompt.*、mission.* 和 evidence.* 事件写入时间线。

### Replay Engine

负责将某次路线生成、文档生成或工程执行重放出来。  
重放时可以按阶段展开，也可以按单个资产查看。  
它还应支持恢复团队状态、角色状态和能力调用状态。

### Diff / Compare

负责比较两个版本之间的差异。  
可以用于路线比较、树比较、文档比较和提示词比较。

### Feedback Backfill

负责把执行结果、日志和失败信息回填到资产链上。  
这是系统持续演化的关键。

### Crew and Capability Timeline

负责把团队层和能力层状态保留为可查询的历史。  
它允许按 crewId、roleId、capabilityId、jobId、nodeId 和 version 进行复盘。

## 数据流

1. 任意一次生成或执行写入 Artifact Ledger。  
2. Runtime Event Stream 进入 Event Timeline Ingestor。  
3. Ledger 建立来源、版本和事件索引。  
4. 前端通过 Timeline 和 Replay 查看历史。  
5. 执行反馈通过 Backfill 进入路线、树、文档和时间线。  
6. 下游下一次生成会基于最新资产和事件继续演化。

## 正确性属性

- 任意产物都必须可追溯到来源资产。  
- 任意回放都应可定位到原始版本。  
- 任意回填都不应覆盖历史事实。  
- 任意关键事件都必须可落到时间线。  
- 团队层和能力层历史必须可单独查询。

## 测试策略

- 产物保存测试  
- 回放一致性测试  
- 版本比较测试  
- 事件时间线摄取测试
- 团队与能力历史查询测试
- 回填谱系测试
