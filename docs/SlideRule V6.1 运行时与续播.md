# SlideRule V6.1 运行时与续播

一张一个事实：run 的生命周期**不绑在一根网线上**——断连只是取消订阅，推演照跑，
按序号续播接回去。V6.0 的 `RUNTIME` 子图搬过来（V6.1 此前完全没画这一层）。

源：`services/run_registry.py` 模块头（契约抄 Vercel resumable-stream，生命周期对齐
LangGraph，序号语义遵循 SSE `Last-Event-ID`）。

⚠ **停止与暂停不是同一件事**：停止 = 取消，这一轮判死白烧；暂停 = 停住等人，
答完/超时/没人在场都会接着跑到最后一步，闭环照样绿。两者都靠**协作式**取消
（`threading.Event` + 安全点），因为引擎每步跑在 `asyncio.to_thread` 里，
`task.cancel()` 那一下**打不断线程**（2026-08-14 实测，模块头有记）。

```mermaid
flowchart TB
  POST[POST 发起] --> RUN[run_registry<br/>后台跑 · 与连接解耦]
  RUN --> LOG[事件日志 · 单调 seq]
  LOG --> SSE[SSE 订阅]
  SSE -.->|浏览器刷新/跳页 = 只退订| RUN
  RESUME["GET /runs/{id}/stream?since=" ] --> LOG

  subgraph GOV["治理三件套 · 防孤儿 run 白烧"]
    ORPH[无人观看宽限<br/>超时自动中止]
    DUP[防重复发起<br/>同会话附着既有 run]
    CANCEL[显式取消 cancel_run]
  end
  GOV --> RUN

  subgraph HOLD["暂停 ≠ 停止"]
    H1["POST /runs/{id}/hold<br/>下一个安全点停住"]
    H2["POST /runs/{id}/release<br/>答了 / 就这样"]
    H3[答完 · 超时 · 没人在场<br/>三种结局都接着跑完]
  end
  H1 --> RUN
  H2 --> RUN

  RUN --> NARR[turnNarrations 直播时间线投影<br/>轮末随 PUT 持久化 · 同轮守卫豁免成员]
  NARR --> UI[活预览 + 推演钟 + 证据 HUD]
```
