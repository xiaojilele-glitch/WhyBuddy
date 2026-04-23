# 任务清单：文件翻译节点

> 本次对账依据 2026-04-23 当前仓库实现与测试重新核查，重点核对了：
> `shared/web-aigc-file-translation.ts`、`server/routes/node-adapters/file-translation-node-adapter.ts`、
> `server/routes/file-translation.ts`、`server/tests/file-translation-node-adapter.test.ts`、
> `server/tests/file-translation-routes.test.ts`。
> 本轮结论已更新：4 项任务已经形成最小闭环，可保持已完成状态。

- [x] 定义翻译输入输出结构
  - `shared/web-aigc-file-translation.ts` 已定义 `file_translation` 节点的共享契约，包括：
    - 节点输入 `FileTranslationNodeInput`
    - 文件输入 `FileTranslationSourceFileInput`
    - 结构分段 `FileTranslationSegment`
    - 产物输出 `WebAigcFileTranslationArtifact`
    - 执行结果 `FileTranslationNodeExecutionResult`
  - 输出结构已覆盖：
    - `sourceFile`
    - `translation.text`
    - `translation.segments`
    - `artifact`
    - `boundary`
    - `branch`
    - `observability`
  - 结论：输入输出边界已明确，可勾选。

- [x] 增加文件结构保留策略
  - `server/routes/node-adapters/file-translation-node-adapter.ts` 已实现轻量结构识别与保留：
    - Markdown 标题
    - 列表项
    - 引用行
    - 普通段落
    - 空行分隔
  - 翻译过程中会保留结构标记，仅对正文文本执行翻译，确保：
    - 标题层级不丢失
    - 列表顺序不被打平
    - 空行与段落边界可重建
  - 结论：最小结构保留策略已落地，可勾选。

- [x] 支持输出产物文件
  - adapter 已支持把翻译结果登记为可下载产物，并输出：
    - `outputId`
    - `artifact.name`
    - `artifact.mimeType`
    - `artifact.downloadUrl`
    - `artifact.path`
  - `server/routes/file-translation.ts` 已提供：
    - `POST /api/file-translation/nodes/execute`
    - `GET /api/file-translation/outputs/:outputId/:filename`
  - 路由测试已验证执行后可直接取回翻译产物。
  - 结论：文件产物闭环已形成，可勾选。

- [x] 验证大文件翻译边界
  - adapter 已对以下边界进行校验：
    - `limits.maxChars`
    - `limits.maxSegments`
  - 当输入过大时，会拒绝执行并返回明确错误信息，避免把超大文件直接压入最小闭环链路。
  - `server/tests/file-translation-node-adapter.test.ts` 与
    `server/tests/file-translation-routes.test.ts` 已覆盖：
    - 正常翻译
    - 结构保留
    - 产物下载
    - 超限失败
    - 非法 nodeType / 缺失内容校验
  - 结论：大文件翻译边界验证已收口，可勾选。
