# 任务清单：向量删除节点

> 本次对账依据 2026-04-23 当前仓库实现与测试重新核查，重点核对了：
> `shared/web-aigc-vector-delete.ts`、`server/web-aigc/vector-delete-adapter.ts`、`server/routes/vector-delete.ts`、`server/tests/vector-delete-adapter.test.ts`、`server/tests/vector-delete-routes.test.ts`。
> 本轮结论已更新：4 项任务已经形成最小闭环，可保持已完成状态。

- [x] 定义向量删除输入输出
  - `shared/web-aigc-vector-delete.ts` 已定义 `vector_delete` 的共享契约：
    - 删除输入 `VectorDeleteActionInput`
    - 删除目标 `VectorDeleteTarget`
    - 确认结构 `VectorDeleteConfirmation`
    - 治理快照 `VectorDeleteGovernanceSnapshot`
    - 影响面摘要 `VectorDeleteImpactSummary`
    - 执行结果 `VectorDeleteActionResult`
  - 输入已支持两类删除目标：
    - `ids`
    - `sourceId`
  - 输出已包含：
    - `deletedIds`
    - `status`
    - `governance`
    - `impact`
    - `confirmation`
  - 结论：输入输出边界已明确，可勾选。

- [x] 增加二次确认机制
  - `server/web-aigc/vector-delete-adapter.ts` 已实现确认保护：
    - 所有删除都要求 `confirmation.confirmed=true`
    - 多记录删除或按 `sourceId` 删除时，额外要求 `confirmationText`
    - `confirmationText` 需包含：
      - `namespace`
      - `collection`
      - 删除条数
      - `sourceId`（当按 `sourceId` 删除时）
  - 单条 `id` 删除允许轻量确认，避免把最小闭环做得过重。
  - 结论：确认保护已真正接入删除链路，可勾选。

- [x] 写入审计与影响分析
  - adapter 已复用现有：
    - `MetadataStore`
    - `VectorStoreAdapter.delete()`
    - `PermissionCheckEngine`
    - `AuditLogger`
  - 审计日志已覆盖：
    - `denied`
    - `approval_required`
    - `completed`
    - `failed`
  - 影响面摘要已包含：
    - `requestedDeleteCount`
    - `matchedChunkCount`
    - `deletedChunkCount`
    - `remainingChunkCount`
    - `matchedSourceIds`
    - `affectedProjectIds`
    - `affectedSourceTypes`
  - 结论：审计和影响面摘要已落地，可勾选。

- [x] 验证误删保护策略
  - `server/tests/vector-delete-adapter.test.ts` 已覆盖：
    - 权限拒绝
    - 手动审批
    - 按 `sourceId` 删除
    - 按 `ids` 删除
    - 缺少保护性确认文本时拒绝执行
  - `server/tests/vector-delete-routes.test.ts` 已覆盖：
    - 参数缺失返回 `400`
    - `approval_required` 映射为 `409`
    - `completed` 映射为 `200`
  - 结论：误删保护和 HTTP 状态码映射已具备最小验证闭环，可勾选。
