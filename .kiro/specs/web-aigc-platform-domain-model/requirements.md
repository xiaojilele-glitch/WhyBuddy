# 需求文档：Web-AIGC 平台领域模型

## 目标

定义 `web-aigc` 编排平台迁移到 WhyBuddy 时的统一领域模型，作为 52 个节点 spec 的总前提。

## 需求

### 需求 1：核心实体统一

系统应统一抽象编排定义、编排版本、节点、边、执行实例、节点执行记录、关联会话、关联任务等核心实体。

### 需求 2：状态模型统一

系统应支持 `PENDING`、`EXECUTING`、`WAITING_INPUT`、`EXECUTED`、`EXCEPTION`、`FORCE_TERMINATED` 到 Cube 内部状态的标准映射。

### 需求 3：迁移兼容

系统应允许 `web-aigc` 的定义态、运行态、监控态数据结构映射到 Cube 的 `workflow / mission / replay / audit` 体系中。

### 需求 4：节点契约化

每个节点 spec 都应基于统一的输入契约、输出契约、配置契约、监控契约来定义。
