/**
 * 舞台预览框的外观：投影 + 描边 + 画布要预留的余量。
 *
 * ⚠ 2026-08-24 用户反馈"阴影这块能不能优化，比如内阴影"。真机量完发现问题
 * 不在配色，在**它根本没画出来**：
 *
 *   canvas 1368×764 / frame 1358×764 → gapTop 0、gapBottom 0，
 *   而 sliderule-spec-page-canvas 是 overflow:hidden。
 *
 * 也就是说 `0 8px 32px` 那 32px 模糊上下被整段切掉、左右只剩 5px。用户看到的
 * 是一条平切的硬边，自然觉得"不对"。三件事一起改才有用：
 *
 * 1. **留余量**。useScaleToFit 的 pad 参数本来就是干这个的——手机档早就传了
 *    `{x:36,y:48}`，注释写着"不扣的话 12px 外圈会被 overflow:hidden 切掉顶"。
 *    桌面档一直传 {0,0}，因为以前没有描边、切了也看不出来。代价是缩放比例掉
 *    2~4%（71% → 68% 量级），换阴影真的能显示出来。
 * 2. **分层**。单层大模糊是本仓旧写法；Tailwind 自己的整条标度
 *    （--shadow-sm…2xl，见 node_modules/tailwindcss/theme.css）全是两层
 *    "近距 + 远距 + 负 spread"，Material 3 的 key light / ambient light 同理。
 *    分层的落差才像真实光照，单层只是糊。
 * 3. **1px 描边**。舞台跑在 59%~85% 缩放下，纯投影的**顶边**永远最弱（阴影
 *    朝下偏移），低缩放下顶边就化没了。ring 把四条边一次定死——预览类工具
 *    （DevTools 设备模式、CodeSandbox、v0 预览）都是描边定边界、投影给层次。
 *
 * ⚠ 2026-08-24 第二轮，同一个用户又说"阴影被外层截断、看着很锋利"——**他是对
 * 的，第一轮只修了一半**。补了余量却没验证余量够不够：
 *
 *     阴影向下需要外扩 32px（0 24px 48px -16px → 24 + 48/2 - 16），
 *     而 pad y=36 居中均分只给到 18px  →  底边照切 14px。
 *
 * 根子在 **pad 是居中均分的，阴影却是朝下偏的**：顶边只要 1px（ring）却也分到
 * 18px，底边要 32px 只有 18px。拿对称的余量接非对称的阴影，必然一边不够。
 *
 * 两条路：把 pad.y 翻到 64（顶部白白浪费 31px、应用还得再缩小），或者**把阴影
 * 设计成能装进预算**。选了后者——远层收成 `0 12px 24px -8px`，向下外扩 16px，
 * 余量 24px，留 8px 余地。
 *
 * 因此下面这组数字**不是可以随便调的审美参数，是一组联立不等式**：
 *
 *     needBottom(SHADOW) ≤ PAD.y / 2      needRight(SHADOW) ≤ PAD.x / 2
 *
 * 其中 need = |offset| + blur/2 + spread。contain 模式必有一轴刚好贴满，那轴的
 * 间隙就是 pad/2，所以只能按 pad/2 算，不能按容器实际剩余空间算。
 * shadowExtent() 把这个算式落成代码，测试直接拿它卡——改大阴影不改 pad（或反过来）
 * 会当场变红，不会再出现"看起来更好看了、真机上被切掉"。
 *
 * 色相也顺手统一了：原来是 rgba(60,50,30) 暖棕，落在 --sr-shell-bg #f4f4f6
 * 这个冷中性灰上发闷。改用仓里已有的 rgba(15,23,42)（slate-900）家族——
 * grep `shadow-\[` 能看到它已经是本仓用得最多的那支。
 *
 * ⚠ **两处都要用这份常量**：SpecPageLiveStage（spec-first 页面）和
 * AppRuntimeScreen（区块运行时）画的是同一个预览框，2026-08-24 之前各自硬编
 * 了一份一模一样的 `0 8px 32px rgba(60,50,30,0.18)`。只改一处不会报错，
 * 只会有一半的舞台没变——本仓第四条纪律的标准形态。
 */

/**
 * 桌面预览框：ring 定边界，近/中/远三层给层次。
 * 远层向下外扩 12 + 24/2 - 8 = 16px，必须 ≤ STAGE_FRAME_PAD.y / 2。
 */
export const STAGE_FRAME_SHADOW =
  "0 0 0 1px rgba(15,23,42,0.06)," +
  "0 1px 2px rgba(15,23,42,0.04)," +
  "0 4px 8px -2px rgba(15,23,42,0.06)," +
  "0 12px 24px -8px rgba(15,23,42,0.13)";

/**
 * 画布档的画板/素材卡：**只有 1px 描边，没有投影**（2026-08-25 用户裁决，
 * 附了参考图："后面阴影也不要"）。
 *
 * ⚠ 为什么画布跟页面档不共用 STAGE_FRAME_SHADOW：
 *   页面档是**一块**预览框浮在台面上，投影给的是"这是一台设备"的层次感，
 *   而且它那组数字跟 STAGE_FRAME_PAD 是一组联立不等式（见上面），动不得。
 *   画布是**一排画板平铺**，每块都带三层投影时，缩到 25% 全糊成一片灰边，
 *   反而把台面弄脏。平铺的东西靠描边定边界就够——参考图里也是这么做的。
 *
 * ⚠ 描边不能省。去掉投影之后它是画板**唯一**的边界；台面是浅灰、画板是纯白，
 *   没有这条线的话白画板边缘会跟台面糊在一起（低缩放下尤其明显）。
 */
export const STAGE_FRAME_FLAT = "0 0 0 1px rgba(15,23,42,0.08)";

