# Skill HTTP Bridge Design

## Goal

在 Trae 沙盒内打通一条最小可验证链路：

- 用户触发一个 Skill
- Skill 调用当前项目暴露的 HTTP API
- HTTP API 返回结构化 JSON
- Skill 把结果整理后返回给用户

本阶段只验证“同一沙盒内 Skill 可以稳定调用一体化项目的后端接口”，不追求真实业务闭环，不拆分现有架构，不引入公网访问。

## Scope

本设计只覆盖以下内容：

- 在现有 Express 服务中增加一个最小 Skill 入口路由
- 暴露一个演示接口，例如 `POST /api/skill/echo`
- 定义清晰的请求与响应格式
- 约定 Skill 侧如何调用该接口
- 约定最小验证方式与错误处理

本设计明确不包含以下内容：

- 不改造前端页面
- 不接入真实 idea-to-spec / mission / executor 业务链路
- 不处理公网暴露、反向代理、域名与部署拓扑
- 不引入新的独立 gateway 服务
- 不将现有仓库拆分为多个服务

## Existing Context

当前仓库已经具备以下条件：

- 一个运行中的一体化服务端，主要入口位于 `server/index.ts`
- 现有路由通过 `/api/*` 暴露 HTTP 能力
- 当前沙盒内已可启动服务端，并可通过 `http://localhost:3001` 访问
- 为适配 Trae 沙盒，已加入 `SOLO_TRAE_BYPASS_AUTH=true` 的鉴权绕过开关

因此，本次设计不需要额外拆服务，只需要在现有服务端中增加一个“Skill 专用的稳定入口”。

## Recommended Approach

推荐采用“单路由门面”模式：

- 在现有服务端新增 `server/routes/skill.ts`
- 将它挂载到 `/api/skill`
- 首先只实现一个无状态演示接口：`POST /api/skill/echo`
- Skill 不直接理解整个应用，只调用这个稳定入口

这样做的优点是：

- 对现有一体化项目侵入最小
- 不需要先拆前后端或 executor
- 能快速验证 Skill 与项目后端的可达性与数据契约
- 后续可以在同一路由下逐步添加真实业务接口，如 `idea-to-spec`

## Alternatives Considered

### Option A: 直接在现有服务端增加 Skill 路由

这是推荐方案。

优点：

- 最小改动
- 复用当前启动方式与服务端上下文
- 便于先做演示后升级为真实业务

缺点：

- Skill 入口仍然与主服务运行在一起，边界不如独立 gateway 明确

### Option B: 增加独立 Skill Gateway

优点：

- 技术边界更清晰
- 适合未来多 Skill 聚合

缺点：

- 对当前目标属于过度设计
- 会增加启动、转发和调试复杂度

### Option C: 先用 CLI 模拟 Skill 调用

优点：

- 能更快验证请求/响应格式

缺点：

- 不能真正证明 Skill 到 HTTP API 的链路已经跑通
- 最终仍需要回到 HTTP 入口

## API Contract

第一阶段接口定义如下。

### Endpoint

`POST /api/skill/echo`

### Request Body

```json
{
  "message": "hello from skill"
}
```

字段约束：

- `message` 必填
- `message` 必须为非空字符串
- 第一阶段不接受额外复杂参数

### Success Response

```json
{
  "ok": true,
  "message": "hello from skill",
  "source": "cube-pets-office",
  "channel": "skill-http-bridge"
}
```

字段语义：

- `ok`: 固定为 `true`
- `message`: 原样回显 Skill 传入的消息
- `source`: 标记当前响应来自该项目
- `channel`: 标记当前接口属于 Skill 到 HTTP API 的桥接链路

### Error Response

```json
{
  "ok": false,
  "error": "message is required"
}
```

错误场景：

- 未传 `message`
- `message` 不是字符串
- `message` 为空字符串或仅包含空白字符

错误状态码：

- 请求参数错误返回 `400`
- 未知服务端错误返回 `500`

## Server Design

服务端采用一个极薄实现，不引入额外业务依赖。

### Route File

新增文件：`server/routes/skill.ts`

职责：

- 定义 `/api/skill` 下的最小路由
- 校验 `POST /echo` 的输入
- 返回结构化 JSON
- 不依赖数据库
- 不依赖 executor
- 不依赖前端构建产物

