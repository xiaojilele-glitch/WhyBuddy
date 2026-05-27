mermaid
graph TD
    A[开始验证] --> B{是否存在所有关键里程碑?}
    B -- 否 --> C[标记结果为 Insufficient]
    B -- 是 --> D{证据内容是否与产物一致?}
    D -- 否 --> C
    D -- 是 --> E{证据链是否完整?}
    E -- 否 --> C
    E -- 是 --> F[标记结果为 Sufficient]
    C --> G[触发 Conservative Fallback]
    F --> H[进入下一验证环节/提交产物]