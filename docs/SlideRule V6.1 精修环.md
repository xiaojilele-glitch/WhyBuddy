# SlideRule V6.1 精修环

一张一个事实：精修是**已闭环应用的第二条入口**，走的是「声明碰了哪几段、出口把其余
段按住」的**沿用语义**，不是补丁语义。V6.0 的 `REFINELOOP` 子图搬过来。

⚠ 补丁语义（模型吐增量、合并器往基线上打）与 spec-first **架构上不兼容**：
spec-first 天生「从 spec 树重新生成」，出口永远是完整模型，合并器看到六段齐全就判
「没按补丁交付」原样放行。这不是接线问题，是方案选错了——详见
`spec_first_pipeline.apply_refine_segment_reuse` 的文档串。

路径：`services/refine_short_circuit.py`（页级短路）、`services/refine_graph_scope.py`
（图判范围）、`services/page_id_freeze.py`（改名留对照表）。

```mermaid
flowchart TB
  U[用户对已闭环应用提要求] --> CP[控制面 refine]
  CP --> CTX[set_refine_context<br/>上一版模型 + 指令 + 上一版页面]

  CTX --> SCOPE{碰了哪几段}
  SCOPE -->|只碰页面| SHORT[页级短路<br/>refine_short_circuit<br/>不重跑五系统]
  SCOPE -->|碰模型| SEG[段级沿用<br/>模型声明碰了哪几段<br/>出口把其余段按住]

  SEG --> GRAPH[图判范围 refine_graph_scope<br/>别把整张图都扩进来]
  SHORT --> PAGES
  GRAPH --> PAGES[按需重画<br/>指令没点到的页原样照搬 · 不进 LLM]

  PAGES --> FREEZE[页面 id 别名表<br/>改名的那一刻记下映射]
  FREEZE --> OUT[新版本 mv-n]

  NOTE[别名是历史 · 只增不减<br/>版本回退也不许把它抹掉] -.-> FREEZE
```
