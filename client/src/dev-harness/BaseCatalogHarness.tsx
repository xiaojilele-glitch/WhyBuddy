/**
 * 基础组件目录的**逐条渲染台**（dev-only，/base-catalog.html）。
 *
 * ## 为什么需要它
 *
 * 2026-08-08 一次性往目录里加了 80 条（ProComponents 65 + 自定义 7 +
 * antd-mobile 补齐 6 + 日期变体）。每一条都带一个真实的 `render()`，任何
 * 一条写错的表现是**整面墙白屏**——React 里一个子组件抛错会掀翻整棵树。
 *
 * 而组件库那一页在应用壳里，要登录、要点进去，看到白屏也说不出是哪一条。
 * 这里把每条单独用错误边界包起来，谁炸了谁自己显示红框，别人照常渲染，
 * 页面顶部给出「N 条里 M 条炸了」和名单。
 *
 * ## 与 block-gallery 的分工
 *
 * block-gallery 看的是**区块**的长相（视觉 QA）；这里看的是**基础组件目录**
 * 的每一条能不能渲染出来（存活 QA）。同一条规矩：不进生产产物（vite 的构建
 * 入口只有 index.html）。
 */
import React from "react";
import { ConfigProvider } from "antd";

import {
  BASE_COMPONENTS,
  BASE_SOURCES,
  type BaseComponentDef,
} from "@/pages/sliderule/base-components/base-catalog";

/**
 * 单条的错误边界。
 *
 * **必须是 class**——React 到今天也只有 class 能当错误边界
 * （componentDidCatch / getDerivedStateFromError 没有 hook 版）。
 */
class Cell extends React.Component<
  { def: BaseComponentDef; onError: (name: string, msg: string) => void },
  { err: string | null }
> {
  state = { err: null as string | null };

  static getDerivedStateFromError(e: unknown) {
    return { err: String(e).slice(0, 200) };
  }

  componentDidCatch(e: unknown) {
    this.props.onError(this.props.def.name, String(e).slice(0, 200));
  }

  render() {
    const { def } = this.props;
    return (
      <div
        data-testid="catalog-cell"
        data-name={def.name}
        data-source={def.source ?? "?"}
        data-ok={this.state.err ? "0" : "1"}
        style={{
          border: `1px solid ${this.state.err ? "#ff4d4f" : "#f0f0f0"}`,
          borderRadius: 8,
          padding: 12,
          background: "#fff",
          // 定宽而不是 flex:1 —— 让最后一行的格子被拉成整行宽，会让"格子有没有
          // 撑爆"这件事没法量（第一版就是，末尾那条量出来 1468px 宽）。
          width: 340,
        }}
      >
        <div style={{ fontSize: 12, color: "#78716c", marginBottom: 8 }}>
          {def.name} · {def.label} · <span style={{ color: "#a8a29e" }}>{def.source}</span>
        </div>
        {this.state.err ? (
          <pre style={{ color: "#ff4d4f", fontSize: 11, whiteSpace: "pre-wrap", margin: 0 }}>
            {this.state.err}
          </pre>
        ) : (
          def.render()
        )}
      </div>
    );
  }
}

export function BaseCatalogHarness() {
  const [failed, setFailed] = React.useState<Array<[string, string]>>([]);
  const onError = React.useCallback(
    (name: string, msg: string) => setFailed(f => [...f, [name, msg]]),
    []
  );

  const bySource = BASE_SOURCES.map(s => ({
    ...s,
    count: BASE_COMPONENTS.filter(c => c.source === s.value).length,
  }));

  return (
    // 目录里的组件全按 antd 默认前缀写的；这里不套业务壳的 ConfigProvider
    // （那边把前缀改成了 agent-ant），套了反而跟真实组件库那一页不一致。
    <ConfigProvider>
      <div style={{ padding: 16, background: "#faf9f7", minHeight: "100vh" }}>
        <div
          data-testid="catalog-summary"
          data-total={BASE_COMPONENTS.length}
          data-failed={failed.length}
          style={{ marginBottom: 16, fontSize: 13 }}
        >
          <b>共 {BASE_COMPONENTS.length} 条</b>
          {"　"}
          {bySource.map(s => `${s.label} ${s.count}`).join("　")}
          {"　"}
          <span style={{ color: failed.length ? "#ff4d4f" : "#3f8600" }}>
            渲染失败 {failed.length}
          </span>
          {failed.length > 0 && (
            <pre style={{ fontSize: 11, color: "#ff4d4f" }}>
              {failed.map(([n, m]) => `${n}: ${m}`).join("\n")}
            </pre>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
          {BASE_COMPONENTS.map(def => (
            <Cell key={`${def.source}-${def.name}`} def={def} onError={onError} />
          ))}
        </div>
      </div>
    </ConfigProvider>
  );
}
