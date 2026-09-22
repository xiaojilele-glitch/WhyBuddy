# SlideRule V6.1 工厂 spec-first

一张一个事实：默认工厂是 spec-first 七步实线。GEN5 只是回落，不是脊柱。
源：`slide-rule-python/services/spec_first_pipeline.py` 模块头。本图不把 `generate_five_system_model` 画成主轴。

数字只活在代码常量里。七步名字与 `spec_first_pipeline.py` 一致。

```mermaid
flowchart TB
  ENV[start_drive_full_factory_run<br/>drive_full_factory.py] --> D[drive_full_v5_session_stream<br/>v5_full_driver.py]
  D --> RC[appbundle.runtimeclosure]
  RC --> SF

  subgraph SF["spec-first 七步 · 默认开"]
    direction TB
    S1[spec_tree] --> S2[spec_page_html]
    S2 --> S3[page_shell]
    S3 --> S4[html_structure]
    S4 --> S5[spec_semantics]
    S5 --> S6[model_assembly]
    S6 --> S7[html_bindings]
  end

  SF --> GATE[v5_model_gate + v5_model_repair]
  GATE --> OUT[五系统模型]

  RC -.->|传输或结构失败才回落| GEN5[GEN5 generate_five_system_model<br/>不是脊柱]
```
