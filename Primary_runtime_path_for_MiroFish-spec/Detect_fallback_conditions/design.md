mermaid
graph TD
    A[Start: Executor Path] --> B{Health Check / Monitoring}
    B -- Failure Detected --> C[Module: Detect Fallback Conditions]
    B -- Success --> D[Proceed with Executor Path]
    
    C --> C1[Analyze Error Type]
    C1 --> C2{Trigger Fallback?}
    
    C2 -- Yes --> E[Switch to Alternative Route]
    E --> E1[Host-side Execution]
    E1 --> E2[Lite Agent / Direct LLM]
    
    C2 -- No --> F[Retry or Terminate]
    
    D --> G[Preserve Live Callback Evidence]