/**
 * 画布浮层 chrome（读数 / 缩放条 / 小地图）。
 *
 * 2026-09-04：用户指了截图上四处，要 Stitch / Figma 那种**浮着的药丸**——
 * 四角全圆、浅描边、近距投影、离开边 12px。不是贴边切一角的 `rounded-tr-lg`。
 * ⚠ 只给 chrome，不给画板：画板仍用 STAGE_FRAME_FLAT（平铺一排时投影会糊）。
 */
export const CANVAS_CHROME_SHADOW =
  "0 0 0 1px rgba(15,23,42,0.06)," +
  "0 1px 2px rgba(15,23,42,0.05)," +
  "0 8px 20px -6px rgba(15,23,42,0.12)";

/**
 * 手机档：机身黑边本身就是边界，不需要 ring，只把单层换成分层。
 * 原值 `0 18px 40px rgba(15,23,42,0.28)` —— 色相已经是对的，只是没分层。
 */
export const PHONE_FRAME_SHADOW =
  "0 2px 4px -1px rgba(15,23,42,0.10)," +
  "0 8px 16px -4px rgba(15,23,42,0.16)," +
  "0 18px 36px -16px rgba(15,23,42,0.22)";

/**
 * 桌面档要从画布里扣掉的余量，喂给 useScaleToFit 的 pad。
 *
 * 取 32/36 是按上面那组阴影的实际外扩量定的：远层 48px 模糊 -16px 收缩 ≈ 外扩
 * 16px，加上 ring 1px 和向下 24px 偏移。y 比 x 大一点，因为阴影整体朝下偏。
 * 改这两个数就等于改阴影能不能完整显示，别单独调其中一个。
 */
export const STAGE_FRAME_PAD = { x: 40, y: 48 } as const;

/**
 * 手机档里**不属于机身**的那部分余量：阴影外扩 + 一点呼吸。
 *
 * 拆开的原因（2026-08-24 加设备切换）：原来是一个写死的 {36,48}，注释说"机框描边、
 * 下巴也从这里扣"——也就是它把两件性质不同的东西加在了一起：机身尺寸（随机型变，
 * 平板 14px 边、手机 12px 边）和阴影余量（随阴影常量变）。机型可切之后，写死的
 * 那个数对平板就是错的，而且错了不会报错，只会让平板的阴影被切一点。
 *
 * 现在 phoneFramePad() 按 `机身 + 这份余量` 现算。
 *
 * ⚠ 拆开的第一件收获：**手机档的阴影原本就在被切，谁都没量过。**
 *   元素尺寸 = 屏 × scale + 机身，机身算在元素**里面**；阴影投在元素**外面**，
 *   要的是容器减掉元素之后剩下的空隙。这轴贴满时那个空隙 = pad − 机身，居中均分
 *   后每边只有一半：
 *       旧值 y=48，机身吃掉 12+20=32，剩 16，每边 8px，
 *       而手机阴影向下要 20px  →  一直切着 12px。
 *   旧写法把机身和阴影余量加在一个数里，正是这个错误看不出来的原因——48 这个数
 *   同时"解释"了两件事，谁也没法验证其中任何一件。
 *   所以这份余量只管阴影，判据按 /2（居中均分）卡。
 */
export const PHONE_FRAME_SHADOW_PAD = { x: 16, y: 44 } as const;

/** 机身量级：左右上边框、下巴。与 DevicePreset.frame 同形。 */
export type PhoneFrameMetrics = { bezel: number; bezelBottom: number };

/**
 * 手机/平板档要从画布扣掉的总余量 = 机身 + 阴影余量。
 *
 * x：左右各一条边框 → bezel × 2；y：上边框 + 下巴 → bezel + bezelBottom。
 */
export function phoneFramePad(frame: PhoneFrameMetrics): {
  x: number;
  y: number;
} {
  return {
    x: frame.bezel * 2 + PHONE_FRAME_SHADOW_PAD.x,
    y: frame.bezel + frame.bezelBottom + PHONE_FRAME_SHADOW_PAD.y,
  };
}

/**
 * 一组 box-shadow 各方向真正需要的外扩量：|offset| + blur/2 + spread。
 *
 * 判据靠它把"阴影多大"和"留了多少余量"锁在一起。手算过一次就会知道为什么要落成
 * 代码：`0 24px 48px -16px` 看着像 48px，实际向下是 32px、向上是 -16px（够不到）。
 * 凭直觉估这个数正是第一轮翻车的原因。
 */
export function shadowExtent(shadow: string): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const out = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const layer of shadow.split(/,(?![^(]*\))/)) {
    // ⚠ 先把颜色摘掉再取数字，且**不能只认带 px 的**。
    // 2026-08-24 真机踩到：本文件的常量写作 "0 12px 24px -8px"，第一个 0 是裸的，
    // /-?[\d.]+px/ 会把它漏掉，于是 [12,24,-8] 被当成 [ox,oy,blur]，整组错位、
    // 算出来的外扩量凭空多 8px。getComputedStyle 读出来的是归一化后的 "0px"，
    // 所以浏览器里量是对的、这里算是错的——两边量的不是同一个东西。
    const body = layer
      .replace(/\b(?:rgba?|hsla?|color)\([^)]*\)/gi, " ")
      .replace(/#[0-9a-f]{3,8}\b/gi, " ");
    const nums = (body.match(/-?[\d.]+/g) ?? []).map(parseFloat);
    if (nums.length < 3) continue;
    const [ox, oy, blur, spread = 0] = nums;
    const reach = blur / 2 + spread;
    out.top = Math.max(out.top, -oy + reach);
    out.bottom = Math.max(out.bottom, oy + reach);
    out.left = Math.max(out.left, -ox + reach);
    out.right = Math.max(out.right, ox + reach);
  }
  return out;
}
