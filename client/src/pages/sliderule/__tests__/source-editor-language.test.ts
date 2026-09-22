import { describe, expect, it } from "vitest";
import {
  sourceEditorLanguage,
  sourceEditorUsesJsx,
  sourcePathParts,
} from "../project-runtime/source-editor-language";

describe("工程源码编辑器按路径选语言", () => {
  it("tsx / ts / mjs 走 javascript，json / md / sql 走对应包", () => {
    expect(sourceEditorLanguage("src/components/mockData.ts")).toBe(
      "javascript"
    );
    expect(sourceEditorLanguage("src/App.tsx")).toBe("javascript");
    expect(sourceEditorLanguage("server.mjs")).toBe("javascript");
    expect(sourceEditorLanguage("package.json")).toBe("json");
    expect(sourceEditorLanguage("README.md")).toBe("markdown");
    expect(sourceEditorLanguage("db/schema.sql")).toBe("sql");
  });

  it("tsx / jsx / html 开 JSX，纯 .ts 不开——不然普通 TS 会被 JSX 高亮搅乱", () => {
    expect(sourceEditorUsesJsx("src/App.tsx")).toBe(true);
    expect(sourceEditorUsesJsx("index.html")).toBe(true);
    expect(sourceEditorUsesJsx("src/types.ts")).toBe(false);
    expect(sourceEditorUsesJsx("server.mjs")).toBe(false);
  });

  it("路径切成面包屑，空段扔掉", () => {
    expect(sourcePathParts("src/components/mockData.ts")).toEqual([
      "src",
      "components",
      "mockData.ts",
    ]);
    expect(sourcePathParts("/src//App.tsx/")).toEqual(["src", "App.tsx"]);
  });
});
