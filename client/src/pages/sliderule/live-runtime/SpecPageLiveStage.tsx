/**
 * 推演中的右侧舞台：spec-first 第 3 步一出页面就渲染出来。
 *
 * ## 为什么现在能做，以前不能
 *
 * 以前右侧在推演期只有三个跳动的点。那不是偷懒——**当时确实没有能看的
 * 东西**：老链路要等五系统模型齐了才谈得上页面，模型齐了就等于跑完了。
 *
 * 新链路不一样：第 3 步直接产出**一整份能独立打开的 HTML**，第一页在整轮
 * 的第二分钟就到。那四五分钟的转圈不是"还没算出来"，是"算出来了没往外发"。
 *
 * ⚠ 这不推翻 2026-07-14 那条裁决（执行期不看中间过程）。那条说的是系统屏、
 * 证据看板、起草 JSON——**过程的碎片**，看了也拼不出东西。这里上屏的是
 * 成品页面本身，跟最后交付的是同一份 HTML。两者不是一类东西。
 *
 * ## 渲染走沙箱 iframe，不走 Shadow DOM —— 这条是踩出来的
 *
 * 第一版挂的是 BoundHtmlSurface（DOMPurify + closed Shadow DOM）。真机一跑，
 * 右侧是一堆裸文字加一个撑满屏的蓝图标：**一条 CSS 都没生效**。
 *
 * 病因不是"样式丢了"，是页面的**全部**样式来自两个 script（Tailwind Play CDN
 * 的运行时 JIT + 内联的 `tailwind.config` 配色），而消毒层按定义要摘掉 script。
 * 而且这不是"放行 script 就能修"：Play CDN 扫 document 再往 document.head 注
 * 样式，影子根里的元素它扫不到、注出来的也跨不过影子边界——
 * **Shadow DOM 与 CDN 版 Tailwind 在原理上不兼容。**
 *
 * 换成 sandbox iframe（v0 / bolt / screenshot-to-code 的同款做法）：脚本能跑，
 * 但跑在不透明源里，外带与表单提交由框内 CSP 掐死。判据与取舍写在
 * sandboxed-page-frame.tsx 头注，那边是唯一的安全边界所在。
 *
 * ## 素颜页与打过孔的页
 *
 * `bound=false` 是第 3 步的素颜页：还没打 data-* 孔（孔要等第 6.5 步，那时
 * 实体字段才定死校验过）。角标如实说明，不装作已经接上了。
 *
 * 填数走 deriveBindingSource（五系统模型 + 运行时状态），跟老区块渲染**共用
 * 同一份数据**——各读各的等于同一个应用有两份互不相干的数据。
 *
 * ## 页签条下架（2026-08-14 晚）
 *
 * 顶部那排 p1…pN 页签删了：页面自己的左侧菜单已经能切页（data-page-id →
 * onNavigate），同一件事两套控件是歧义不是便利——菜单才是真用户看到的那套。
 * 页签上挂着的两样如实信息**收编不删**：生成进度与填数报告降级成画布左下角
 * 两枚小徽标（与右下角分辨率徽标同一形制）。选页判定抽成 resolveActivePageId
 * 纯函数单测钉着——「手动选过的页不被新到达的页挤走」这条行为的入口只剩
 * 框内菜单点击，jsdom 跑不了 srcdoc，组件层测不到它，判定就必须可单测。
 */

import React from "react";

import { HtmlAppSurface } from "./html-app-surface";
import {
  useScaleToFit,
  specPageViewport,
  PHONE_STAGE_MAX_SCALE,
} from "./canvas-scale";
import { STAGE_FRAME_PAD, phoneFramePad } from "./stage-frame-style";
import { ScaledStageFrame } from "./ScaledStageFrame";
import {
  DEVICE_PRESETS,
  findDevicePreset,
  loadDevicePresetId,
  saveDevicePresetId,
} from "./device-presets";
import { deriveBindingSource } from "./derive-binding-source";
import { canonicalPageId } from "../page-id-alias";
import { liveStatuses, liveStatusText } from "./connector-rows";
import type { ActionGates, BindingActionEvent } from "./html-binding-runtime";
import type { RuntimeState } from "./live-runtime";
import type { FiveSystemModel } from "../system-screens/five-system-model";
import { useStudioLayout } from "../StudioLayoutContext";

