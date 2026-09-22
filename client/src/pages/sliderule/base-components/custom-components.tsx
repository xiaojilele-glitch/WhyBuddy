/**
 * 自研基础组件的**实现**（2026-08-10 从 base-catalog-custom.tsx 抽出来）。
 *
 * ## 为什么要抽
 *
 * 审 209 个基础组件对 359 个区块的引用时数出来：自定义档 7 个组件
 * **一个都没有被任何区块用上**。查原因不是"不好用"，是它们**只存在于组件库
 * 那一页的示例里**——`base-catalog-custom.tsx` 里每个条目的 `render` 都是
 * 一段自给自足的演示，没有 value / onChange，运行期的区块拿不来用。
 *
 * 所以这个文件是把"演示件"升级成"零件"：同一份实现，两个消费方——
 *
 *     base-catalog-custom.tsx   组件库那一页的示例（不传 onChange，纯展示）
 *     live-runtime/*            真正的区块（传 value/onChange，是干活的）
 *
 * 放在 base-components/ 而不是 live-runtime/ 是因为分层方向：运行期依赖
 * 基础组件，反过来不成立。区块 import antd 和 import 这里，是同一件事。
 *
 * ## 导出名 = 目录里的组件名
 *
 * `CodeEditor` / `JsonEditor` / `SqlEditor` / `MarkdownEditor` 其实是同一个
 * CodeMirror 换语言包。之所以还是导出四个名字而不是一个带 `lang` 参数的，
 * 是因为**用量统计按导入名认组件**（scripts/generate-block-component-usage.mjs）：
 * 名字对不上，接了也统计不到，利用率数字就永远是假的。
 *
 * ## 重库一律懒加载
 *
 * CodeMirror（内核 + 四个语言包）、react-markdown、xlsx 三个都不进主包。
 * 组件库那一页要渲染两百多个示例，静态引进来等于开页先下一个编辑器；区块
 * 侧同理，一个转换面板不该让整个应用壳变重。
 */

import React from "react";
import { Button, Space, Tag, message } from "antd";

/** 编辑器共用的语言档。 */
type EditorLang = "javascript" | "json" | "sql" | "markdown";

const LazyCodeMirror = React.lazy(async () => {
  const [{ default: CodeMirror }, { githubLight }, js, json, sql, markdown] =
    await Promise.all([
      import("@uiw/react-codemirror"),
      import("@uiw/codemirror-theme-github"),
      import("@codemirror/lang-javascript"),
      import("@codemirror/lang-json"),
      import("@codemirror/lang-sql"),
      import("@codemirror/lang-markdown"),
    ]);
  const EXT: Record<EditorLang, () => unknown[]> = {
    javascript: () => [js.javascript({ typescript: true })],
    json: () => [json.json()],
    sql: () => [sql.sql()],
    markdown: () => [markdown.markdown()],
  };
  return {
    default: ({
      lang,
      value,
      onChange,
      height,
      readOnly,
    }: {
      lang: EditorLang;
      value: string;
      onChange?: (next: string) => void;
      height?: string;
      readOnly?: boolean;
    }) => (
      <CodeMirror
        value={value}
        theme={githubLight}
        height={height ?? "140px"}
        readOnly={readOnly}
        editable={!readOnly}
        // onChange 不传就是非受控示例；传了才是能干活的输入控件。
        onChange={onChange}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
        extensions={EXT[lang]?.() as never}
      />
    ),
  };
});

export interface CodeEditorProps {
  value: string;
  onChange?: (next: string) => void;
  height?: string;
  readOnly?: boolean;
  /** 加载时占位的高度，避免懒加载完成前整块塌下去。 */
  placeholderHeight?: number;
}

function editorOf(lang: EditorLang, testid: string) {
  const Editor = (props: CodeEditorProps) => (
    <React.Suspense
      fallback={
        <div
          style={{
            height: props.placeholderHeight ?? 140,
            background: "#fafafa",
            borderRadius: 6,
          }}
        />
      }
    >
      <div
        data-testid={testid}
        style={{ border: "1px solid #f0f0f0", borderRadius: 6, overflow: "hidden" }}
      >
        <LazyCodeMirror
          lang={lang}
          value={props.value}
          onChange={props.onChange}
          height={props.height}
          readOnly={props.readOnly}
        />
      </div>
    </React.Suspense>
  );
  Editor.displayName = testid;
  return Editor;
}

