/**
 * 按字段**语义**（而不只是类型）决定示例值的形态（2026-07-28）。
 *
 * 为什么要有这一层：五系统模型里的字段类型只有 string/number/date/ref/enum/text
 * 六种，一个「主评人」和一个「豆种名称」在类型上都是 string。只按类型出值，
 * 表格里那一列就全是「主评人 1」「主评人 2」——一眼假，展会上尤其难看。
 *
 * faker 的做法是让调用方**显式挑生成器**（`faker.person.fullName()`）；
 * drizzle-seed 也主要靠用户在 refine 里指定，只对 email 做了一点名字推断
 * （见其 SeedService.ts 里 `col.name.toLowerCase().includes('email')`）。
 * 我们没有"用户来挑"这一步——schema 是 AI 现场生成的——所以推断必须自动做。
 *
 * 判定只看字段 id 与显示名，**匹配不上就返回 null**，由调用方退回朴素形态。
 * 宁可少认，不可认错：把「备注」当人名填上「陈思源」比填「备注 1」更糟。
 */

/** 能识别出来的语义类别。 */
export type FieldSemantic =
  | "person"
  | "org"
  | "city"
  | "phone"
  | "email"
  | "code"
  | "prose";

/**
 * 顺序即优先级：先具体后笼统。
 *
 * 「供应商名称」同时含「供应商」和「名称」，必须先命中 org；放反了就会被
 * 当成普通名称字段。
 */
const RULES: Array<{ semantic: FieldSemantic; re: RegExp }> = [
  {
    semantic: "email",
    re: /邮箱|邮件|电子信箱|e-?mail|\bmail\b/i,
  },
  {
    semantic: "phone",
    re: /电话|手机|座机|联系方式|phone|mobile|\btel\b|contact_?no/i,
  },
  {
    semantic: "org",
    re: /公司|企业|供应商|厂商|客户|机构|单位|商户|门店|品牌|渠道商|经销商|采购方|承运|supplier|vendor|customer|client|company|corp|merchant|store|partner|brand/i,
  },
  {
    semantic: "person",
    re: /姓名|人名|负责人|联系人|经办|操作员|员工|成员|用户名|主评人|评审人|审核人|申请人|指派|受理人|烘焙师|技师|司机|owner|user_?name|member|staff|employee|contact_?name|manager|leader|reviewer|applicant|assignee|operator/i,
  },
  {
    semantic: "city",
    re: /城市|地区|产地|区域|省份|所在地|归属地|片区|\bcity\b|region|origin|province|district|area|location/i,
  },
  {
    semantic: "code",
    // `\bcode\b` 匹配不到 `record_code`——下划线本身是 word 字符，`_` 与 `c`
    // 之间没有词边界。真跑截图里「杯测记录号」那一列因此没走单号形态，
    // 而同一批的 `lot_code` 看着是好的，纯粹因为它中文名里带「编码」。
    // 改成"前面不是字母"，这样 record_code / lot_code 都中，decode 不中。
    // 另外中文里以「号」结尾基本都是标识符（记录号/批次号/流水号），一并收。
    re: /编号|编码|单号|代码|批号|流水号|序列号|号$|号码|(?:^|[^a-z])code(?:$|[^a-z])|_no$|^no$|number|(?:^|[^a-z])sn(?:$|[^a-z])|serial|barcode/i,
  },
  {
    // 「摘要/说明/描述/备注/建议/原因」这类字段要的是**一句话**，不是一个名字。
    //
    // 2026-08-11 线上截图照出来的：「经营表现摘要: 经营表现摘要 1」——
    // 字段名当值用了。成因是这一档以前认不出来，掉进 genericName 的最后兜底
    // `${label} ${index+1}`，而那条兜底只对"名称类"字段说得过去
    //（「豆种 1」还像个名字，「经营表现摘要 1」不像任何东西）。
    //
    // ⚠ **必须排在最后一条**。第一版把它放在 code 之前，用例当场抓到：
    // 「说明书编号」里的「说明」抢在「编号」之前命中，一个单号被当成散文填。
    // 同理它排在 person/org/city 之后——「负责人说明」按人名填比按散文有用。
    //
    // 这一档天生比别的宽（「说明/备注/原因」这些词能挂在任何东西上），
    // 宽的规则就该垫底：**让每一条更具体的先拿走它该拿的**。
    semantic: "prose",
    re: /摘要|说明|描述|备注|简介|建议|原因|理由|评价|结论|概述|summary|description|remark|note|comment|reason|advice|memo/i,
  },
];

/**
 * 认出字段语义；认不出返回 null。
 *
 * 同时看 id 和显示名：id 常是英文（`supplier_id`），显示名常是中文
 * （「供应商」），两边各有各认得出的情况。
 */
export function semanticOf(
  fieldId: string | undefined,
  fieldName: string | undefined
): FieldSemantic | null {
  // 两者**分开匹配**，不拼成一个字符串：拼起来之后 `^`/`$` 锚点就失去意义了
  // ——`batch_no` 配空显示名会拼成 `"batch_no "`，尾部多一个空格，`_no$` 直接
  // 匹配不上。分开测，每个锚点都锚在它该锚的那个词上。
  const parts = [fieldId ?? "", fieldName ?? ""].map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  for (const { semantic, re } of RULES)
    if (parts.some(p => re.test(p))) return semantic;
  return null;
}
