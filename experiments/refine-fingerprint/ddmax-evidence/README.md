# ddmax 退让改造的真机证据（2026-08-17）

这一轮是**误跑出来的**：改动还没提交、批量正在跑，子进程装载到了改过的
`spec_first_pipeline.py`。发现后它作为 A/B 样本作废（ON 臂内部不能有两套退让
算法），但日志本身是这个改造唯一的真机凭证，所以单独留在这里。

## 它证明了什么

同一个局面下，前缀退让会赔光，1-maximal 保住了两段：

```
on-2（前缀退让）  ⚠ 沿用「aigc」后过不了闸 …
                 ⚠ 沿用「workflow」后过不了闸 …
                 ⚠ 沿用「rbac」后过不了闸 …
                 ⚠ 精修沿用逐段退让到空          ← workflow、aigc 白赔

on-4（1-maximal）精修沿用上一版模型段：workflow、aigc
                 （丢掉 rbac，首次拒绝：page.pages[p4].actionPermissions：
                   page action permission 'community:read' not found in rbac.permissions）
```

拒绝理由跟离线 replay 的预测**逐字吻合**：卡住的是 rbac（新生成的 page 引用了
旧 rbac 没有的权限，实测 6/6 零例外），而 rbac 排在前缀链最前、最后才被丢，
于是丢 aigc、丢 workflow 这两步纯属白费，等轮到它时其余早已赔光。

赔掉的 `workflow` 正是用户最初抱怨"被换掉"的那两段之一。

## ⚠ 两条别看错

1. **它不能算进 A/B**。这轮跑的是 ON 臂但用了不同的退让算法，跟 on-1~3 不可比。
   runs/ 里的 on-4 是用还原后的前缀退让代码重跑的那一份。
2. **日志里有两条沿用记录**。two_round_drive 用 max_loops=2，第二轮流水线跑两遍：
   第一遍 ddmax 退让到 {workflow, aigc}，第二遍三段全过。第二条的文案跟旧代码
   **逐字相同**（成功路径没改文案），别拿它判断跑的是哪套代码——要判就看
   有没有「丢掉 …，首次拒绝：…」那个后缀。
