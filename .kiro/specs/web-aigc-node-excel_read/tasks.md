# 任务清单：Excel 读取节点

- [x] 定义 `excel_read` 输入输出，覆盖工作簿、工作表、范围、表头与结构化表格结果。
- [x] 支持工作表和范围配置，包括 `sheetName / sheetIndex / range / headerRow / dataStartRow / maxRows`。
- [x] 验证结构化数据格式，输出列定义、行记录、矩阵预览与数值/维度字段校验摘要。
- [x] 与 `dynamic_chart` 联动兼容，补充 `categoriesField / seriesFields / rows / suggestedChartType` 输出。
