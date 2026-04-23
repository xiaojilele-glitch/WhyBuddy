# 任务清单：OCR 识别节点

- [x] 定义 OCR 输入输出
  - [x] 新增 `shared/web-aigc-ocr-recognition.ts`，统一 `ocr_recognition` 节点输入、输出、artifact 与上下文契约
  - [x] 输入支持多图片 OCR，输出统一聚合文本、逐图结果、页面信息与片段位置信息
- [x] 对接 vision 路由
  - [x] 新增 `server/routes/ocr-recognition.ts` 与 `server/routes/node-adapters/ocr-recognition-node-adapter.ts`
  - [x] 复用 `server/core/ocr-provider.ts` 与 `server/core/vision-output.ts`，保持现有 OCR 识别与 artifact 产出链路
- [x] 支持位置信息输出
  - [x] 透传 `fragments[].page / region` 与 `pages[].page / text`
  - [x] 将 OCR 结果、页面信息与 artifact 元数据写回 `context.ocrRecognition`
- [x] 验证大图与多页场景
  - [x] 覆盖 OCR 文本提取、artifact 元数据返回、多页/多图页面透传、缺失识别结果 fallback 与持久化失败场景
