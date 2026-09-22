/**
 * 基础组件库 · 自定义组件档（2026-08-08）。
 *
 * ## 这一档是怎么来的
 *
 * 用户的原话：「基础组件是不是可以增加一项『自定义组件』」。
 *
 * 结论是该加，而且**它早就有一个成员了**——`ECharts` 一直混在 antd 那档里，
 * 它的说明写着「它不是 Ant Design 组件，但已装在依赖里，是图表这项能力的
 * 唯一来源」。所以这不是新发明一个分类，是把一条已经存在的隐含分类标出来。
 *
 * ## 供给从哪来：把 amis 当地图，不当零件
 *
 * 查 amis-ui 那 120 个组件时，逐个跟 antd 对了一遍：88 个是重的（`Radios`
 * = Radio、`Rating` = Rate、`Range` = Slider、七八种 `*Selection` 全是
 * Cascader/Checkbox 的变体），**真正 antd 没有的只有 26 个**。而那 26 个
 * 本身也是别人库的封装——CodeMirror、Tinymce、百度/高德地图、react-pdf、
 * signature。
 *
 * 所以正确用法是**照着那 26 个的清单直接接原始库**，而不是抄 amis 的封装。
 * 理由不是许可证（Apache-2.0，用户明确说过不用管），是主题：amis-ui 每个
 * 组件都被 `themeable()` 包着，样式走它自己的 SCSS 变量体系（cxd / antd /
 * ang / dark 四套主题文件）。拿一个组件就得拖 `amis-core` 加它整套 SCSS
 * 构建，跟我们的 ConfigProvider 是两套东西——**视觉会分裂成两套**。
 *
 * ## 这一批：零新依赖
 *
 * 下面每一个都用**已经装在依赖里**的库。这不是巧合——先把装着没用的挖干净，
 * 是这个项目已经吃到两次红利的路子（ProComponents 那 117 个、阶段④那批
 * ProForm 控件都是这么来的）。
 *
 *     CodeMirror 6      @uiw/react-codemirror + 四个 lang 包 → 代码/JSON/SQL/Markdown 编辑
 *     react-markdown    → Markdown 渲染
 *     xlsx              → 表格导出 Excel
 *     （无依赖）         → 手写签名板，canvas 五十行
 *
 * ## 还差的，以及为什么还没做
 *
 *     PDF 查看器   pdfjs-dist 已装（workflow-attachments 在用它抽文本），
 *                  但**渲染**要一份示例 PDF 资源，且中文字体嵌入是另一摊事
 *     富文本编辑   没有已装的库。自己拿 contentEditable 造一个质量没保证，
 *                  该走「引一个成熟库」的决策，不该在这里顺手发明
 *     地图选点     百度/高德都要 API key —— 是产品决策不是接线
 *     条形码       没有已装的库
 *

 * ## 实现搬去哪了（2026-08-10）
 *
 * 下面这些组件的**实现**已经搬到 `custom-components.tsx`，这个文件只剩
 * "怎么展示"。搬的理由：审用量时发现自定义档 7 个组件零区块引用，根因是
 * 它们只以"演示件"的形态存在——`render` 里那段自给自足的 JSX 没有
 * value/onChange，运行期的区块拿不来用。抽出去之后同一份实现两个消费方，
 * 组件库这一页不传 onChange（纯展示），区块传（干活）。
 */

import React from "react";

import type { BaseComponentDef } from "./base-catalog-types";
import {
  CodeEditor,
  ExcelExportButton,
  JsonEditor,
  MarkdownEditor,
  MarkdownView,
  SignaturePad,
  SqlEditor,
} from "./custom-components";

/**
 * 编辑器条目的样板：四个语言档只差组件和示例文本。
 *
 * 写成对象字面量而不是工厂调用，是因为 `scripts/generate-block-component-usage.mjs`
 * 的 `catalogNames()` 只认数组里的**对象字面量**上的 `name`——工厂调用它读不到，
 * 于是这四个名字此前根本不在"已知组件"名单里。名单是用量统计的白名单，不在
 * 名单里的组件被区块用上了会直接报错。
 */
const editorItem = (
  Component: React.ComponentType<{ value: string }>,
  value: string
) => ({
  group: "数据录入" as const,
  platform: "pc" as const,
  source: "custom" as const,
  render: () => <Component value={value} />,
});

export const CUSTOM_BASE_COMPONENTS: BaseComponentDef[] = [
  {
    name: "CodeEditor",
    label: "代码编辑器",
    description:
      "CodeMirror 6：行号、语法高亮、折叠。规则脚本、模板表达式这类要写代码的字段用它，比多行文本强得多。",
    ...editorItem(
      CodeEditor,
      "function total(rows) {\n  return rows.reduce((s, r) => s + r.amount, 0);\n}"
    ),
  },
  {
    name: "JsonEditor",
    label: "JSON 编辑器",
    description: "带 JSON 语法高亮与括号匹配。配置项、接口映射这类结构化字段的录入方式。",
    ...editorItem(JsonEditor, '{\n  "enabled": true,\n  "retries": 3,\n  "tags": ["甲", "乙"]\n}'),
  },
  {
    name: "SqlEditor",
    label: "SQL 编辑器",
    description: "SQL 语法高亮。报表的自定义查询条件、数据集定义这类场景。",
    ...editorItem(
      SqlEditor,
      "select name, count(*) as n\nfrom items\ngroup by name\norder by n desc;"
    ),
  },
  {
    name: "MarkdownEditor",
    label: "Markdown 编辑器",
    description: "Markdown 语法高亮。公告、知识库、操作手册的编写侧。",
    ...editorItem(MarkdownEditor, "## 标题\n\n- 条目一\n- 条目二\n\n> 引用一段说明"),
  },
  {
    name: "MarkdownView",
    label: "Markdown 渲染",
    description:
      "把 Markdown 渲染成正文，支持表格、任务列表等 GFM 扩展。与 MarkdownEditor 是同一份内容的读写两侧。",
    group: "数据展示",
    platform: "pc",
    source: "custom",
    render: () => (
      <MarkdownView text={"### 小标题\n\n| 列甲 | 列乙 |\n|---|---|\n| 一 | 二 |\n\n- [x] 已完成\n- [ ] 未完成"} />
    ),
  },
  {
    name: "SignaturePad",
    label: "手写签名板",
    description:
      "canvas 手写签名，鼠标/触屏/手写笔通吃。审批留痕、收货确认这类要「本人签字」的环节。",
    group: "数据录入",
    platform: "pc",
    source: "custom",
    render: () => <SignaturePad />,
  },
  {
    name: "ExcelExportButton",
    label: "导出 Excel",
    description:
      "把当前数据写成 .xlsx 下载。内部系统里「能不能导出」几乎是每个列表页都会被问的一句。",
    group: "通用",
    platform: "pc",
    source: "custom",
    render: () => <ExcelExportButton />,
  },
];
