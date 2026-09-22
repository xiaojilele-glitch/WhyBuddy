# SlideRule V6.1 身份与权限

一张一个事实：身份是**贯穿式**的，可见性判定 fail-closed，匿名只能看 `public`。
V6.0 的 `IDENTITY` 子图搬过来（V6.1 此前完全没画这一层）。

路径：`services/identity_store.py`（账号）、`services/app_access.py`（归属与可见性）、
`services/mailer.py`（验证码投递）、`client/src/pages/auth`（登录注册页）。

判定顺序写死在 `app_access.py` 模块头：**起点 None → 公开的给 Read → 匿名到此为止 →
所有者直接 Owner → 否则查显式授权**。`unlisted` 与 `public` 的唯一区别是**不进列表**。

```mermaid
flowchart TB
  ANON[匿名访客] --> GATE
  USER[已登录用户] --> GATE
  OWNER[应用所有者] --> GATE

  subgraph GATE["app_access 可见性判定 · fail-closed"]
    direction TB
    G0[起点 None] --> G1[public/unlisted → READ]
    G1 --> G2[匿名到此为止]
    G2 --> G3[owner_id 命中 → OWNER]
    G3 --> G4[否则查显式授权]
  end

  subgraph ACC["identity_store 账号"]
    REG[邮箱 + 验证码注册<br/>一个邮箱同一时刻只留一个有效码]
    PWD[密码登录]
  end
  ACC --> USER
  MAIL[mailer<br/>SMTP 通用 + Resend HTTP<br/>console 模式零配置可跑] --> REG

  GATE --> OWN[归属 owner_id 落 generated_app<br/>谁推演出来的归谁 · 拿不到落无主]
  MIG[存量迁移脚本<br/>默认 dry-run] -.->|后加字段要有说法| OWN
```
