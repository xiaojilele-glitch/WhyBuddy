# SlideRule V6.1 作曲家（输入面）

一张一个事实：作曲家是**唯一的操纵杆**——话题、附件、斜杠、排队、暂停都从这里进。
V6.0 的 `SURF` 子图搬过来（上一版说「拆散进了别的图」，但附件提取与排队两条
一张图都没落，等于没画）。

路径：`client/src/pages/sliderule/ComposerDock.tsx`；附件 `POST /attachments/extract`；
提示条 `IntakeHintBar.tsx`；斜杠 `composer-slash.ts`。

⚠ 「发送」在跑着的时候**不是停止键**。停止是取消（这一轮判死白烧），发送在跑着时是
**排队**（补一句，下一轮带上）；队列空闲时点发送要能把它送出去——这条出路 2026-08-28
才补上，此前排队的话没有出口，卡在那儿谁也不知道。

```mermaid
flowchart TB
  subgraph DOCK["ComposerDock · 唯一操纵杆"]
    direction TB
    TEXT[话题 / 追加指令]
    SLASH[斜杠动词<br/>composer-slash.ts]
    ATT[附件]
  end

  ATT --> EXT["POST /attachments/extract · E31"]
  EXT --> T1[文本类<br/>直读注入]
  EXT --> T2[图片<br/>视觉 LLM 识别]
  EXT --> T3[PDF<br/>E2B 沙盒 pypdf · 超长再蒸馏]

  TEXT --> JUDGE[入站判定]
  JUDGE -->|action=hint| HINT[IntakeHintBar<br/>才占视线 · 可点改写回填]
  JUDGE -->|proceed| RUN

  TEXT -->|跑着的时候| QUEUE[排队<br/>补一句 · 下一轮带上]
  QUEUE -->|空闲时点发送| RUN[进工厂这一轮]

  ASSUME[伴随式澄清条<br/>我替你定了什么] --> HOLD["先别往下跑<br/>POST /runs/{id}/hold"]
  HOLD -.->|≠ 停止| RUN

  NOTE[⚠ 发送 ≠ 停止<br/>停止是取消 · 这一轮判死白烧] -.-> QUEUE
```
