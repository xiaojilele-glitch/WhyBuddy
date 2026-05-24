# Autopilot 返回逻辑时序图

生成时间：2026-05-23

对应 SVG：

- `docs/autopilot-return-navigation-page-level-2026-05-23.svg`
- `docs/autopilot-return-navigation-review-vs-replan-sequence-2026-05-23.svg`

这份 MD 不是只画“按钮点了之后去哪儿”，而是把完整语义拆清楚：

- `返回上一步`：回看上游页面，不删除旧 SPEC、旧预览、旧运行时结果。
- `从这里重新规划`：显式重来，清掉下游资产并创建新 job 或新版本链路。
- `用户直接修改上游`：例如改目标、重新澄清、换路线，也应自动使下游失效并重建。

页面层级应该按用户看到的页面来退，不应该按内部 STEP 数字来退：

```text
页面 3：效果预览 / 后续运行时结果
  -> 返回上一步
页面 2：SPEC 树 / SPEC 规格文档
  -> 返回上一步
页面 1：输入 / 澄清 / 路线
```

`STEP 04 SPEC TREE` 和 `STEP 05 SPEC DOCUMENTS` 在当前产品体验里是同一个 SPEC 合并页，所以不能把 `STEP 05 -> STEP 04` 当成一次有效页面回退。用户会感觉“点击了，但是还在同一页”。

## 时序图 1：产品语义完整分支

这张图只保留产品视角，重点回答：用户返回之后，到底是“回看”，还是“重来”。

```mermaid
sequenceDiagram
    autonumber
    actor User as 用户
    participant Page as 页面
    participant State as 前端状态
    participant Job as 后端 Job
    participant Assets as 下游资产

    User->>Page: 进入页面
    Page->>Job: 读取最新进度
    Job-->>Page: stage = runtime_capability
    Page-->>User: 默认展示 效果预览

    User->>Page: 返回上一步
    Page->>State: pin 到 spec_tree
    State-->>Page: currentSubStage = spec_tree
    Page-->>User: 展示 SPEC树 + SPEC规格文档
    Note over Page,Assets: 不删除，只是回看

    User->>Page: 返回上一步
    Page->>State: 清掉 sub pin，切回 workflow input
    State-->>Page: workflowStageOverride = input
    Page-->>User: 展示 输入 / 澄清 / 路线
    Note over Page,Assets: 仍然不删除，只是回看上游

    alt 用户只是查看
        User->>Page: 继续查看 SPEC 或效果预览
        Page->>State: 回到已有下游页面
        State-->>Page: 恢复旧 sub / 旧 workflow 状态
        Page-->>User: 展示旧 SPEC / 旧预览
    else 用户要重来
        User->>Page: 从这里重新规划
        Page->>State: resetPin()，清掉手动回退状态
        Page->>Assets: 清掉 SPEC树、SPEC文档、预览、运行时结果
        Page->>Job: 创建新 job / 新版本链路
        Job-->>Page: 新路线生成流程
        Page-->>User: 重新输入、澄清、规划路线
    else 用户直接修改上游
        User->>Page: 改目标 / 改澄清 / 换路线
        Page->>Assets: 自动使下游失效
        Page->>Job: 重新生成后续链路
        Job-->>Page: 新结果
        Page-->>User: 展示新结果
    end
```

## 时序图 2：当前实现参与方与推荐链路

这张图把真实参与方展开，方便对照代码查问题：`AutopilotRoutePage`、`AutopilotRightRail`、`URL Pin`、后端 job、下游资产。

