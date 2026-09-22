# SlideRule V6.1 入站判定

一张一个事实：推演之前先判「这一轮说的是不是真需求」，**fail-open，只提示不阻断**。
V6.0 的 `TRIAGE` 子图搬过来（V6.1 此前完全没画这一层）。

源：`slide-rule-python/services/intake_judge.py` 模块头（含 TriageSQL / QueryCarefully 两篇的取舍论证）。
成本背景写在那个模块头里：一轮推演约 20 分钟 + 一次完整 LLM + 最多 9 张生图——这一层挡的就是这笔钱。

三层递进、越往后越贵；`Action` 只有 `proceed` / `hint` 两个值——**没有第三个**。
拦不拦人另有一根开关 `SLIDERULE_INTAKE_JUDGE_BLOCKING`（默认关），别把 hint 读成拦截。

```mermaid
flowchart TB
  IN[这一轮用户说的话] --> L0

  subgraph L0["第 0 层 precheck · 零成本零延迟"]
    P0[空输入 / 纯标点 / 纯问候 / 有效字太少]
  end
  L0 -->|挡不住| L1

  subgraph L1["第 1 层 _RULES · 规则表"]
    R1[condition + scope + priority<br/>每轮只把相关的注进 prompt]
  end
  L1 --> L2

  subgraph L2["第 2 层 judge_turn · LLM 判定"]
    V[六判词<br/>real / iteration / vague / off_topic / meta / out_of_scope]
    CAP[_capability_block<br/>现算自 five_system_legal]
    OOS[_out_of_scope_block<br/>说清了但五系统表达不了]
    DEV[_DEVICE_RUBRIC<br/>设备档与判定共用一份判据]
  end

  L2 --> ACT[_resolve_action<br/>唯一决定要不要打扰用户的地方]
  ACT -->|real / iteration| GO[proceed 进工厂]
  ACT -->|判不准 confidence 低| GO
  ACT -->|其余| HINT[hint 只提示<br/>默认不阻断]

  EVAL[eval_intake_judge 评测台<br/>升级阻断的唯一依据] -.->|专量误伤| ACT
```
