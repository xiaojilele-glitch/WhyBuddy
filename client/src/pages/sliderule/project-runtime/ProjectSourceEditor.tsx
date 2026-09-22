/**
 * 工程源码档的 CodeMirror 6 编辑器（可写）。
 *
 * 懒加载入口：ProjectWorkspacePanel 用 React.lazy 引进来，不进主包。
 * 行号 / 折叠 / 当前行 / github 亮色高亮——对照 2026-09-15 Manus
 * TicketStream 那张源码截图，不再用裸 textarea。
 */
import React, { forwardRef, useImperativeHandle, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { githubLight } from "@uiw/codemirror-theme-github";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import {
  sourceEditorLanguage,
  sourceEditorUsesJsx,
} from "./source-editor-language";

type EditorViewLike = {
  focus: () => void;
  dispatch: (tr: {
    selection: { anchor: number; head: number };
    scrollIntoView: boolean;
  }) => void;
  state: { doc: { length: number } };
};

export type ProjectSourceEditorHandle = {
  reveal(from: number, to: number): void;
};

function extensionsFor(path: string) {
  const language = sourceEditorLanguage(path);
  if (language === "json") return [json()];
  if (language === "markdown") return [markdown()];
  if (language === "sql") return [sql()];
  return [
    javascript({
      typescript: true,
      jsx: sourceEditorUsesJsx(path),
    }),
  ];
}

const ProjectSourceEditor = forwardRef<
  ProjectSourceEditorHandle,
  {
    path: string;
    value: string;
    readOnly?: boolean;
    onChange: (next: string) => void;
    onReady?: () => void;
  }
>(function ProjectSourceEditor(
  { path, value, readOnly = false, onChange, onReady },
  ref
) {
  const view = useRef<EditorViewLike | null>(null);
  useImperativeHandle(ref, () => ({
    reveal(from, to) {
      const cm = view.current;
      if (!cm) return;
      const max = cm.state.doc.length;
      const anchor = Math.max(0, Math.min(from, max));
      const head = Math.max(0, Math.min(to, max));
      cm.dispatch({
        selection: { anchor, head },
        scrollIntoView: true,
      });
      cm.focus();
    },
  }));
  return (
    <div
      data-testid="project-source-editor"
      data-editor-path={path}
      className="min-h-0 flex-1 overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-[12px] [&_.cm-scroller]:leading-5"
    >
      <CodeMirror
        value={value}
        theme={githubLight}
        height="100%"
        style={{ height: "100%" }}
        readOnly={readOnly}
        editable={!readOnly}
        indentWithTab
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          bracketMatching: true,
          autocompletion: true,
          indentOnInput: true,
        }}
        extensions={extensionsFor(path)}
        onChange={onChange}
        onCreateEditor={next => {
          view.current = next;
          onReady?.();
        }}
      />
    </div>
  );
});

export default ProjectSourceEditor;
