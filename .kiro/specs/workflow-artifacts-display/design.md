<!--
 * @Author: wangchunji
 * @Date: 2026-04-09 09:16:43
 * @Description: 
 * @LastEditTime: 2026-04-09 09:24:19
 * @LastEditors: wangchunji
-->
# 设计文档：工作流产物展示与下载

## 概述

本功能为 WhyBuddy 平台补齐 Docker 执行器产物（artifacts）的完整展示与下载链路。当前执行器回调已将产物元信息写入 MissionRecord.artifacts，但前端仅在 ExecutorStatusPanel 中做了简单列表展示，缺少下载、预览和实时更新能力。

本设计新增三个服务端 REST API 端点（列表查询、文件下载、内容预览），扩展前端 WorkflowPanel 和 TaskDetailView 中的产物展示区域，并利用现有 Socket.IO `mission_event` 通道实现产物列表的实时推送。

### 设计决策

1. **API 挂载在现有 tasks 路由下**：产物从属于 Mission，路径 `/api/tasks/:missionId/artifacts/*` 与现有 `/api/tasks/:id/events`、`/api/tasks/:id/decisions` 保持一致，无需新建路由文件。
2. **基于索引定位 artifact**：MissionRecord.artifacts 是有序数组，使用数组索引作为 artifact 标识符，避免引入额外 ID 字段。
3. **复用现有 Socket 通道**：`mission.record.updated` 事件已包含完整 MissionRecord（含 artifacts 字段），前端只需在 store 更新时检测 artifacts 变化即可，无需新增 Socket 事件类型。
4. **路径安全校验复用 access-guard 模式**：拒绝包含 `..` 的路径，与项目现有安全规范一致。

## 架构

```mermaid
graph TB
    subgraph 执行器
        EX[Lobster Executor] -->|HMAC 回调| CB[/api/executor/events]
    end

    subgraph 服务端
        CB -->|normalizeExecutorArtifacts| MR[MissionRuntime]
        MR -->|Socket mission_event| SO[Socket.IO]
        MR -->|patchMissionExecution| MS[MissionStore]

        TR[Tasks Router] -->|GET .../artifacts| AH[Artifact 列表 Handler]
        TR -->|GET .../artifacts/:index/download| DH[下载 Handler]
        TR -->|GET .../artifacts/:index/preview| PH[预览 Handler]

        AH --> MS
        DH -->|fs.createReadStream| FS[本地文件系统]
        PH -->|fs.read + 截断| FS
    end

    subgraph 前端
        SO -->|mission.record.updated| TS[tasks-store]
        TS --> WP[WorkflowPanel Artifact 区块]
        TS --> TD[TaskDetailView Artifacts Tab]
        WP -->|fetch| TR
        TD -->|fetch| TR
    end
```

### 数据流

1. 执行器通过 HMAC 签名回调将 artifacts 元信息发送到 `/api/executor/events`
2. 服务端 `normalizeExecutorArtifacts()` 校验并写入 MissionRecord
3. MissionRuntime 通过 Socket.IO 广播 `mission.record.updated`，payload 包含完整 MissionRecord
4. 前端 tasks-store 接收更新，`buildMissionArtifacts()` 重建 TaskArtifact 数组
5. 用户点击下载/预览时，前端调用 REST API 获取文件内容

## 组件与接口

### 服务端 API

#### 1. Artifact 列表查询

```
GET /api/tasks/:missionId/artifacts
```

**响应 200：**
```json
{
  "ok": true,
  "missionId": "m-abc123",
  "artifacts": [
    {
      "index": 0,
      "kind": "file",
      "name": "main.py",
      "path": "workspace/main.py",
      "description": "Generated Python script",
      "downloadUrl": "/api/tasks/m-abc123/artifacts/0/download"
    }
  ]
}
```

**错误响应：**
- 404：Mission 不存在

#### 2. Artifact 文件下载

```
GET /api/tasks/:missionId/artifacts/:index/download
```

**行为：**
- kind 为 `file`/`report`/`log`：流式返回文件内容，设置 `Content-Disposition: attachment`
- kind 为 `url`：302 重定向到目标 URL
- 路径安全校验：拒绝包含 `..` 的路径，返回 403
- 文件不存在：返回 404

