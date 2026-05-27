mermaid
graph TD
    A[Start: Construct Execution Plan] --> B[Register Callback Hooks]
    B --> C{Executor Running}
    C -->|Trigger| D[Capture Evidence Data]
    D --> E[Store in Evidence Store]
    D --> F[Execute Hook Callback Logic]
    C --> G[Termination Criteria Met]
    G --> H[End: Final Evidence Summary]