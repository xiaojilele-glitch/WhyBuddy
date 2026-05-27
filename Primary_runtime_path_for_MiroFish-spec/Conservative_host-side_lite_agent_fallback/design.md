mermaid
graph TD
    A[主路径：Executor-backed Agent] --> B{结果有效且存证充足?}
    B -- Yes --> C[输出制品至下游]
    B -- No / Timeout --> D[触发 CHLAF 模块]
    D --> E[收集失败上下文与残余数据]
    E --> F[Lite Agent 直接合成 / 宿主侧组装]
    F --> G{结构验证 (Schema Check)}
    G -- Pass --> H[标记降级并输出制品]
    G -- Fail --> I[尝试单次自愈]
    I --> G
    H --> C