# SlideRule V6.1 闸与闭环

一张一个事实：coverage / 结构闸 / publish closure 6/6 在工厂出口，缺证据就是 blocked。
enrich 不在 spec-first 主轴上。`POST /coverage` 是调试口，不是产品插座。

路径：`evaluate_coverage_gate` 在 `v5_full_driver.py`；`v5_model_gate` 在 `v5_capability_executor.py`；闭环在 `v5_publish_closure_response.py`。

```mermaid
flowchart TB
  SF[spec-first 七步] --> STRUCT[v5_model_gate<br/>结构闸 fail-closed]
  STRUCT --> REPAIR[v5_model_repair<br/>零 LLM]
  REPAIR --> COV[evaluate_coverage_gate<br/>驱动器内]
  COV --> PUB[publish closure 6/6<br/>v5_publish_closure_response]

  PUB -->|证据齐| PASS[blocked = false]
  PUB -->|缺证据| BLOCK[blocked = true<br/>不许绿灯]

  DBG[POST /coverage<br/>算一遍不落库] -.-> COV
  ENR[enrich 管线] -.->|spec-first 跳过| SF
```
