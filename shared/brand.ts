/**
 * 品牌常量。**对外一律是「面团 / MianTuan / miantuan.ai」**（2026-08-03 换名）。
 *
 * ## alias-first：只换值，不改调用点
 *
 * 这个文件从一开始就是按"将来要改名"设计的：用户可见的触点全部消费下面这些
 * 常量，改名时只换值。2026-08-03 兑现了这个设计——`BRAND_*` 现在派生自
 * `PRODUCT_*`，一处都没动调用点。
 *
 * ## 内部标识没有跟着改，这是刻意的
 *
 * 文件名、模块标识、审计/血缘的事件族、API 路径（/api/sliderule）、环境变量
 * （SLIDERULE_*）、以及几百个 spec 目录里仍然写着 sliderule。一次性全量改名
 * 的风险远大于收益：那些字符串进过数据库、进过已发布的接口契约、也进过用户
 * 已经存下来的会话。**对外叫什么和内部叫什么是两件事**，混为一谈才是真的乱。
 *
 * 所以判断标准很简单：**这个字符串会不会出现在用户眼前**。会 → 用这里的常量；
 * 不会 → 保持原样，不要顺手改。
 */

/** 对外品牌（单一真相源，下面的 BRAND_* 全部从这里派生）。 */
export const PRODUCT_NAME_ZH = "面团";
export const PRODUCT_NAME_LATIN = "MianTuan";
export const PRODUCT_DOMAIN = "miantuan.ai";
export const PRODUCT_TAGLINE_ZH = "把一句模糊想法，推演成能跑起来的完整应用";
export const PRODUCT_TAGLINE_EN = "Turn a vague idea into a runnable product.";
/**
 * 主标语——比 TAGLINE 更短、更像口号，用在登录页这类有大幅留白的地方
 * （2026-08-03 随登录页改版加入，取自用户给的设计稿）。
 *
 * 跟 TAGLINE 是两个东西，不要互相替代：这句负责"记住这个品牌"，
 * TAGLINE 负责"说清楚它干什么"，设计稿上两句是上下并置的。
 */
export const PRODUCT_HERO_ZH = "不止一面，即刻成团";

export const BRAND_NAME_DISPLAY = PRODUCT_NAME_ZH;
export const BRAND_NAME_LATIN = PRODUCT_NAME_LATIN;
/** 中英并置的全称，用在需要一眼认出是同一个东西的地方（页签标题等）。 */
export const BRAND_NAME_FULL = `${PRODUCT_NAME_ZH} AI`;
export const BRAND_DOMAIN = PRODUCT_DOMAIN;

export const BRAND_TAGLINE_ZH = PRODUCT_TAGLINE_ZH;
/** English mirror of the Chinese tagline — keep short and parallel. */
export const BRAND_TAGLINE_EN = PRODUCT_TAGLINE_EN;

/**
 * One-line product tagline that combines display name + tagline. Used by the
 * HTML <title> and the login subtitle.
 */
export const BRAND_HEADLINE_ZH = `${BRAND_NAME_FULL} · 产品推演引擎`;
export const BRAND_HEADLINE_EN = `${BRAND_NAME_LATIN} · Product Rehearsal Engine`;

/**
 * 内部包名 / 历史标识。**不是展示名**——见文件头关于"对外与对内是两件事"的说明。
 */
export const BRAND_PACKAGE_LEGACY = "sliderule";
