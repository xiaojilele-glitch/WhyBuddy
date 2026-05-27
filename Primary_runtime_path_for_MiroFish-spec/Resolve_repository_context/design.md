mermaid
graph TD
    A[接收原始输入] --> B{URL 规范化}
    B --> C[识别修订版本/分支]
    C --> D{检查访问权限}
    D -- 可访问 --> E[提取元数据 & 构建索引]
    D -- 不可访问 --> F[构建抽象上下文/占位符]
    E --> G[敏感信息扫描与脱敏]
    F --> G
    G --> H[生成 RepositoryContext 对象]
    H --> I[注入下游 Agent 路径]