export interface SpecPageLive {
  pageId: string;
  html: string;
  current: number;
  total: number;
  bound: boolean;
  /** desktop 1920×1080 / tablet 1112×834 / phone 390×844。
   *  缺席按桌面兜底——老事件/老存档没有这个字段，行为与从前一致。
   *  ⚠ tablet 不是 phone：机框只给竖屏，平板走横屏画布。 */
  device?: "desktop" | "phone" | "tablet";
  /** 导航有这一项、落库却没有成品 HTML。点进来要停在失败页，
   *  不能回落最新页假装没点。缺席 = 成品页。 */
  missing?: boolean;
  /** 导航里这一页的人话名（"团长工作台"）。画布档的画板标题要它——
   *  一屏五块画板全叫 p1…p5 等于没标。
   *  ⚠ **只有落库那条来源带得出**（livePagesFromSpec 从 navItems 取）；
   *    推演中走 SSE 的 spec_page 事件没有这个字段，那条路由
   *    canvas-board-layout.artboardLabel 从 HTML 的 <title> 兜底。
   *    两条来源必须给出同一个结果，别只补一条。 */
  name?: string;
  /** 这一页背过的旧 id。页面 HTML 里的 `data-page-id` 是改名**之前**烧进去
   *  的，点菜单拿到的往往是这里的某一个——照 friendly_id 的 has_many :slugs，
   *  历史跟着记录本身走，不另立平行清单。解析走 canonicalPageId。
   *  ⚠ 只有落库那条来源带得出（livePagesFromSpec 从 pageIdAliases 反转）；
   *    推演中走 SSE 的页孔与页键同源，本来就对得上，缺席是常态。 */
  aliasIds?: readonly string[];
}

export interface SpecPageLiveStageProps {
  pages: SpecPageLive[];
  /** 当前步骤一句话（"逐页画界面（并发）"…）——右上角标注，不重复左栏 */
  statusLabel?: string | null;
  /** 还在推演中。角标据此说"生成中 n/m"还是"共 n 页"——**跑完了还挂着
   *  「生成中」是在撒谎**，用户会一直等一个不会再变的东西。 */
  running?: boolean;
  /** 五系统模型 + 运行时状态 → 页面上的 data-* 孔真的填得上数。
   *  ⚠ 缺任一个都只是"没数据"，不是"渲染失败"——角标如实说。 */
  model?: FiveSystemModel | null;
  runtime?: RuntimeState | null;
  /** 页面里的动作（新建/查看/编辑/转移）——交给宿主的运行时去改数据 */
  onAction?: (event: BindingActionEvent) => void;
  /** 角色上下文（权限门）。不传 = 不设卡。宿主务必 memo。 */
  gates?: ActionGates;
  /** 说明行右侧（角色切换）。Primer description 的 trailing visual。 */
  metaTrailing?: React.ReactNode;
  /** 游标：鼠标停在带绑定的元素上 */
  onHoverBinding?: (
    info: { attr: string; value: string; el: Element } | null
  ) => void;
  /** 初始选中的页。不传 = 跟最新到达的一页（推演场景，页面在陆续到达）；
   *  应用中心只读预览传落地页——那儿页面是一次到齐的，"最新"没有意义，
   *  开屏看到的应该是导航第一项，跟真用户进应用的第一眼一致。 */
  defaultPageId?: string | null;
  /** 页面 = 渲染出来的界面；代码 = 当前页交付的 HTML 原文（顶栏档位，
   *  不是设备。点了「应用」之后这里仍叫页面，避免跟 PC 桌面搅在一起）。 */
  view?: "page" | "code";
  /** 当前展示页变化时上报（游标面板要跟随页面切片）。 */
  onActivePageChange?: (pageId: string) => void;
  className?: string;
}

/**
 * 选页判定（纯函数，单测钉着）：手动选过就听手动的；推演中没选过跟最新
 * 到达的页；跑完没选过落落地页（导航第一项成品），不许停在最后画完的那页。
 * ⚠ 存 pageId 而不是下标：下标会被新到达的页面挤走，表现是
 * "我明明点了甲页，它自己跳到乙页去了"。
 */
export function resolveActivePageId(
  picked: string | null,
  pages: readonly Pick<SpecPageLive, "pageId" | "missing" | "aliasIds">[],
  opts?: { running?: boolean; landingPageId?: string | null }
): string | null {
  // 先按当前 id、再按别名（canonicalPageId 里是 friendly_id 的 `super ||`
  // 那个顺序）。⚠ 判定必须在这条纯函数里也认别名，不能只在 onNavigate 归一化：
  // jsdom 跑不了 srcdoc，框内菜单点击组件层测不到，这里是唯一测得着的接缝。
  if (picked) {
    const canon = canonicalPageId(picked, pages);
    if (canon) return canon;
  }
  const arrived = pages.filter(p => !p.missing);
  // 推演中跟最新到达的页。跑完若还跟最后一页，用户会停在 p3 打开态抽屉
  // （2026-08-20 巡检），而应用中心预览早已落导航第一项。
  if (opts && opts.running === false) {
    const land = opts.landingPageId;
    if (land && arrived.some(p => p.pageId === land)) return land;
    return arrived[0]?.pageId ?? pages[0]?.pageId ?? null;
  }
  return (
    arrived[arrived.length - 1]?.pageId ??
    pages[pages.length - 1]?.pageId ??
    null
  );
}