**Content-Type 映射：**

| 扩展名 | Content-Type |
|--------|-------------|
| .json | application/json |
| .md | text/markdown |
| .log | text/plain |
| .py / .ts / .js | text/plain |
| .html | text/html |
| 其他 | application/octet-stream |

#### 3. Artifact 内容预览

```
GET /api/tasks/:missionId/artifacts/:index/preview
```

**行为：**
- 返回文本内容，不设置 `Content-Disposition`（不触发下载）
- 文件 > 1MB 时截断，响应头附加 `X-Truncated: true`
- 二进制文件返回 415
- 路径安全校验同下载接口

### 前端组件

#### ArtifactListBlock

可复用的产物列表展示组件，用于 WorkflowPanel 和 TaskDetailView。

```typescript
interface ArtifactListBlockProps {
  missionId: string;
  artifacts: TaskArtifact[];
  missionStatus: MissionStatus;
  variant: "compact" | "full";
}
```

**职责：**
- 渲染产物列表，每项显示 name、kind 标签、description
- kind 为 `file`/`report`/`log` 时提供下载按钮
- kind 为 `url` 时提供外部链接按钮
- kind 为 `report` 且 Mission 已完成时突出显示，提供预览+下载双按钮
- Mission 处于 `running` 状态时显示脉冲指示器
- 新增 artifact 时应用 Framer Motion 入场动画
- 使用 glass-panel 容器 + GlowButton 下载按钮

#### ArtifactPreviewDialog

模态弹窗组件，用于内联预览 artifact 内容。

```typescript
interface ArtifactPreviewDialogProps {
  missionId: string;
  artifactIndex: number;
  artifactName: string;
  format: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

**职责：**
- 调用 `/api/tasks/:missionId/artifacts/:index/preview` 获取内容
- MD 格式渲染为富文本（使用 react-markdown 或简单 HTML 转换）
- JSON 格式渲染为格式化代码块（语法高亮）
- 日志格式渲染为等宽字体文本
- 显示截断提示（当 `X-Truncated: true` 时）

### tasks-store 扩展

扩展 `buildMissionArtifacts()` 函数，为每个 artifact 生成 `downloadUrl`：

```typescript
function buildMissionArtifacts(mission: MissionRecord): TaskArtifact[] {
  return (mission.artifacts || []).map((artifact, index) => ({
    // ...现有字段
    downloadUrl: `/api/tasks/${mission.id}/artifacts/${index}/download`,
    previewUrl: `/api/tasks/${mission.id}/artifacts/${index}/preview`,
    downloadKind: artifact.url ? "external" : artifact.path ? "server" : undefined,
    href: artifact.url || (artifact.path ? `/api/tasks/${mission.id}/artifacts/${index}/download` : undefined),
  }));
}
```

## 数据模型

### 现有类型（无需修改）

```typescript
// shared/mission/contracts.ts — 已存在
interface MissionArtifact {
  kind: "file" | "report" | "url" | "log";
  name: string;
  path?: string;
  url?: string;
  description?: string;
}
```

### API 响应类型（新增）

```typescript
// shared/mission/contracts.ts — 新增
interface ArtifactListItem extends MissionArtifact {
  index: number;
  downloadUrl: string;
}

interface ArtifactListResponse {
  ok: true;
  missionId: string;
  artifacts: ArtifactListItem[];
}
```

### 前端类型扩展

```typescript
// client/src/lib/tasks-store.ts — TaskArtifact 扩展
interface TaskArtifact {
  // ...现有字段
  downloadUrl?: string;   // 新增：服务端下载 URL
  previewUrl?: string;    // 新增：服务端预览 URL
}
```

### MIME 类型映射

```typescript
const EXTENSION_MIME_MAP: Record<string, string> = {
  ".json": "application/json",
  ".md": "text/markdown",
  ".log": "text/plain",
  ".txt": "text/plain",
  ".py": "text/plain",
  ".ts": "text/plain",
  ".js": "text/plain",
  ".html": "text/html",
  ".css": "text/css",
  ".csv": "text/csv",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
};

