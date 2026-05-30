# Examples

## Start

```bash
curl -s http://127.0.0.1:3101/api/skill/session/start \
  -H 'content-type: application/json' \
  -d '{"input":"我想做一个 AI 剧本共创平台"}' | jq
```

## Respond

```bash
curl -s http://127.0.0.1:3101/api/skill/session/respond \
  -H 'content-type: application/json' \
  -d '{
    "sessionId":"skill_sess_xxx",
    "stepId":"blueprint-question-goal",
    "answer":{"selected":"优先产出完整规格文档"}
  }' | jq
```

## Snapshot

```bash
curl -s http://127.0.0.1:3101/api/skill/session/skill_sess_xxx/snapshot | jq
```

## Agent Stream

```bash
curl -s http://127.0.0.1:3101/api/skill/session/skill_sess_xxx/agent-stream | jq
```