export function SpecPageLiveStage({
  pages,
  statusLabel = null,
  running = true,
  model = null,
  runtime = null,
  onAction,
  gates,
  metaTrailing = null,
  onHoverBinding,
  defaultPageId = null,
  view = "page",
  onActivePageChange,
  className = "",
}: SpecPageLiveStageProps): React.ReactElement | null {
  // 切页唯一入口是页面自己的左侧菜单（data-page-id → onNavigate）——
  // 顶部页签条 2026-08-14 晚下架，同一件事不留两套控件。
  const [picked, setPicked] = React.useState<string | null>(defaultPageId);
  // 填数报告：填了几个孔、哪些孔填不上。**如实展示**——填不上是模型的问题
  // （引用了不存在的实体/字段），拿假数据盖住等于把问题藏起来。
  const [report, setReport] = React.useState<{
    filled: number;
    problems: string[];
  } | null>(null);

  const source = React.useMemo(
    () => deriveBindingSource(model, runtime),
    [model, runtime]
  );

  // 视口按设备选：desktop 1920×1080 / 移动端按用户选的机型（默认 iPhone 12/13/14
  // 390×844，与改动前同一台）。一轮里所有页面同一设备（管道开头认一次），
  // 取第一个带 device 的页面即可。
  //
  // ⚠ 后端那个 device（desktop/phone）决定**生成什么**，是产物属性；下面这个
  //   presetId 只决定**用多大画布看**，是观看态。别把两者接到一起——那会变成
  //   "换个机型预览就触发重新生成"。
  const device = pages.find(p => p.device)?.device;
  const isPhone = device === "phone";
  const [presetId, setPresetId] = React.useState(loadDevicePresetId);
  const preset = findDevicePreset(presetId);
  const viewport = isPhone
    ? { w: preset.width, h: preset.height }
    : specPageViewport(device);
  const frame = preset.frame;
  const changeDevicePreset = React.useCallback((id: string) => {
    setPresetId(id);
    saveDevicePresetId(id);
  }, []);

  // 拖分栏时冻结缩放（2026-08-20）：见 useScaleToFit / StudioSplit 头注。
  // 没有 Provider（单测、应用中心）时不暂停——那边没有这条缝。
  const studioLayout = useStudioLayout();

  // ⚠ 必须在下面那个 `if (!active) return null` **之前**调用：hook 的调用
  //   顺序不能随渲染分支变化，放到早退之后第一帧就会炸 hook order。
  const { ref: fitRef, scale } = useScaleToFit(
    viewport.w,
    viewport.h,
    "contain",
    studioLayout?.resizing ?? false,
    isPhone ? phoneFramePad(frame) : STAGE_FRAME_PAD,
    isPhone ? PHONE_STAGE_MAX_SCALE : undefined
  );

  const activeId = resolveActivePageId(picked, pages, {
    running,
    landingPageId: defaultPageId ?? pages.find(p => !p.missing)?.pageId ?? null,
  });
  const active = pages.find(p => p.pageId === activeId) ?? null;

  // 当前页上报（游标面板跟随）。必须在早退之前——hook 顺序不能随分支变。
  React.useEffect(() => {
    if (activeId) onActivePageChange?.(activeId);
  }, [activeId, onActivePageChange]);

  if (!active) return null;

  const delivered = pages.filter(p => !p.missing);
  const total = Math.max(active.total || 0, delivered.length);
  const boundLabel = active.missing
    ? "本页未通过校验"
    : report
      ? report.filled > 0
        ? `已接数据 · 填了 ${report.filled} 处${
            report.problems.length
              ? ` · ${report.problems.length} 处填不上`
              : ""
          }`
        : active.bound
          ? "打过孔但没填上数据"
          : "尚未接数据"
      : active.bound
        ? "已接数据"
        : "尚未接数据";
  const boundTitle = active.missing
    ? "导航有这一项，生成时没有交出成品 HTML"
    : report?.problems.length
      ? `填不上的孔：\n${report.problems.slice(0, 6).join("\n")}`
      : active.bound
        ? "已接上数据（第 6.5 步打过 data-* 孔）"
        : "第 3 步的页面：还没接数据，孔要等实体字段定死之后才打";

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col gap-2 ${className}`}
      data-testid="sliderule-spec-page-stage"
      data-active-page={activeId ?? undefined}
    >
      {/* 接数 / 分辨率：Primer PageHeader 的 description。角色放这一行右侧
          （2026-08-20 用户原话），不要跟顶栏页面/透视挤在一起。 */}
      <div
        className="flex shrink-0 items-center gap-2 px-0.5 text-[11px] leading-4 text-stone-400"
        data-testid="sliderule-stage-meta"
      >
        {/* 真实数据源徽标。⚠ 从 runtime 自己推（liveStatuses），不靠外面传
            战报进来——战报刷新一次就没了，而数据还在。 */}
        {liveStatuses(runtime).length > 0 ? (
          <span
            data-testid="sliderule-live-source"
            data-empty={
              liveStatuses(runtime).some(s => s.empty) ? "1" : "0"
            }
            title="这张表的数据来自真实外部数据源；取不到时这里会明说没接上"
            className={`shrink-0 rounded px-1.5 py-0.5 ${
              liveStatuses(runtime).some(s => s.empty)
                ? "bg-[#fff7e6] text-[#d46b08]"
                : "bg-[#f6ffed] text-[#389e0d]"
            }`}
          >
            {liveStatusText(liveStatuses(runtime))}
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {/* 机型切换（2026-08-24）。位置对齐 Chrome DevTools 设备模式 / 微信
              开发者工具：都把机型下拉放在预览画布正上方那条信息行的最左，
              紧挨着分辨率读数——选完立刻能在右边看到尺寸变化。
              只在移动端档出现：桌面档是固定 1920×1080，没有"换台机器"的语义。 */}
          {isPhone && (
            <select
              value={preset.id}
              onChange={e => changeDevicePreset(e.target.value)}
              data-testid="sliderule-device-preset"
              aria-label="预览机型"
              title="换一台机器看：只改预览画布尺寸，不会重新生成页面"
              className="h-5 max-w-[10rem] cursor-pointer rounded border border-[#e5e7eb] bg-white px-1 text-[11px] text-stone-600 outline-none transition hover:border-[#d3d8e0] hover:bg-[#f8f9fb]"
            >
              {DEVICE_PRESETS.map(p => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          <span
            className="font-mono tabular-nums"
            data-testid="sliderule-spec-page-scale"
            title={`固定 ${viewport.w}×${viewport.h} 设计分辨率，按容器等比缩放显示${
              isPhone
                ? `，手机默认不超过 ${Math.round(PHONE_STAGE_MAX_SCALE * 100)}%`
                : ""
            }`}
          >
            {viewport.w}×{viewport.h} · {Math.round(scale * 100)}%
          </span>
          {running && (
            <span
              className="flex items-center gap-1"
              title={statusLabel ?? undefined}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#69b1ff]" />
              界面生成中 {delivered.length}/{total || delivered.length}
            </span>
          )}
          <span aria-hidden>·</span>
          <span data-testid="sliderule-spec-page-bound" title={boundTitle}>
            {boundLabel}
          </span>
        </div>
        {metaTrailing ? (
          <div
            className="ml-auto shrink-0"
            data-testid="sliderule-stage-meta-trailing"
          >
            {metaTrailing}
          </div>
        ) : null}
      </div>
      {view === "code" ? (
        /* 代码档：交付的 HTML 原文本体（不是模型投影）。看的与渲染的是同一份
           字符串——想核对某个 data-* 孔打没打上，这里一眼见底。 */
        <div
          className="min-h-0 flex-1 overflow-auto rounded-md border border-[#e9edf2] bg-[#1e293b] p-4"
          data-testid="sliderule-spec-page-code"
        >
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-slate-200">
            {active.html}
          </pre>
        </div>
      ) : (
        <>
          {/* 缩放画布：页面照固定视口画，就得在那个视口里看。手机框的描边算进
          layout（padding），不再用会溢出被切掉的 box-shadow。
          ⚠ 2026-08-20 午前满电青年：16:9 + items-center 曾让 Header 像掉下来，
          改成顶对齐。同日晚 City Walk：用户要垂直居中；正方形 1920×1920
          试过又改回 16:9，居中留下。改回 items-start，本条必须红。 */}
          <ScaledStageFrame
            viewport={viewport}
            scale={scale}
            canvasRef={fitRef}
            framed={isPhone}
            frame={frame}
            canvasTestId="sliderule-spec-page-canvas"
          >
            <HtmlAppSurface
              key={active.pageId}
              html={active.html}
              fillPhone={isPhone}
              className="bg-white"
              source={source}
              gates={gates}
              onAction={onAction}
              onNavigate={pid => {
                const canon = canonicalPageId(pid, pages);
                if (canon) setPicked(canon);
              }}
              onHoverBinding={onHoverBinding}
              onReport={r =>
                setReport({
                  filled: Object.values(r.filled).reduce((a, b) => a + b, 0),
                  problems: r.problems,
                })
              }
            />
          </ScaledStageFrame>
        </>
      )}
    </div>
  );
}