// 用于判断是否为文本文件（预览接口使用）
const TEXT_MIME_PREFIXES = ["text/", "application/json", "application/xml"];
```

### 文件存储路径约定

产物文件存储在 `tmp/lobster-executor/jobs/<missionId>/<jobId>/` 目录下。artifact.path 字段存储的是相对于 job 工作目录的路径。服务端需要将 artifact.path 解析为绝对路径：

```
absolutePath = path.join(
  process.cwd(),
  "tmp/lobster-executor/jobs",
  missionId,
  jobId,
  artifact.path
)
```

其中 jobId 从 MissionRecord.executor.jobId 获取。


## 正确性属性

*属性（Property）是在系统所有合法执行路径上都应成立的特征或行为——本质上是对系统应做什么的形式化陈述。属性是人类可读规格说明与机器可验证正确性保证之间的桥梁。*

### Property 1: Artifact 列表 round-trip

*对于任意* MissionRecord 及其 artifacts 数组，通过列表 API 查询返回的每个条目应包含与原始 MissionArtifact 一致的 kind、name、path、description 字段，并且每个条目应附带格式正确的 downloadUrl（`/api/tasks/{missionId}/artifacts/{index}/download`）。

**Validates: Requirements 1.1, 1.4**

### Property 2: 文件下载内容一致性

*对于任意* 存在于磁盘上的 artifact 文件，通过下载 API 获取的响应体内容应与磁盘上的原始文件内容字节一致，且响应头应包含 `Content-Disposition: attachment; filename="<artifact.name>"`。

**Validates: Requirements 2.1, 2.3**

### Property 3: Content-Type 扩展名映射

*对于任意* 文件扩展名，下载 API 返回的 Content-Type 应与预定义的 EXTENSION_MIME_MAP 映射表一致；未在映射表中的扩展名应返回 `application/octet-stream`。

**Validates: Requirements 2.2**

### Property 4: 路径遍历拒绝

*对于任意* 包含 `..` 路径片段的 artifact path，下载 API 和预览 API 均应返回 HTTP 403 状态码，且不应读取任何文件内容。

**Validates: Requirements 2.5, 7.4**

### Property 5: UI 产物列表渲染完整性

*对于任意* 非空的 TaskArtifact 数组，ArtifactListBlock 组件渲染后的列表项数量应等于输入数组长度，且每个列表项的 DOM 中应包含对应 artifact 的 name 文本和 kind 标签文本。

**Validates: Requirements 3.1, 3.2**

### Property 6: 操作按钮类型正确性

*对于任意* TaskArtifact，当 kind 为 `file`、`report` 或 `log` 时应渲染下载按钮；当 kind 为 `url` 时应渲染外部链接按钮；当 kind 为 `report` 时应同时渲染预览按钮和下载按钮。

**Validates: Requirements 3.3, 3.4, 5.2**

### Property 7: Socket 广播 artifacts 一致性

*对于任意* 包含 artifacts 字段的 Executor 回调事件，经 normalizeExecutorArtifacts 处理后写入 MissionRecord 的 artifacts 应与回调中的有效 artifact 条目一一对应，且通过 Socket 广播的 MissionRecord 应包含更新后的 artifacts 数组。

**Validates: Requirements 6.1**

### Property 8: 预览截断

*对于任意* 大于 1MB 的文本文件，预览 API 返回的内容长度应不超过 1MB，且响应头应包含 `X-Truncated: true`。

**Validates: Requirements 7.2**

### Property 9: 二进制文件拒绝预览

*对于任意* MIME 类型不以 `text/` 开头且不属于 `application/json`、`application/xml` 的 artifact 文件，预览 API 应返回 HTTP 415 状态码。

**Validates: Requirements 7.3**

## 错误处理

### 服务端错误处理

| 场景 | HTTP 状态码 | 错误信息 | 处理方式 |
|------|-----------|---------|---------|
| missionId 不存在 | 404 | `Mission not found: {missionId}` | 直接返回 |
| artifact index 越界 | 404 | `Artifact not found at index {index}` | 校验数组边界 |
| artifact.path 为空 | 404 | `Artifact has no file path` | 检查 path 字段 |
| 文件不存在于磁盘 | 404 | `Artifact file not found` | fs.access 预检 |
| 路径包含 `..` | 403 | `Path traversal not allowed` | 正则校验 |
| 二进制文件预览 | 415 | `Binary files cannot be previewed` | MIME 类型检查 |
| 文件读取 I/O 错误 | 500 | `Failed to read artifact file` | try-catch + 日志 |

### 前端错误处理

| 场景 | 处理方式 |
|------|---------|
| 列表 API 返回 404 | 显示空状态，不渲染产物区块 |
| 下载 API 返回错误 | 恢复按钮状态，显示 toast 提示 |
| 预览 API 返回 415 | 在弹窗中显示"此文件类型不支持预览" |
| 预览 API 返回 404 | 在弹窗中显示"文件不存在" |
| 网络超时 | 恢复按钮状态，显示重试提示 |

## 测试策略

### 属性测试（Property-Based Testing）

使用 `fast-check` 库，每个属性测试运行至少 100 次迭代。

每个正确性属性对应一个属性测试，测试文件标注格式：
`Feature: workflow-artifacts-display, Property {number}: {property_text}`

| 属性 | 测试方法 | 生成器 |
|------|---------|--------|
| P1: 列表 round-trip | 生成随机 MissionRecord + artifacts，调用列表构建函数，验证输出字段一致性 | `fc.array(arbMissionArtifact)` |
| P2: 下载内容一致性 | 生成随机文件内容写入临时目录，通过 handler 读取，比较字节 | `fc.uint8Array()` + `fc.string()` |
| P3: Content-Type 映射 | 生成随机扩展名，验证映射函数输出 | `fc.constantFrom(...knownExtensions)` + `fc.string()` |
| P4: 路径遍历拒绝 | 生成包含 `..` 的随机路径，验证校验函数返回 false | `fc.string()` 组合 `..` 片段 |
| P5: UI 列表渲染 | 生成随机 TaskArtifact 数组，渲染组件，验证 DOM 节点数量和文本 | `fc.array(arbTaskArtifact, {minLength: 1})` |
| P6: 按钮类型 | 生成随机 kind 值的 artifact，验证渲染的按钮类型 | `fc.constantFrom("file","report","log","url")` |
| P7: Socket artifacts | 生成随机 ExecutorEvent + artifacts，验证 normalize 后写入 MissionRecord | `fc.array(arbExecutorArtifact)` |
| P8: 预览截断 | 生成大于 1MB 的随机文本，验证截断行为 | `fc.string({minLength: 1_048_577})` |
| P9: 二进制拒绝 | 生成随机非文本 MIME 类型，验证返回 415 | `fc.constantFrom(binaryMimeTypes)` |

### 单元测试

| 测试场景 | 类型 | 覆盖需求 |
|---------|------|---------|
| missionId 不存在返回 404 | example | 1.2 |
| artifacts 为空返回空数组 | edge-case | 1.3 |
| artifact path 为空返回 404 | edge-case | 2.4 |
| kind 为 url 时 302 重定向 | example | 2.6 |
| artifacts 为空时不渲染区块 | edge-case | 3.6 |
| log artifact 内联预览 | example | 4.2 |
| JSON report 内联预览 | example | 4.3 |
| 下载中按钮加载状态 | example | 4.5 |
| completed Mission 报告突出显示 | example | 5.1 |
| 预览弹窗渲染 | example | 5.3 |
| running 状态脉冲指示器 | example | 6.4 |

### 测试文件组织

```
server/tests/
  workflow-artifacts-display-p1.test.ts   # P1: 列表 round-trip
  workflow-artifacts-display-p2.test.ts   # P2: 下载一致性
  workflow-artifacts-display-p3.test.ts   # P3: Content-Type 映射
  workflow-artifacts-display-p4.test.ts   # P4: 路径遍历
  workflow-artifacts-display-p7.test.ts   # P7: Socket artifacts
  workflow-artifacts-display-p8.test.ts   # P8: 预览截断
  workflow-artifacts-display-p9.test.ts   # P9: 二进制拒绝

client/src/components/__tests__/
  artifact-list-block.test.tsx            # P5: UI 列表渲染 + P6: 按钮类型
  artifact-preview-dialog.test.tsx        # 单元测试：预览弹窗
```
