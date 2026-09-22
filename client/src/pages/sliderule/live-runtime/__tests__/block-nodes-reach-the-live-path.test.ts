/**
 * 刀 2 **真的接在通电的那条链路上**吗（2026-08-27）。
 *
 * 纯函数那两组（block-node-fit 17 条、block-node-layout 18 条）全绿，但把
 * ArtboardNode/舞台里的挂载点删掉照样全绿——它们只直接调纯函数。这个文件
 * 补缺的那一半，形状同 `block-rects-reaches-the-live-path.test.ts`。
 *
 * ⚠ 判据先剥注释：这份实现里 `BlockNode`、`fitBlockNodes`、`crop` 在中文
 *   注释里出现得比在代码里还多。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
function read(rel: string): string {
  return stripComments(readFileSync(resolve(__dirname, rel), "utf8"));
}

const STAGE = read("../SpecPageCanvasStage.tsx");
const LAYOUT = read("../block-node-layout.ts");

/** BlockNode 那一段源码。⚠ 画板节点自己有标题条，全文件搜会误判。 */
function blockNodeBody(): string {
  const a = STAGE.indexOf("function BlockNode(");
  const b = STAGE.indexOf("function AssetNode(");
  if (a < 0 || b < a) throw new Error("找不到 BlockNode 那一段");
  return STAGE.slice(a, b);
}

describe("块节点真的挂上了画布", () => {
  it("注册了 block 这个节点类型（不注册的话 React Flow 静默不渲染）", () => {
    expect(STAGE).toMatch(/nodeTypes\s*=\s*\{[^}]*block:\s*BlockNode/s);
  });

  it("造了块节点，并且用的是 layoutBlockNodes 算出来的盒子", () => {
    expect(STAGE).toContain("layoutBlockNodes(");
    expect(STAGE).toMatch(/type:\s*"block"/);
  });

  it("降级阶梯真的接上了：live 来自 fitBlockNodes 的结果", () => {
    // 只调不接 = 阶梯白算，所有块都真渲染，块一多就卡死。
    expect(STAGE).toContain("fitBlockNodes(");
    expect(STAGE).toContain("blockFit.live.has(b.key)");
  });

  it("归属线（块 → 它所属的整页）挂了出去", () => {
    expect(STAGE).toMatch(/id:\s*`own:\$\{b\.key\}`/);
    expect(STAGE).toContain("source: `block:${b.key}`");
  });

  it("块节点**四条边**都常挂 Handle（少一条线就得绕远路）", () => {
    // 画板那边头注记过"把手不在时边直接画不出来"（控制台 #008）。
    // ⚠ 2026-08-28 从一条边改成四条：只有左把手时，块↔块的影响线两端都从
    //   左侧出入，贝塞尔两个控制点同向，线往左兜一个大圈——真机截图上就是
    //   几十条横扫全场的长弧。
    for (const pos of ["Top", "Right", "Bottom", "Left"]) {
      expect(STAGE).toContain(`Position.${pos}`);
    }
    expect(STAGE).toMatch(/\["t", Position\.Top\]/);
  });
});