/** 代码编辑器（JS/TS 高亮）。规则脚本、模板表达式这类要写代码的字段。 */
export const CodeEditor = editorOf("javascript", "custom-code-editor");
/** JSON 编辑器。配置项、接口映射这类结构化字段。 */
export const JsonEditor = editorOf("json", "custom-json-editor");
/** SQL 编辑器。自定义查询条件、数据集定义、告警规则的查询表达式。 */
export const SqlEditor = editorOf("sql", "custom-sql-editor");
/** Markdown 编辑器。公告、知识库、评论正文的编写侧。 */
export const MarkdownEditor = editorOf("markdown", "custom-markdown-editor");

const LazyMarkdown = React.lazy(async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
  ]);
  return {
    default: ({ text }: { text: string }) => (
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    ),
  };
});

/** Markdown 渲染。与 MarkdownEditor 是同一份内容的读写两侧。 */
export function MarkdownView({ text, style }: { text: string; style?: React.CSSProperties }) {
  return (
    <React.Suspense fallback={<div style={{ height: 24 }} />}>
      <div data-testid="custom-markdown-view" style={{ fontSize: 13, lineHeight: 1.7, ...style }}>
        <LazyMarkdown text={text} />
      </div>
    </React.Suspense>
  );
}

/**
 * 签名板：canvas + 指针事件，无依赖。
 *
 * 审批场景要的就是这一个能力（amis 那边是 `signature`，背后是
 * signature_pad）。它简单到不值得引一个库：一支笔、一块画布、一个清除。
 *
 * 用 pointer 事件而不是 mouse + touch 两套：一套代码同时覆盖鼠标、触屏和
 * 手写笔，这正是 Pointer Events 存在的理由。
 *
 * `onChange` 回的是 canvas 的 dataURL。不传就是纯演示（组件库那一页）。
 */
export function SignaturePad({
  onChange,
  width = 320,
  height = 120,
}: {
  onChange?: (dataUrl: string) => void;
  width?: number;
  height?: number;
}) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  const drawing = React.useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    // 画布的 CSS 尺寸和位图尺寸不一定相等，按比例换算，否则笔迹会偏。
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    // 捕获指针：手滑出画布再滑回来，笔迹仍然连着，而不是断成两截。
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1f2937";
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    // 一笔画完才回调一次：pointermove 每像素回一次会把上层 state 冲爆。
    onChange?.(ref.current?.toDataURL("image/png") ?? "");
  };

  const clear = () => {
    const c = ref.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    onChange?.("");
  };

  return (
    <Space direction="vertical" data-testid="custom-signature-pad">
      <canvas
        ref={ref}
        width={width}
        height={height}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{
          border: "1px dashed #d9d9d9",
          borderRadius: 6,
          background: "#fff",
          touchAction: "none", // 不设的话触屏上会变成滚动页面，画不出来
          cursor: "crosshair",
        }}
      />
      <Space>
        <Tag color="default">在框内按住拖动</Tag>
        <Button size="small" onClick={clear}>
          清除
        </Button>
      </Space>
    </Space>
  );
}

/**
 * 导出按钮：xlsx 已装在依赖里（workflow-attachments 用它读表），这里用它写表。
 *
 * `rows` 不传就导出一份示例（组件库那一页）。
 */
export function ExcelExportButton({
  rows,
  fileName = "示例.xlsx",
  sheetName = "示例",
  label = "导出 Excel",
  disabled,
}: {
  rows?: Array<Record<string, unknown>>;
  fileName?: string;
  sheetName?: string;
  label?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const xlsx = await import("xlsx");
      const sheet = xlsx.utils.json_to_sheet(
        rows ?? [
          { 名称: "甲", 数量: 12 },
          { 名称: "乙", 数量: 8 },
        ]
      );
      const book = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(book, sheet, sheetName);
      xlsx.writeFile(book, fileName);
    } catch {
      // 点一下失败不该把整页搞崩——如实提示，不静默。
      message.error("导出失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="primary" loading={busy} disabled={disabled} onClick={run}>
      {label}
    </Button>
  );
}
