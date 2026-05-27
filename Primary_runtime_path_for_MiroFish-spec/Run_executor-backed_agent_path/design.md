mermaid
graph TD
    A[Task Request] --> B[Run executor-backed agent path]
    B --> C{Backend Executor}
    C -->|Streaming Log| D[Live Activity Monitor]
    C -->|Callback Events| E[Evidence Persistence Layer]
    E --> F[(Database / Object Store)]
    C --> G[Result Artifacts]
    G --> H[Artifact Validation]