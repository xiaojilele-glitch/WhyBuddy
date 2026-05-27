mermaid
graph TD
    A[接收执行器产物 & 回调证据] --> B{结构检查: Schema Validation}
    B -- 失败 --> F[标记为 Fallback]
    B -- 通过 --> C{内容检查: Non-empty & Route Alignment}
    C -- 失败 --> F
    C -- 通过 --> D{证据检查: Callback Evidence Verify}
    D -- 失败 --> F
    D -- 通过 --> E[验证通过: Success Route]
    F --> G[输出验证报告与回退指令]
    E --> H[输出已验证产物]