describe("用户裁决落到代码上", () => {
  it("块**不可拖**（页组框可拖不受影响）", () => {
    // 用户原话：「建议页组框能拖、块不能」。块没有自己的位置，
    // 它的位置是画板位置推出来的。
    expect(STAGE).toMatch(/type:\s*"block"[\s\S]{0,400}draggable:\s*false/);
  });

  it("块节点是**真渲染**（裁整页 iframe），不是静态截图", () => {
    // 用户原话：「真渲染真渲染」。
    expect(STAGE).toMatch(/live\s*\?\s*\([\s\S]{0,900}<HtmlAppSurface/);
  });
});

describe("反向判据", () => {
  it("裁剪的内层盒子用**页面原尺寸**，不是缩放后的尺寸", () => {
    // ⚠ 2026-08-27 真机：写成 `board.w * scale` 等于改 iframe 尺寸，
    //   页面按新宽度重新响应式布局，裁出来的是别处的内容——而块框位置
    //   还是对的，所以两件事各自都"看着正常"。
    expect(STAGE).toMatch(/width:\s*board\.w,\s*\n\s*height:\s*board\.h,/);
    expect(STAGE).not.toContain("width: board.w * box.crop.scale");
  });

  it("缩放走 transform，且 scale 在 translate **之前**", () => {
    // CSS 右结合：先 translate（设计坐标）再 scale，最终位移正好 -left*s。
    // 写反了会少乘一次 scale，块整体偏出去。
    expect(STAGE).toMatch(
      /transform:\s*`scale\(\$\{box\.crop\.scale\}\)\s*translate\(/
    );
  });

  it("裁剪位移是设计坐标——布局侧不许先乘一遍 scale", () => {
    expect(LAYOUT).toMatch(/left:\s*it\.rect\.rect\.left,/);
    expect(LAYOUT).not.toContain("* scale,");
  });

  it("视口判定复用 shouldMountBoard，不另写一套", () => {
    // 画板和块用两套可见性规则的话，某个缩放档会出现"画板挂着而它的块
    // 全静态"这种自相矛盾的画面，且不报错。
    expect(STAGE).toMatch(/inViewport:\s*shouldMountBoard\(/);
  });

  it("开块网格时画板多留间距，且按**最宽那页的网格宽**算", () => {
    // 按平均值留的话，宽的那页照样盖住右边那列画板；
    // 而"盖住了"在缩到 13% 的全景下只是"有点挤"，不报错。
    expect(STAGE).toContain("blockGridExtraGapX(maxBlockSpan)");
    // ⚠ 留间距和摆网格必须走**同一个 plan**（blockGridSpan 内部就是
    //   planBlockGrid），各算各的会对不上。
    expect(STAGE).toContain("blockGridSpan(snap.rects, design.h)");
    // 反向：不许再拿"列数 × 常数格宽"算——列宽现在各列各的，乘常数会留少
    expect(STAGE).not.toContain("blockGridExtraGapX(maxBlockCols)");
  });

  it("⚠ extraGapX 真的传进 layoutArtboards（列数靠它才能从 3 收到 2）", () => {
    // 2026-08-31：间距留了但列数仍按没条带选，块叠在下一页上。
    // 变异：调用处丢掉第四参，这条红。
    expect(STAGE).toMatch(
      /layoutArtboards\(\s*pages,\s*design,\s*hostAspect \|\| undefined,\s*(?:\/\*[\s\S]*?\*\/\s*)?blocksShown \? blockGridExtraGapX\(maxBlockSpan\) : 0\s*\)/
    );
  });

  it("⚠ 列数按「装得进画板高度」选，不是拍 √n", () => {
    // 2026-08-28 真机：√n 只管形状方不方，不管跟画板比多高。
    // 量到远程审方页的网格 1832 高、越过下一排画板 520 —— 整张图被垂直
    // 撑开，放大到工作档位看到的就是大片空白里几条线穿过（用户报的那个）。
    expect(LAYOUT).toContain("chooseBlockGridColumns");
    expect(LAYOUT).toContain("masonryHeight(heights, cols) <= boardHeight");
    expect(LAYOUT).not.toContain("Math.ceil(Math.sqrt(");
  });

  it("⚠ 块用瀑布流摆位（自由散布），不是严格网格", () => {
    // 用户 2026-08-28 要"节点自由散布"的观感。严格网格会让所有块顶边
    // 对齐成一条直线，那是"电子表格感"的来源。
    // ⚠ 用瀑布流而不是随机抖动：抖动是乱不是自由，且位置要稳定。
    expect(LAYOUT).toContain("colVisualBottom");
    expect(LAYOUT).not.toContain("Math.random");
  });

  it("⚠ 影响线按**相对位置**选边，复用 pickLinkSides", () => {
    // 2026-08-28：上一版两端写死 l→l，贝塞尔控制点同向，线兜大圈。
    // ComfyUI 的 pathRenderer.calculateControlPoints 是按出入方向给偏移的
    // （getDirectionOffset），方向对了曲线才自然。
    // ⚠ 复用画板那套 pickLinkSides，**不另写一套**（第四条纪律）。
    expect(STAGE).toContain("pickLinkSides(fromBox, toBox)");
    expect(STAGE).toContain("pickLinkSides(b, board)");
    expect(STAGE).not.toMatch(
      /sourceHandle:\s*"l",\s*\n\s*targetHandle:\s*"l"/
    );
  });

  it("⚠ 块宽按内容算，摆位和渲染共用同一份尺寸", () => {
    // 2026-08-28 用户："太规矩了"。上一版所有块一律 440 宽，
    // 通栏指标条和小卡在画布上一样宽。
    expect(LAYOUT).toContain("export function computeBlockSize(");
    expect(LAYOUT).toContain("rect.rect.width * BLOCK_SIZE.designScale");
    /* ⚠ 反向：标题条砍掉之后 `title_width` 那一项必须一起删——留着就是
       在为一个不画的东西留宽度，而它撑出来的宽度看着还挺"自然"。 */
    expect(LAYOUT).not.toContain("titleBarWidth");
    // 反向：格宽常数没了（还留着就说明有人在读老的那份）
    expect(LAYOUT).not.toMatch(/BLOCK_CELL[\s\S]{0,400}\n\s*width:\s*\d+,/);
    // 反向：列偏移必须是前缀和，不许 i × 常数
    expect(LAYOUT).toContain("cumulativeOffsets(colWidths, 0, BLOCK_CELL.gap)");
  });

  it("⚠ LOD 只管**标签**，线和块都不受它管", () => {
    /*
     * 2026-08-28 用户裁决 + 我抄错的地方掰回来：
     * ComfyUI 的低质量档丢的是文字、阴影、圆角、以及线的**描边**
     * （pathRenderer.ts:119 `borderWidth && !lowQuality`），**线本身照画**。
     * 线承载结构，多小都读得出走向；文字小到一定程度就只是糊。
     * 两者不该同一个开关。
     */
    expect(STAGE).toContain("shouldDrawBlockDetail(zoom)"); // 标签还受它管
    // 反向：线不许再挂在 LOD 上
    expect(STAGE).not.toContain("blockDetailVisible");
    expect(STAGE).not.toContain("shouldDrawBlockDetail(vp.zoom)");
    // 反向：块节点的挂载也不许跟着 LOD 走
    expect(STAGE).not.toMatch(
      /shouldDrawBlockDetail[\s\S]{0,80}blockBoxes\.map/
    );
  });

  it("⚠ 连线走自定义曲线，不是 React Flow 自带的 bezier", () => {
    // React Flow 顺向时把控制点摆在**半程**（0.5 * distance，写死的），
    // 长线上是又宽又平的懒弧；它的 curvature 参数只作用于逆向那一支，
    // 调不动这里。ComfyUI 是 max(30, 欧氏距离 * 0.25)。
    expect(STAGE).toContain("const edgeTypes = { blockCurve: BlockCurveEdge }");
    expect(STAGE).toContain("edgeTypes={edgeTypes}");
    expect(STAGE).toContain("buildCurvePath({");
    // 反向：块相关的边一条都不许再用自带的 bezier / straight
    expect(STAGE).not.toMatch(
      /targetHandle: sides\.target,\s*\n\s*type: "bezier"/
    );
    expect(STAGE).not.toMatch(
      /targetHandle: sides\.target,\s*\n\s*type: "straight"/
    );
  });

  it("⚠ 归属线和影响线是**同一种**画法（同一张图别有两套手感）", () => {
    const own = STAGE.slice(
      STAGE.indexOf("id: `own:"),
      STAGE.indexOf("id: `own:") + 400
    );
    expect(own).toContain('type: "blockCurve"');
    const impact = STAGE.slice(
      STAGE.indexOf("id: e.id,"),
      STAGE.indexOf("id: e.id,") + 400
    );
    expect(impact).toContain('type: "blockCurve"');
  });

  it("⚠ 曲线边不吃鼠标（漏了 pointer-events 会盖住块，点不中）", () => {
    expect(STAGE).toMatch(/pointerEvents: "none"[\s\S]{0,40}\/>\s*\n\s*\);/);
  });

  it("⚠ **任何两种线不许同色** —— 撞色就是两种关系分不出来", () => {
    /*
     * 2026-08-28 用户问"这种淡淡的线是啥，连接啥的"——真机量下来那片淡线
     * 其实是**两种**东西：24 条归属线和 86 条同源字段线，都是
     * rgb(203,213,225)，只差 0.5px 线宽和虚线节奏，肉眼分不出。
     *
     * 讽刺的是 block-impact.ts 头注里写着"两类关系不能混成一条线"，
     * 我防住了"真联动 vs 同源"，却没防住"同源 vs 归属"——因为两处颜色
     * 定义在文件的两个地方，没有任何一处看得出它们撞了。
     *
     * 这条判据就是为了让下一次撞色**在提交前**红掉。
     */
    const m = STAGE.match(
      /export const ALL_EDGE_STROKES: Record<string, string> = \{([\s\S]*?)\}/
    );
    expect(m, "ALL_EDGE_STROKES 不见了——撞色判据失去依据").not.toBeNull();

    // 顺着这张表把颜色取出来（值是对别处常量的引用，所以在源码里解引用）
    const kinds = [
      ...m![1].matchAll(/(\w+):\s*([A-Z_]+|\w+)\.(\w+)(?:\.(\w+))?/g),
    ];
    expect(kinds.length).toBeGreaterThanOrEqual(7);

    const strokes = [...STAGE.matchAll(/stroke:\s*"(#[0-9a-fA-F]{3,8})"/g)].map(
      x => x[1].toLowerCase()
    );
    expect(strokes.length).toBeGreaterThanOrEqual(7);
    const dup = strokes.filter((c, i) => strokes.indexOf(c) !== i);
    expect(
      dup,
      `这些颜色被多种线共用：${[...new Set(dup)].join("、")}`
    ).toEqual([]);
  });

  it("⚠ 每种线都要在浅底上看得见——不许再调回淡色", () => {
    /*
     * 2026-08-28 用户报："太淡了，灰色都看不出来了，颜色也有些丑"。
     * 照 ComfyUI_frontend 的**浅色主题**调色板（src/assets/palettes/light.json
     * 的 node_slot，全是 Material 400 档）换了一轮。
     *
     * ⚠ 判据按**跟画布底色的对比度**算，不靠肉眼、也不靠单看亮度。
     *   画布底色 #f4f4f6 是仓里记过的（canvas 那层"去掉背景后露出外壳"）。
     *
     * ⚠ 阈值 1.9 是**标定出来的**，不是拍的。四个标定点：
     *       #e2e8f0  1.14   用户说"看不出来"的归属线（旧）
     *       #cbd5e1  1.37   撞色那一版的两种线（旧）
     *       #a5b4fc  1.83   我上一轮的"修复"，用户仍然说太淡
     *       #B0B0B0  1.98   现在最淡的一个（ComfyUI 浅色主题的 NOISE）
     *   取 1.9 正好把前三个挡在外面、把现在这套放进来。
     *   ⚠ 余量只有 0.08，要动这些颜色**连同这条阈值一起重标**，别只改颜色。
     */
    const lum = (hex: string) => {
      const n = hex.replace("#", "");
      const to = (i: number) => {
        const c = parseInt(n.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * to(0) + 0.7152 * to(2) + 0.0722 * to(4);
    };
    const CANVAS_BG = lum("#f4f4f6");
    const contrast = (c: string) => (CANVAS_BG + 0.05) / (lum(c) + 0.05);

    const strokes = [
      ...new Set(
        [...STAGE.matchAll(/stroke:\s*"(#[0-9a-fA-F]{6})"/g)].map(x => x[1])
      ),
    ];
    expect(strokes.length).toBeGreaterThanOrEqual(7);
    const tooPale = strokes.filter(c => contrast(c) < 1.9);
    expect(
      tooPale,
      `这些颜色在 #f4f4f6 底上太淡（对比度 < 1.9）：${tooPale
        .map(c => `${c}=${contrast(c).toFixed(2)}`)
        .join("、")}`
    ).toEqual([]);
  });

  it("⚠ 线宽照 ComfyUI 的 connections_width = 3（1px 缩放后是断续的点）", () => {
    // 上一版真联动 2px、同源 1px。1px 在 17% 全景下就是一串灰尘。
    for (const k of ["nav", "action", "asset"]) {
      expect(STAGE).toMatch(new RegExp(`${k}: \\{[^}]*strokeWidth: 3`));
    }
    expect(STAGE).toMatch(/field: \{[^}]*strokeWidth: 2/);
  });

  it("⚠ 归属线比所有影响线都更轻（不许跟影响线抢注意力）", () => {
    // 块本来就摆在它那张画板旁边，归属靠位置已经读得出来，线只是确认。
    const own = STAGE.match(/const OWNERSHIP_STYLE = \{([\s\S]*?)\} as const/);
    expect(own).not.toBeNull();
    // ⚠ 更轻 = 比影响线细 + 虚线，**不是**细到看不见（2026-08-28 用户报
    //   "灰色都看不出来"，上一版是 1px #e2e8f0）。
    expect(own![1]).toContain("strokeWidth: 2");
    expect(own![1]).toContain("strokeDasharray");
  });

  it("⚠ 静态卡按类型上色（低质量档保形状保颜色，只丢细节）", () => {
    // 上一版统一浅灰，全景下 19 张静态卡是一堆白方块，看着像加载坏了。
    expect(STAGE).toContain("blockKindTint(kind)");
    expect(STAGE).toContain("background: tint.fill");
  });

  it("阶梯档位暴露成可读事实（rung 不是装饰）", () => {
    // 截图上"全量真渲染"和"降到全静态"长得差不多，只有档位读得出区别。
    expect(STAGE).toContain("data-block-fit-rung");
    expect(STAGE).toContain("data-block-fit-live");
  });

  it("「当前页」要在页清单里校验过（宿主可能传来不存在的页）", () => {
    // 真机量到过：宿主传 "home"，这套应用里没有这一页，
    // 第 2 档筛出 0 块 —— 24 个节点全静态，看着像阶梯坏了。
    expect(STAGE).toContain("known.has(id)");
  });

  it("⚠ 节点上**没有标题条**（用户三轮裁决的终点）", () => {
    /*
     * 2026-08-28：「太平了」→ 补 CARD 那套 → 「我们是区块，不是属性面板」
     * → 中性色 → 「直接去掉标题条」。
     *
     * ⚠ 只在 BlockNode 这一段里找——画板节点自己是有标题条的，全文件搜
     *   会把它误判成没删干净。
     * 变异：把标题条那个 div 加回来，这条红。
     */
    const body = blockNodeBody();
    expect(body).not.toContain("sliderule-canvas-block-title");
    expect(body).not.toContain("BLOCK_CHROME.titleBar");
    expect(body).not.toContain("BLOCK_CHROME.titleFont");
    expect(body).not.toContain("blockTitleText");
    // 反向：类型色只许出现在降级静态卡那一段
    const staticAt = body.indexOf('data-testid="sliderule-canvas-block-node-static"');
    expect(staticAt).toBeGreaterThan(-1);
    expect(body.slice(0, staticAt)).not.toContain("tint.");
  });

  it("⚠ 砍标题条不等于回到白方块：圆角和分层投影得留着", () => {
    // "太平了"是没有层次 + 标签从没显示过两件事叠出来的；层次这半跟
    // 标题条无关。变异：把 radius/shadow 也删掉，这条红。
    expect(STAGE).toContain("borderRadius: BLOCK_CHROME.radius");
    expect(STAGE).toContain("boxShadow: BLOCK_CHROME.shadow");
    expect(STAGE).not.toMatch(
      /sliderule-canvas-block-card[\s\S]{0,600}borderRadius:\s*4,/
    );
  });

  it("⚠ 名字没了落脚点，改挂原生 title（不是干脆不给）", () => {
    // 悬停认得出是哪一块，画面上零重量；全名在右侧面板里。
    expect(blockNodeBody()).toContain(
      "title={`${kindLabel}·${box.name}`}"
    );
  });

  it("⚠ 排布那边的 labelBand 也删干净了（成对的东西只删一半必然错位）", () => {
    // 只删一边，整条块带会整体错开 56 个单位，而画面上看着只是
    // "跟画板没对齐"，不报错。
    expect(LAYOUT).not.toContain("labelBand:");
    expect(LAYOUT).not.toContain("BLOCK_CELL.labelBand");
    expect(blockNodeBody()).not.toContain("BLOCK_CELL.labelBand");
  });

  it("⚠ 截断如实说，且 LOD 阈值盯的就是它的字号", () => {
    // 它是节点上**仅剩的一处文字**。阈值还挂在一个不再存在的标题字号上，
    // 就是上一版那个"公式看着还对、数已经没意义"的错。
    expect(STAGE).toContain('data-testid="sliderule-canvas-block-truncated"');
    expect(STAGE).toContain("fontSize: BLOCK_CHROME.hintFont");
    expect(LAYOUT).toContain("BLOCK_HINT_FONT_PX = BLOCK_CHROME.hintFont");
  });

  it("静态卡里的字**不反缩放**（外面那行标签才反缩放）", () => {
    // 真机 17% 全景：`12 * inv` = 70 画布单位，比矮块本身还高，直接溢出。
    expect(STAGE).not.toMatch(
      /sliderule-canvas-block-node-static[\s\S]{0,400}fontSize:\s*\d+\s*\*\s*inv/
    );
  });
});
