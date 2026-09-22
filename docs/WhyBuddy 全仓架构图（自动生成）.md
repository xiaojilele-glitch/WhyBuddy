# WhyBuddy 全仓架构图（自动生成）

> ⚠ **这份文件是 `arch_graph.py --emit` 生成的，不要手改。**
> Python 包边来自 `arch_graph.py`，TS 包边来自 `arch-graph-ts.mjs --json-packages`，
> 跨语言边来自 `architecture.toml` 的 `[[cross_language_edge]]`（Nx implicitDependencies）。

- TS 包 **7**，包间边 **7**
- Python 包 **11**
- 跨语言边 **4**（server/index.ts 拼字符串加载 Python adapter）

四个 adapter 在 Python 依赖图里入度为 0，看起来像孤儿；
它们是产线代码，接线在另一门语言里。这张图把那四条边画出来。

```mermaid
flowchart TB
  subgraph ts [TypeScript]
    ts_agent_loop["ts/agent-loop<br/>99 个模块"]
    ts_client["ts/client<br/>1077 个模块"]
    ts_project_templates["ts/project-templates<br/>5 个模块"]
    ts_scripts["ts/scripts<br/>67 个模块"]
    ts_server["ts/server<br/>588 个模块"]
    ts_services["ts/services<br/>32 个模块"]
    ts_shared["ts/shared<br/>179 个模块"]
  end
  subgraph py [Python]
    py_app["py/app<br/>1 个模块"]
    py_arch_graph["py/arch_graph<br/>1 个模块"]
    py_complete_migration["py/complete_migration<br/>1 个模块"]
    py_config["py/config<br/>2 个模块"]
    py_middlewares["py/middlewares<br/>2 个模块"]
    py_models["py/models<br/>4 个模块"]
    py_routes["py/routes<br/>16 个模块"]
    py_scripts["py/scripts<br/>39 个模块"]
    py_services["py/services<br/>272 个模块"]
    py_sliderule_llm["py/sliderule_llm<br/>16 个模块"]
    py_stdio_utf8["py/stdio_utf8<br/>1 个模块"]
    py_services_web_aigc_open_adapter["services.web_aigc_open_adapter"]
    py_services_web_aigc_orchestration_adapter["services.web_aigc_orchestration_adapter"]
    py_services_web_aigc_web_qa_adapter["services.web_aigc_web_qa_adapter"]
    py_services_web_aigc_device_location_adapter["services.web_aigc_device_location_adapter"]
  end
  ts_client -->|415| ts_shared
  ts_scripts -->|2| ts_client
  ts_scripts -->|10| ts_server
  ts_scripts -->|2| ts_shared
  ts_server -->|1| ts_client
  ts_server -->|702| ts_shared
  ts_services -->|23| ts_shared
  py_app -->|1| py_config
  py_app -->|1| py_models
  py_app -->|16| py_routes
  py_app -->|23| py_services
  py_app -->|2| py_sliderule_llm
  py_app -->|1| py_stdio_utf8
  py_complete_migration -->|1| py_models
  py_complete_migration -->|3| py_services
  py_middlewares -->|1| py_config
  py_middlewares -->|2| py_services
  py_routes -->|10| py_config
  py_routes -->|9| py_middlewares
  py_routes -->|6| py_models
  py_routes -->|161| py_services
  py_routes -->|30| py_sliderule_llm
  py_scripts -->|3| py_app
  py_scripts -->|2| py_config
  py_scripts -->|1| py_models
  py_scripts -->|58| py_services
  py_scripts -->|16| py_sliderule_llm
  py_scripts -->|2| py_stdio_utf8
  py_services -->|19| py_config
  py_services -->|43| py_models
  py_services -->|126| py_sliderule_llm
  py_sliderule_llm -->|2| py_config
  ts_server -.->|open| py_services_web_aigc_open_adapter
  ts_server -.->|orchestration| py_services_web_aigc_orchestration_adapter
  ts_server -.->|web_qa| py_services_web_aigc_web_qa_adapter
  ts_server -.->|device_location| py_services_web_aigc_device_location_adapter
```

## 跨语言边

| 从 | adapter | 到 | 为什么 |
|---|---|---|---|
| `server/index.ts` | `open` | `services.web_aigc_open_adapter` | createPythonWebAigcAdapter 拼字符串 __import__ |
| `server/index.ts` | `orchestration` | `services.web_aigc_orchestration_adapter` | createPythonWebAigcAdapter 拼字符串 __import__ |
| `server/index.ts` | `web_qa` | `services.web_aigc_web_qa_adapter` | createPythonWebAigcAdapter 拼字符串 __import__ |
| `server/index.ts` | `device_location` | `services.web_aigc_device_location_adapter` | createPythonWebAigcAdapter 拼字符串 __import__ |
