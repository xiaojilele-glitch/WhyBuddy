mermaid
graph TD
    A[MiroFish Task Start] --> B{Executor-backed Agent}
    B -- Success & Evidence exists --> C[Artifact Validation]
    B -- Failure / No Evidence --> D[Lite Agent Fallback]
    D --> E[Host-side LLM Synthesis]
    E --> F[Structure & Schema Check]
    F -- Pass --> G[Return Fallback Artifact]
    F -- Fail --> H[Terminal Error]
    C -- Pass --> I[Final Output]
    C -- Fail --> D