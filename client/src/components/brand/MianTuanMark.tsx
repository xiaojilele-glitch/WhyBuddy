/**
 * 面团标识（2026-08-03 换成官方素材）。
 *
 * ## 从手绘 SVG 换成官方 PNG
 *
 * 这个文件原来是**照着一张截图手写的 SVG 复刻**——那时候还没有官方素材。
 * 手写的好处是随字号缩放、零请求；坏处是它终究只是"很像"：渐变的走向、
 * 面团那几个不对称的凸起、笑脸的弧度，全是估的。
 *
 * 现在有官方素材了（client/public/brand/miantuan-mark.png），就该用真的。
 * 一个"很像"的标识比换个字体还伤品牌——它会出现在标签页、侧栏、登录页，
 * 每一处都在告诉人这个产品长什么样。
 *
 * ## 为什么不做成 SVG
 *
 * 素材给的就是 PNG（462×450，带透明通道）。它在页面上最大只用到 34px，
 * 而位图有 462px 宽——像素密度 13 倍，任何屏幕上都锐利。要矢量得回去找
 * 设计源文件，那是另一件事，不该为此把一个"很像"的手绘版留在代码里。
 *
 * ## 调用口径没变
 *
 * 仍然是 `size` 一个数控制宽高，调用点一行不用改（登录页 34、页脚 14、
 * 窄屏 30）。原图不是严格正方，靠 object-contain 保证不变形。
 */

/** 官方方标。放 public 下而不是 import：它同时被 index.html 的 favicon 引用，
 *  走同一份文件才不会出现"标签页和页面里是两个版本"。 */
const MARK_SRC = "/brand/miantuan-mark.png";

export function MianTuanMark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={MARK_SRC}
      width={size}
      height={size}
      className={className}
      // 原图 462×450 不是严格正方，不加 contain 会被拉扁
      style={{ objectFit: "contain", display: "block" }}
      alt="面团"
      // 不能 lazy：登录页首屏就要它，懒加载会先空一块再跳出来
      decoding="async"
    />
  );
}

/** 官方横版标识（1141×450，带透明通道）：图标 + 「面团 AI」+ miantuan.ai 一体。 */
const HORIZONTAL_SRC = "/brand/miantuan-horizontal.png";

/** 横版标识。登录页和侧栏共用。
 *
 * 2026-08-03：从「方标 + 手排两行文字」换成官方横版一体图。
 *
 * 手排那版是在只有方标素材时的权宜——字体、字重、字间距、两行的相对位置
 * 全是估的，跟官方横版摆在一起看得出不是同一个东西。这跟上面那段"手绘 SVG
 * 换成官方 PNG"是同一个道理：一个"很像"的标识比换个字体还伤品牌。
 *
 * ⚠️ 调用口径变了：`size` 以前是**方标的边长**，现在是**整条横版的高度**。
 * 同一个数字下新版会明显更宽——横版含文字，宽高比约 2.5:1。所以调用点的
 * size 要重新定，不能直接沿用旧值（登录页因此从 34 调到 30 上下）。
 */
export function MianTuanWordmark({
  size = 32,
  className,
}: {
  /** 整条标识的**高度**（不是方标边长，见上面的告诫）。 */
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={HORIZONTAL_SRC}
      height={size}
      className={className}
      // 只定高、宽度按原图比例走：写死宽度会让「面团 AI」被压扁
      style={{ height: size, width: "auto", display: "block" }}
      alt="面团 AI"
      // 不能 lazy：登录页首屏就要它，懒加载会先空一块再跳出来
      decoding="async"
    />
  );
}
