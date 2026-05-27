mermaid
graph TD
    A[收到后备产物] --> B{Schema/安全验证}
    B -- 失败 --> C[抛出后备执行异常]
    B -- 成功 --> D[封装元数据]
    D --> E[注入主路径失败原因]
    E --> F[标记为 fallback-derived]
    F --> G[输出最终产物包]