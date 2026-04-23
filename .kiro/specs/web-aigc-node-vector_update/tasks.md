# 任务清单：向量更新节点

- [x] 定义向量更新输入输出
  - 已新增 `shared/web-aigc-vector-update.ts`，统一 `vector_update` 的请求参数、治理快照、影响条数与状态返回。
  - 支持两种选择方式：按 `ids` 精确更新，或按 `sourceId` 批量更新同源 chunk 的 metadata。
- [x] 增加命名空间与权限校验
  - 已在 `server/web-aigc/vector-update-adapter.ts` 中复用命名空间/collection 校验规则，并走 `PermissionCheckEngine` 的 `database:update` 治理链路。
  - 资源命名显式带上 `vector_update`，以复用现有向量写治理策略和审批门禁。
- [x] 写入审计日志
  - 已复用 `AuditLogger`，覆盖权限拒绝、审批拦截、向量库不可用、metadata 更新成功四类审计事件。
  - 审计元数据中保留 `namespace / collection / projectId / matchedRecords / updatedRecords / selectionMode` 等治理信息。
- [x] 设计失败回滚策略
  - 当前实现采用“metadata patch 优先”的安全降级策略，不直接修改底层向量值，只更新 `MetadataStore` 中的 `metadata_json`。
  - 返回结果已明确声明回滚限制：当前不支持向量级自动回滚；如需真实向量重算，应走后续重嵌入流程。