```mermaid
sequenceDiagram
    autonumber
    actor User as 用户
    participant Route as AutopilotRoutePage 外层页面
    participant Rail as AutopilotRightRail 右栏
    participant Pin as 前端状态/URL Pin
    participant Job as Blueprint 后端 Job
    participant Assets as 下游资产 SPEC/Preview/Runtime

    rect rgb(245, 248, 252)
        Note over Route,Job: 进入页面：根据最新 job 恢复到最远进度
        User->>Route: 打开 /autopilot
        Route->>Job: fetchLatestGenerationJob()
        Job-->>Route: latestJob.stage = runtime_capability
        Route->>Pin: resolveRailSubStage(runtime_capability)
        Pin-->>Rail: currentSubStage = runtime_capability
        Rail-->>User: 展示 效果预览 / STEP 06
    end

    rect rgb(248, 248, 248)
        Note over User,Assets: 返回上一步：只是回看，不删除资产
        User->>Rail: 点击「返回上一步」
        Rail->>Pin: setPinnedSubStage(spec_tree)
        Pin-->>Rail: currentSubStage = spec_tree
        Rail-->>User: 展示 SPEC树 + SPEC规格文档 合并页 / STEP 05
        Note over Assets: SPEC树、SPEC文档、效果预览、运行时能力仍然保留
    end

    rect rgb(248, 248, 248)
        Note over User,Assets: 再返回上一步：回到外层路线页，仍然只是回看
        User->>Rail: 点击「返回上一步」
        Rail->>Route: onNavigateWorkflowStage(input)
        Route->>Pin: resetPin()，清掉 ?sub
        Route->>Route: workflowStageOverride = input
        Route-->>User: 展示 目标输入 / 输入记录 / 澄清 / 路线
        Note over Assets: 下游资产仍然保留，只是当前页面不展示右栏
    end

    rect rgb(255, 247, 237)
        Note over User,Assets: 推荐新增：从这里重新规划，才清掉下游
        User->>Route: 点击「从这里重新规划」
        Route-->>User: 确认提示：会清掉旧 SPEC/预览/运行时结果
        User->>Route: 确认重新规划
        Route->>Pin: resetPin()
        Route->>Route: workflowStageOverride = input
        Route->>Assets: 本地清空 downstream state
        Assets-->>Route: 清 specTree / specDocuments / effectPreview / prompt / runtime / handoff
        Route->>Job: create new generation branch 或 reset downstream artifacts
        Job-->>Route: 新的 route/input 状态
        Route-->>User: 回到可重新输入、澄清、选路线的页面
    end

    rect rgb(236, 253, 245)
        Note over User,Assets: 用户真的改上游内容时，也自动使下游失效
        User->>Route: 修改目标 / 重新澄清 / 重新生成路线 / 重新选路线
        Route->>Assets: invalidateDownstream(from = 当前阶段)
        Route->>Job: 生成新的 job 或新版本资产
        Job-->>Route: 返回新的 RouteSet / Selection / SPEC seed
        Route-->>User: 展示新流程结果
    end
```

## 页面级回退规则

| 当前用户看到的页面 | 点击返回上一步后 | 是否删除下游资产 | 原因 |
| --- | --- | --- | --- |
| 页面 3：效果预览 / 后续运行时结果 | 页面 2：SPEC 树 + SPEC 规格文档 | 否 | 用户只是回看规格产物 |
| 页面 2：SPEC 树 + SPEC 规格文档 | 页面 1：输入 / 澄清 / 路线 | 否 | 用户只是回看上游决策 |
| 页面 1：输入 / 澄清 / 路线 | 不再继续回退，或退出 Autopilot | 否 | 已经是 Autopilot 流程入口页 |
| 页面 1 点击「从这里重新规划」 | 留在页面 1 并开启新生成链路 | 是 | 这是显式重来动作 |
| 页面 1 直接修改目标 / 澄清 / 路线 | 留在页面 1 或进入新生成链路 | 是 | 上游发生变化，旧下游已经不可信 |

## 当前问题对应的修正点

旧逻辑容易出错的地方：

```text
STEP 06 effect_preview
  -> 返回
STEP 05 spec_documents
  -> 返回
STEP 04 spec_tree
```

这看起来像“按 STEP 回退”，但产品上 `STEP 04` 和 `STEP 05` 是同一个页面，所以第二次回退会显得没有动。

推荐修正为页面级回退：

```text
effect_preview / runtime_capability
  -> 返回
spec_documents + spec_tree 合并页
  -> 返回
input / clarification / route 页面
```

对应实现语义：

```text
effect_preview folded
  -> setPinnedSubStage(spec_tree)

spec_documents/spec_tree 合并页
  -> onNavigateWorkflowStage(input)
  -> resetPin()

input/clarification/route 页面
  -> 返回按钮禁用，或作为 Autopilot 流程入口
```

## 关键判断

`返回上一步` 不应该承担“重新生成”的职责。它只是导航回看。

如果用户想重新生成，应提供一个明确动作，例如：

```text
从这里重新规划
```

这个动作可以清理下游，并且最好有确认提示，因为它会丢弃旧的 SPEC、效果预览、运行时结果。
