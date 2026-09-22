/**
 * 组件库那一页的**直挂台**（dev-only，/components-library.html）。
 *
 * ## 为什么需要它
 *
 * 2026-08-08 用户报「来源筛选无效」：pill 上写着「来源: Ant Design」，列表
 * 纹丝不动（useMemo 漏了依赖，命中旧结果）。修完要确认真的能筛，却发现
 * **确认这件事没有便宜的办法**——这一页挂在应用壳里，要登录、要点进去。
 *
 * 于是把它单独挂出来。这一页本身不吃任何 props（`<LazyComponentsLibraryPage />`
 * 就是这么用的），直接挂即可。
 *
 * 跟 base-catalog 台子的分工：那边是**每条能不能渲染**（存活），这边是
 * **这一页的交互对不对**（筛选、切档、搜索）。同一条规矩：不进生产产物。
 */
import ComponentsLibraryPage from "@/pages/sliderule/ComponentsLibraryPage";

export function ComponentsLibraryHarness() {
  return (
    // **必须是 overflow:auto**，不能是 hidden。
    //
    // 墙是虚拟滚动的，滚动源由 useScrollerIn 找「最近的可滚动祖先」定
    // （真实应用里是 dashboard 的 .native-content，overflow:auto）。台子上写成
    // hidden 的话找不到可滚祖先、退回 window，而 window 又因为 100vh 根本不滚
    // ——量出来的 scrollTop 跟真实应用对不上，台子会给出假结论。
    //
    // 第一版就是 hidden，害我把「搜索结果一张卡都不渲染」当成产品 bug 追了半天。
    <div style={{ height: "100vh", overflow: "auto" }}>
      <ComponentsLibraryPage />
    </div>
  );
}