### Mounting

在 `server/index.ts` 中挂载：

```ts
app.use("/api/skill", createSkillRouter());
```

### Auth Behavior

第一阶段推荐保持公开可调，原因如下：

- 当前目标是验证沙盒内链路，不是验证权限模型
- 沙盒中已存在 `SOLO_TRAE_BYPASS_AUTH` 能力
- `echo` 不触碰敏感数据，不会引入额外泄漏面

如果实现时发现主服务统一链路会默认套上鉴权，则优先复用已有沙盒绕过开关，不单独为 `echo` 设计新的权限策略。

## Skill Side Design

Skill 侧只承担以下职责：

- 接收用户输入
- 组装 HTTP 请求
- 调用 `http://localhost:3001/api/skill/echo`
- 解析 JSON
- 将结果整理为用户可读输出

Skill 不承担以下职责：

- 不直接理解项目内部 orchestrator
- 不直接控制 executor
- 不直接读写数据库

Skill 的最小调用逻辑可以表述为：

1. 接收用户输入文本
2. 提取或直接使用该文本作为 `message`
3. 发起 `POST` 请求到 `/api/skill/echo`
4. 若返回 `ok: true`，向用户展示回显结果
5. 若返回 `ok: false` 或 HTTP 非 `2xx`，向用户展示错误信息

## Data Flow

链路如下：

1. 用户在 Trae 中触发 Skill
2. Skill 读取用户输入，例如 `"hello from skill"`
3. Skill 调用 `POST http://localhost:3001/api/skill/echo`
4. 当前项目的 Express 服务处理请求
5. 服务端返回标准 JSON
6. Skill 将 JSON 渲染为结果文本返回给用户

该流程验证的核心不是业务逻辑，而是：

- Skill 与沙盒内 HTTP 服务可达
- 请求与响应契约稳定
- 返回结果可被 Skill 正常消费

## Error Handling

第一阶段采用简单、可诊断的错误策略。

服务端：

- 输入不合法时返回 `400` + 明确错误文案
- 未知异常返回 `500` + 通用错误文案
- 不向客户端暴露堆栈

Skill：

- 超时、连接失败时提示“无法连接本地服务”
- 收到 `400` 时直接展示服务端错误信息
- 收到 `500` 时提示“服务端处理失败”

## Testing Strategy

测试分三层。

### 1. 路由单测

新增路由测试，覆盖：

- 合法 `message` 返回 `200`
- 缺失 `message` 返回 `400`
- 空字符串 `message` 返回 `400`

### 2. 沙盒内 HTTP 验证

服务端启动后，在沙盒中执行：

```bash
node -e "fetch('http://127.0.0.1:3001/api/skill/echo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'hello from skill'})}).then(async r=>{console.log(r.status);console.log(await r.text())})"
```

预期：

- 返回 `200`
- 响应体包含 `ok: true`

### 3. Skill 端端到端验证

在 Trae 中用最小 Skill 触发一次调用，预期：

- Skill 能成功请求该接口
- Skill 能把 JSON 结果展示给用户

## Migration Path

当 `echo` 跑通后，第二阶段再升级为真实业务接口。

推荐顺序：

1. 保留 `/api/skill/echo` 作为稳定烟雾测试接口
2. 新增如 `/api/skill/idea-to-spec`
3. 在该接口内部复用现有 mission/orchestrator 能力
4. 逐步把 Skill 从“演示链路”切换到“真实业务链路”

这样可以保证后续调试时始终保留一条简单、可快速定位故障的基础链路。

## Acceptance Criteria

满足以下条件即视为本阶段完成：

- 服务端新增 `/api/skill/echo`
- 接口能在沙盒内通过 `localhost:3001` 访问
- 合法请求返回 `200` 和标准 JSON
- 非法请求返回 `400`
- Skill 能在同一沙盒内成功调用该接口并向用户展示结果
- 不要求前端页面参与整个流程

## Non-Goals

以下内容明确不是本阶段目标：

- 将整个项目包装成一个完整 Skill
- 把项目拆成微服务
- 让接口对公网开放
- 接入复杂鉴权、组织权限、会话恢复
- 在第一阶段绑定数据库或 executor 的真实业务逻辑
