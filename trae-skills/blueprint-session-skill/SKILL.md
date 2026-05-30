---
name: blueprint-session-spec
description: 使用本地 cube-pets-office blueprint session 后端，完成需求澄清、路线选择和规格产物输出。
allowed-tools: Bash(curl:*) Bash(jq:*) Bash(node:*) Bash(pnpm:*)
---

# Blueprint Session Spec

## 用途

当用户想把一个模糊想法推进成结构化规格时，使用这个技能。它会调用本地运行的 `cube-pets-office` 会话式后端，按以下流程推进：

1. 创建 session
2. 展示澄清问题
3. 展示路线选择
4. 输出规格结果包

## 运行前提

优先假设服务已经运行在：

```text
http://127.0.0.1:3101
```

如果服务尚未启动，先在仓库根目录执行：

```bash
env SOLO_TRAE_BYPASS_AUTH=true PORT=3101 SKILL_BRIDGE_BASE_URL=http://127.0.0.1:3101 pnpm exec tsx server/index.ts
```

启动成功后，再继续调用会话接口。

## 接口

基地址：

```text
http://127.0.0.1:3101/api/skill/session
```

使用以下四个接口：

- `POST /start`
- `POST /respond`
- `GET /:id/snapshot`
- `GET /:id/agent-stream`

## 调用流程

### 1. 启动会话

发送：

```json
{ "input": "用户的原始需求" }
```

使用：

```bash
curl -s http://127.0.0.1:3101/api/skill/session/start \
  -H 'content-type: application/json' \
  -d '{"input":"用户的原始需求"}'
```

解析响应中的：

- `sessionId`
- `status`
- `snapshot`
- `decision`

### 2. 处理 decision

如果返回了 `decision`，必须把它转成用户可理解的问题再继续。

#### `text_input`

- 把 `decision.title` 作为提问文案
- 把用户回答作为字符串写入 `answer.selected`

#### `single_select`

- 把 `decision.options[*]` 渲染为单选项
- 把用户选中的 `option.id` 写入 `answer.selected`

#### `multi_select`

- 如果宿主支持多选组件，就让用户多选
- 当前后端 `respond` 只接收 `answer.selected` 字符串
- 多选场景下，把用户选择压缩成一个字符串后再提交，例如逗号拼接

### 3. 回传回答

调用：

```bash
curl -s http://127.0.0.1:3101/api/skill/session/respond \
  -H 'content-type: application/json' \
  -d '{
    "sessionId":"会话ID",
    "stepId":"当前 decision.stepId",
    "answer":{"selected":"用户答案或选项ID"}
  }'
```

### 4. 重复直到完成

只要返回里还有 `decision`，就继续向用户提问并回传答案。

当 `status === "completed"` 时，读取：

- `result.selectedRoute`
- `result.specDocument`
- `result.imagePrompts`

## 输出要求

完成后按以下结构向用户汇报：

1. 当前选择的路线名称
2. 规格文档标题
3. 规格文档正文摘要
4. 如果 `imagePrompts` 非空，则列出生图提示词
5. 如果 `imagePrompts` 为空，则明确说明当前流程未返回生图提示词

## 行为约束

- 不要伪造任何澄清问题、路线或规格结果
- 所有中间状态都以真实 API 返回为准
- 如果本地服务不可达，先尝试启动服务，再继续流程
- 如果 `start` 或 `respond` 返回错误，把错误原文整理后告诉用户
- 不要跳过 `decision` 直接编造最终结果

## 推荐脚本

需要自动推进时，可以使用以下 Node 脚本模板：

```bash
node <<'NODE'
const baseUrl = 'http://127.0.0.1:3101';

function answerFor(decision) {
  if (decision.type === 'single_select' || decision.type === 'multi_select') {
    return decision.options?.[0]?.id ?? 'default';
  }
  return '请根据当前用户输入补全这条澄清';
}

async function respond(sessionId, stepId, selected) {
  return fetch(`${baseUrl}/api/skill/session/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, stepId, answer: { selected } }),
  }).then(r => r.json());
}

async function main() {
  let current = await fetch(`${baseUrl}/api/skill/session/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: '我想做一个 AI 剧本共创平台' }),
  }).then(r => r.json());

  for (let i = 0; i < 10 && current.decision; i += 1) {
    current = await respond(
      current.sessionId,
      current.decision.stepId,
      answerFor(current.decision),
    );
    if (current.status === 'completed') break;
  }

  console.log(JSON.stringify(current, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
NODE
```
