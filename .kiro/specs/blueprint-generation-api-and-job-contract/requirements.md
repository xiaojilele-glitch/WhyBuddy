# 需求文档

## 简介

本规格定义 SPEC 自动驾驶系统前后端之间的生成 API 与作业契约。它负责把输入入口、澄清、路线生成、SPEC 推导、文档、预演、提示词和工程落地串成统一的异步工作流。

这一层既要支持新的 SPEC 工作流，也要尽量兼容现有的 launch / mission 风格接口。

## 术语表

- **GenerationJob**：一次异步生成作业
- **GenerationRequest**：生成请求
- **GenerationStatus**：生成状态，如 pending、running、waiting、completed、failed
- **EventPayload**：作业状态变更时推送的事件载荷

## 需求

### 需求 1：定义统一生成请求与响应契约

**用户故事：** 作为前端，我希望通过统一契约触发自动驾驶、推导和后续生成，以便界面和后台可以稳定协同。

#### 验收标准

1.1 系统 SHALL 定义输入、澄清、路线、树、文档、预演、提示词和执行的请求结构。  
1.2 系统 SHALL 为每类请求定义可追踪的 projectId、sourceId 和 version 字段。  
1.3 系统 SHALL 定义标准响应中的状态、产物引用和错误信息。  
1.4 系统 SHALL 支持步骤式生成和部分结果返回。

### 需求 2：支持异步作业状态与事件广播

**用户故事：** 作为前端，我希望作业状态能实时变化，以便工作台可以显示流程进度和分支状态。

#### 验收标准

2.1 系统 SHALL 支持 pending、running、waiting、reviewing、completed、failed 等状态。  
2.2 系统 SHALL 通过 websocket 或事件流推送状态变化。  
2.3 系统 SHALL 让前端能感知路线生成、SPEC 推导、文档生成和执行落地的当前阶段。  
2.4 系统 SHALL 支持等待用户确认的状态，不把所有步骤都强行自动化。

### 需求 3：保持向后兼容

**用户故事：** 作为现有系统维护者，我希望新契约不会破坏当前 launch / mission 逻辑，以便平滑升级。

#### 验收标准

3.1 系统 SHALL 保持现有任务类接口在兼容模式下可用。  
3.2 系统 SHALL 支持在旧接口上挂载新的 SPEC 工作流能力。  
3.3 系统 SHALL 允许渐进迁移，而不是一次性切换全部调用点。  
3.4 系统 SHALL 标记新旧契约的兼容边界。

### 需求 4：定义错误与部分成功语义

**用户故事：** 作为用户，我希望系统在某一步失败时仍然保留已完成资产，以便可以修复后继续。

#### 验收标准

4.1 系统 SHALL 定义清晰的错误码和错误阶段。  
4.2 系统 SHALL 支持步骤级部分成功和局部回退。  
4.3 系统 SHALL 保留失败时已生成的资产和事件。  
4.4 系统 SHALL 为前端提供可理解的失败解释。
## 新增改造：阶段与事件契约

### 需求 5：作业阶段要覆盖澄清、沙盒推导、运行台联动和交接态

Job contract SHALL 明确区分各阶段的状态和交接语义。

#### 验收标准

5.1 系统 SHALL 具备 clarification、route_generation、spec_tree、spec_docs、preview、prompt_packaging、engineering_handoff 等阶段。
5.2 系统 SHALL 将 `reviewing` 定义为已生成草稿、待人工确认的交接状态。
5.3 系统 SHALL 允许不同阶段带不同的 payload 和 nextAction。
5.4 系统 SHALL 保证前端可根据阶段直接决定展示内容。

### 需求 6：事件契约要覆盖运行台和证据流

统一响应 SHALL 支持将运行台、日志和证据一起推送给前端。

#### 验收标准

6.1 系统 SHALL 定义 clarification.*、sandbox.*、role.*、route.*、spec.*、scene.*、hud.*、browser.* 和 evidence.* 事件类型。
6.2 系统 SHALL 允许事件携带 jobId、routeId、selectionId、specTreeId、nodeId 和 artifactId。
6.3 系统 SHALL 允许前端按事件流驱动 3D、HUD、日志和浏览器预览。
6.4 系统 SHALL 保留失败、重试和部分成功的事件链路.
### 需求 7：扩展事件类型以覆盖 crew 与 capability

**用户故事：** 作为前端和回放层，我希望能区分团队级事件和能力级事件，这样角色面板和执行细节可以分开渲染。

#### 验收标准

7.1 系统 SHALL 定义 `crew.*`、`capability.*`、`preview.*`、`prompt.*` 和 `mission.*` 事件类型。
7.2 系统 SHALL 允许 `crew.*` 事件包含 crewId、roleIds、stage、presenceSummary 和 artifactIds。
7.3 系统 SHALL 允许 `capability.*` 事件包含 roleId、capabilityId、nodeId、stage、inputSummary 和 outputSummary。
7.4 系统 SHALL 允许 `preview.*` 事件描述未来效果预演，`prompt.*` 事件描述提示词打包，`mission.*` 事件描述工程落地交接。
7.5 系统 SHALL 允许前端按事件级别分别订阅团队状态、执行细节、预演和交接状态。
