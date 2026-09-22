/**
 * 「扩展中心」的真机烟测。
 *
 * 为什么单独一支而不是塞进画布那支：这条链跟画布**没有任何共享状态**，
 * 而画布那支已经 39 条、跑一趟要一分多钟。分开之后改哪条跑哪条。
 *
 *   A  输入框打 `/` 弹出能力面板，连接器/技能/伙伴都在
 *   A2 网址里的斜杠**不弹**            ← 跟 A 是一对，错弹会吃掉方向键和回车
 *   A3 真鼠标点得中条目               ← 键盘不做命中测试，这条才照得出 pointer-events
 *   A4 输入框里的「/ 技能·连接器」钮弹同一个面板；A5 反悔时收回那个斜杠
 *   B  打字能筛，回车选中后正文里不留 `/词`（能力是芯片不是正文）
 *   B2 `/` 选伙伴只挂标签，不往正文灌起手意图 ← 跟 G 是一对，说清区别
 *   C  标签能一个个摘掉；C2 正文空着时退格摘最后一枚
 *   H  侧栏分组 + 选中项没有左竖条；H2 假箭头不许有；H3 子项真的切得动页面
 *   D  「扩展中心」三层都在侧栏子项上（页内不再画二次菜单）
 *   I1 技能是列表不是四列墙 + 每个分类各画各的图稿；I2 长文案省略号可悬浮
 *   I3 「添加」装上后，「已安装」tab 真的多出这张卡；I4 分类条真的在筛
 *   E0 列表只列后端真有的连接器；E1 每张卡有自己那张真图稿
 *   E2b 列表不是四列墙 + 长文案省略号可悬浮看全文；E2c 短文案不弹
 *   E3 「添加/已添加」真的挂到这一轮（全部/已添加是互斥 tab）
 *   E  连接器页「试取真数据」拿回的是**真值**，不是示例
 *   E2 认不出的城市如实报错，且**一行都不显示**  ← 跟 E 是一对
 *   J1 伙伴是列表不是四列墙 + 头像由依赖拼出来；J1b 起手意图只露一行
 *   J2 「存成伙伴」存/刷新/删
 *   J3 「我的伙伴」只看自己攒的（关掉要点「全部」，不是再点一次「我的」）
 *   F  伙伴依赖齐时可用、缺依赖时按钮禁用并说明缺什么
 *   G  「用这个伙伴」把能力挂上并跳回推演、起手意图填进输入框
 *
 * ⚠ 判据全部落在**用户看得见的东西**上（弹没弹、正文里还有没有斜杠、
 *   表格里那个数字是不是真的），不量内部状态。
 */

import { chromium } from "playwright";

const BASE = process.env.SLIDERULE_SMOKE_BASE || "http://localhost:3000";
const EMAIL = process.env.SLIDERULE_SMOKE_EMAIL || "";
const PASSWORD = process.env.SLIDERULE_SMOKE_PASSWORD || "";

const results = [];
const log = (...a) => console.log("[capability-smoke]", ...a);
function check(id, ok, detail) {
  results.push({ id, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${id} ${detail ?? ""}`);
}

function launchOptions() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return {
    args: ["--no-sandbox"],
    ...(explicit ? { executablePath: explicit } : {}),
  };
}

const TA = '[data-testid="sliderule-composer-input"]';

/**
 * 切扩展中心的一层。页内「技能/连接器/伙伴」二次菜单已经撤了，
 * 切层只走侧栏 `agent-nav-subitem`。
 *
 * ⚠ 2026-08-26 把 capability-tab 换成侧栏之后，烟测还在等页内那三个钮，
 *   整段 I/E/J 全红——不是功能坏了，是判据钉在已经断电的插座上。
 */
async function gotoLayer(page, layer) {
  await page.waitForSelector('[data-testid="agent-nav-expand"]', { timeout: 30000 });
  if ((await page.locator('[data-testid="agent-nav-subitem"]').count()) === 0) {
    await page.click('[data-testid="agent-nav-expand"]');
    await page.waitForSelector('[data-testid="agent-nav-subitem"]', { timeout: 10000 });
    await page.waitForTimeout(300);
  }
  await page
    .locator(`[data-testid="agent-nav-subitem"][data-layer="${layer}"]`)
    .click();
  await page.waitForSelector(
    `[data-testid="capability-library"][data-layer="${layer}"]`,
    { timeout: 30000 }
  );
  await page.waitForTimeout(600);
}

async function main() {
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => log("[pageerror]", String(e).slice(0, 200)));

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    if (EMAIL && PASSWORD) {
      const status = await page.evaluate(
        async ([email, password]) => {
          const r = await fetch("/api/sliderule/account/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          return r.status;
        },
        [EMAIL, PASSWORD]
      );
      log("login ->", status);
    } else {
      log("未提供 SLIDERULE_SMOKE_EMAIL/PASSWORD，按匿名可读跑");
    }
    await page.evaluate(() => {
      ["sliderule:turn-capabilities", "sliderule:pending-opener"].forEach(k =>
        localStorage.removeItem(k)
      );
    });

    /* ── A / A2：`/` 弹不弹，是一对 ───────────────────────────────── */
    await page.goto(`${BASE}/agent-loop/sliderule`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(TA, { timeout: 60000 });
    await page.waitForTimeout(2500);

    await page.click(TA);
    await page.type(TA, "/", { delay: 60 });
    await page.waitForTimeout(700);
    const kinds = await page.$$eval('[data-testid="sliderule-slash-item"]', els =>
      els.map(e => e.getAttribute("data-kind"))
    );
    check(
      "A 输入框打 / 弹出能力面板（连接器 + 伙伴都在）",
      kinds.length > 0 && kinds.includes("connector") && kinds.includes("partner"),
      `${kinds.length} 项：${JSON.stringify([...new Set(kinds)])}`
    );

    await page.fill(TA, "");
    await page.type(TA, "参考 https://miantuan.ai 这个站", { delay: 15 });
    await page.waitForTimeout(500);
    const urlOpened = (await page.$('[data-testid="sliderule-slash-menu"]')) !== null;
    /* ⚠ 只看 A 会漏掉"到处都弹"：网址、日期、and/or 里的斜杠一样会命中，
       而错弹比不弹烦人得多——面板一开就把方向键和回车吃掉了。 */
    check("A2 网址里的斜杠不弹面板", !urlOpened, `弹了吗=${urlOpened}`);

    /* ── B / C：筛、选、摘 ───────────────────────────────────────── */
    /*
     * A3：**用真鼠标点一条**。
     *
     * ⚠ 2026-08-26 用户报"选了之后框里啥也没有"，根因是面板落在
     *   ComposerDock 最外层的 `pointer-events-none` 里、从没 opt-in 回来：
     *   面板画得好好的、看得见，elementsFromPoint 在它正中却拿不到它，
     *   鼠标点穿过去落在消息气泡上。而**当时所有判据都是键盘选的**，
     *   键盘不做命中测试，于是全绿。
     *   这一条专治那个盲区——它跟画布「换图」那次是同一个形状。
     */
    await page.fill(TA, "");
    await page.type(TA, "/", { delay: 60 });
    await page.waitForTimeout(700);
    /*
     * ⚠ 2026-08-27：不能再点 `.first()`。面板加了推演动词（/推演 /精修 …）
     *   之后第一条是 `rehearse`，点下去只往正文插一个动词、不挂芯片，
     *   于是这条判据红了——**面板本身是好的，鼠标也点中了**。
     *   这条要验的是"鼠标能不能命中"，所以挑一条**能力**（连接器/技能/伙伴）
     *   来点，别让面板里多了什么就把它带红。
     */
    const row = page
      .locator(
        '[data-testid="sliderule-slash-item"][data-kind="connector"], ' +
          '[data-testid="sliderule-slash-item"][data-kind="partner"], ' +
          '[data-testid="sliderule-slash-item"][data-kind="skill"]'
      )
      .first();
    const rb = await row.boundingBox();
    const hit = rb
      ? await page.evaluate(
          ([x, y]) =>
            document
              .elementFromPoint(x, y)
              ?.closest('[data-testid="sliderule-slash-item"]')
              ?.getAttribute("data-key") ?? null,
          [rb.x + rb.width / 2, rb.y + rb.height / 2]
        )
      : null;
    if (rb) {
      await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.waitForTimeout(700);
    }
    const mouseTags = await page.$$eval(
      '[data-testid="sliderule-capability-chip"]',
      els => els.map(e => e.getAttribute("data-key"))
    );
    check(
      "A3 真鼠标点得中面板条目（不是只有键盘选得中）",
      !!hit && mouseTags.length > 0,
      `条目中心点上是 ${hit ?? "别的东西——面板被 pointer-events 吃了"} · 挂上 ${JSON.stringify(mouseTags)}`
    );
    for (const k of mouseTags) {
      await page
        .locator(`[data-testid="sliderule-capability-chip"][data-key="${k}"] button`)
        .click()
        .catch(() => {});
    }
    await page.waitForTimeout(300);

    await page.fill(TA, "");
    await page.type(TA, "/股", { delay: 60 });
    await page.waitForTimeout(600);
    const filtered = await page.$$eval('[data-testid="sliderule-slash-item"]', els =>
      els.map(e => e.getAttribute("data-key"))
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    const textAfter = await page.inputValue(TA);
    const chips = await page.$$eval('[data-testid="sliderule-capability-chip"]', els =>
      els.map(e => e.getAttribute("data-key"))
    );
    check(
      "B 打字能筛，回车选中后正文里不留 `/词`（能力是芯片不是正文）",
      filtered.includes("stock") &&
        chips.includes("stock") &&
        !textAfter.includes("/") &&
        !textAfter.includes("股"),
      `筛出 ${JSON.stringify(filtered)} · 芯片 ${JSON.stringify(chips)} · 正文 ${JSON.stringify(textAfter)}`
    );

    /*
     * B2：`/` 选完之后，输入框里只多一枚**标签**，正文该是空的。
     *
     * ⚠ 2026-08-26 用户指着 TRAE 的截图纠正过一次：我们原来给伙伴灌了几十字
     *   的起手意图进正文，用户一进来先得删掉别人替他写的话。`/` 的语义是
     *   "给我正要写的这句话挂个能力"，不是"替我写"。
     *   库页上那颗「用这个伙伴」是另一回事（见 G），那里灌是对的——
     *   两条判据放在一起，才说得清这个区别不是漏改。
     */
    await page.fill(TA, "");
    await page.type(TA, "/晨会", { delay: 60 });
    await page.waitForTimeout(600);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    const afterPartner = await page.inputValue(TA);
    const inTagRow = await page.$$eval(
      '[data-testid="sliderule-composer-tags"] [data-testid="sliderule-capability-chip"]',
      els => els.map(e => e.getAttribute("data-key"))
    );
    check(
      "B2 `/` 选伙伴只挂标签，**不往正文灌起手意图**（标签就在输入框里）",
      afterPartner.trim() === "" && inTagRow.length > 0,
      `正文 ${JSON.stringify(afterPartner.slice(0, 40))} · 输入框里的标签 ${JSON.stringify(inTagRow)}`
    );

    /* C：正文空着时退格摘掉最后一枚——标签输入框的通行手势 */
    await page.click(TA);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(400);
    const afterBack = await page.$$eval(
      '[data-testid="sliderule-capability-chip"]',
      els => els.length
    );
    check(
      "C2 正文空着时退格摘掉最后一枚标签",
      afterBack === inTagRow.length - 1,
      `${inTagRow.length} → ${afterBack}`
    );

    await page.click('[data-testid="sliderule-capability-chip"] button');
    await page.waitForTimeout(500);
    const chipsAfter = await page.$$eval(
      '[data-testid="sliderule-capability-chip"]',
      els => els.map(e => e.getAttribute("data-key"))
    );
    check("C 标签能一个个摘掉", chipsAfter.length === 0, JSON.stringify(chipsAfter));

    /* ── A4 / A5：输入框里的「/ 技能·连接器」提示钮 ─────────────────
       2026-08-26 用户："输入框中应该加入提醒，比如输入 / 之后，可以选择
       技能或者连接器"。钮点下去走的是**同一条**路径（真往正文插一个 `/`）。 */
    await page.click(TA);
    await page.fill(TA, "做个天气页");
    await page.waitForTimeout(300);
    await page.click('[data-testid="sliderule-slash-hint"]');
    await page.waitForTimeout(600);
    const hintOpened = await page.$$eval(
      '[data-testid="sliderule-slash-item"]',
      els => els.length
    );
    /* 选一个，验它跟手打斜杠走的是同一条路：芯片挂上、正文里**不留斜杠**。
       ⚠ 跟 A3 同一个理由：面板第一条现在是推演动词，必须挑一条**能力**。 */
    await page.click(
      '[data-testid="sliderule-slash-item"][data-kind="connector"], ' +
        '[data-testid="sliderule-slash-item"][data-kind="partner"], ' +
        '[data-testid="sliderule-slash-item"][data-kind="skill"]'
    );
    await page.waitForTimeout(700);
    const afterPick = {
      chips: await page.$$eval('[data-testid="sliderule-capability-chip"]', els =>
        els.map(e => e.getAttribute("data-key"))
      ),
      text: await page.inputValue(TA),
    };
    check(
      "A4 输入框里的「/ 技能·连接器」钮弹出同一个面板，选中后芯片挂上且正文不留斜杠",
      hintOpened > 0 &&
        afterPick.chips.length === 1 &&
        !afterPick.text.includes("/") &&
        afterPick.text.trim() === "做个天气页",
      `弹出 ${hintOpened} 项 · 芯片 ${JSON.stringify(afterPick.chips)} · 正文 ${JSON.stringify(afterPick.text)}`
    );

    /*
     * A5：点了钮又反悔（Esc）——**那个替用户打的斜杠要收回去**。
     *
     * ⚠ 跟 A4 是一对。只判"能弹出来"的话，插进去的斜杠留在正文里也照样绿，
     *   然后它会跟着正文一起发出去，模型把 "做个天气页 /" 当成用户的措辞。
     */
    const beforeSeed = await page.inputValue(TA);
    await page.click('[data-testid="sliderule-slash-hint"]');
    await page.waitForTimeout(500);
    const seeded = await page.inputValue(TA);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const reverted = await page.inputValue(TA);
    check(
      "A5 点了提示钮又按 Esc：替你打的那个斜杠收回去，正文回到原样",
      seeded.includes("/") && reverted === beforeSeed,
      `插之前 ${JSON.stringify(beforeSeed)} · 插之后 ${JSON.stringify(seeded)} · Esc 之后 ${JSON.stringify(reverted)}`
    );

    /* 清干净，别影响后面的判据 */
    await page.fill(TA, "");
    for (const _ of [0, 1, 2]) {
      const chip = page.locator('[data-testid="sliderule-capability-chip"] button').first();
      if (!(await chip.count())) break;
      await chip.click();
      await page.waitForTimeout(300);
    }

    /* ── H：侧栏导航（2026-08-26 用户给了样式截图并当场否掉左竖条）───
     *
     * ⚠ 先切到一个**在导航里的**视图再判"选中态"。推演视图不在导航列表里
     *   （靠点品牌 logo 进），停在那儿时 .native-agent-nav-item-active
     *   压根不存在——第一版就这么写的，判据以「选中项左边 null」红掉，
     *   而它想钉的东西根本没被看到。
     */
    await page.getByText("扩展中心").first().click();
    await page.waitForSelector('[data-testid="capability-library"]', { timeout: 30000 });
    await page.waitForTimeout(1500);

    const navGroups = await page.$$eval(".native-agent-nav-group-label", els =>
      els.map(e => e.textContent?.trim())
    );
    const activeBar = await page.evaluate(() => {
      const el = document.querySelector(".native-agent-nav-item-active");
      if (!el) return null;
      const cs = getComputedStyle(el);
      const before = getComputedStyle(el, "::before");
      return {
        borderLeft: parseFloat(cs.borderLeftWidth) || 0,
        // ⚠ 竖条也可能是 ::before 画的，光看 border 抓不住
        pseudo: before.content !== "none" ? parseFloat(before.width) || 0 : 0,
      };
    });
    check(
      "H 侧栏按创作资源/系统分组，且选中项**没有左竖条**（用户当场否掉的）",
      navGroups.length >= 2 &&
        navGroups.includes("创作资源") &&
        navGroups.includes("系统") &&
        !!activeBar &&
        activeBar.borderLeft === 0 &&
        activeBar.pseudo === 0,
      `分组 ${JSON.stringify(navGroups)} · 选中项左边 ${JSON.stringify(activeBar)}`
    );

    /*
     * H2：折叠箭头**只画在真的有下级的项上**。
     *
     * ⚠ 用户给的截图里每一项右边都有箭头。给「设置」「管理台」挂一个展不开的
     *   箭头，就是"看着能点、点了没反应"——这个仓刚为它连修两轮。
     */
    const carets = await page.$$eval(
      '[data-testid="agent-nav-expand"]',
      els => els.length
    );
    check(
      "H2 只有真的有下级的项才有折叠箭头（不许挂展不开的假箭头）",
      carets === 1,
      `带箭头的项 ${carets} 个`
    );

    /* H3：展开之后子项真的切得动页面（不是画着好看）。
       点导航项本身就会展开，所以只在没展开时才去点箭头。 */
    if ((await page.locator('[data-testid="agent-nav-subitem"]').count()) === 0) {
      await page.click('[data-testid="agent-nav-expand"]');
      await page.waitForTimeout(500);
    }
    const subs = await page.$$eval('[data-testid="agent-nav-subitem"]', els =>
      els.map(e => e.getAttribute("data-layer"))
    );
    await page
      .locator('[data-testid="agent-nav-subitem"][data-layer="connectors"]')
      .click();
    await page.waitForSelector(
      '[data-testid="capability-library"][data-layer="connectors"]',
      { timeout: 30000 }
    );
    await page.waitForTimeout(1800);
    const landed = await page.getAttribute(
      '[data-testid="capability-library"]',
      "data-layer"
    );
    check(
      "H3 侧栏子项「连接器」直接把页面切到连接器层",
      JSON.stringify(subs) === JSON.stringify(["skills", "connectors", "partners"]) &&
        landed === "connectors",
      `子项 ${JSON.stringify(subs)} · 落在 ${JSON.stringify(landed)}`
    );

    /* ── D：三层在侧栏，不在页内二次菜单 ───────────────────────── */
    const layers = await page.$$eval('[data-testid="agent-nav-subitem"]', els =>
      els.map(e => e.getAttribute("data-layer"))
    );
    const innerTabs = await page.locator('[data-testid="capability-tab"]').count();
    check(
      "D 一页三层：技能 / 连接器 / 伙伴（切层只走侧栏，页内不再画一套）",
      JSON.stringify(layers) === JSON.stringify(["skills", "connectors", "partners"]) &&
        innerTabs === 0,
      `子项 ${JSON.stringify(layers)} · 页内二次菜单 ${innerTabs}`
    );

    /* ── I：技能层（2026-08-26 Cursor 列表市场）────────────────── */
    await gotoLayer(page, "skills");
    await page.waitForSelector('[data-testid="skills-featured-list"]', {
      timeout: 20000,
    });

    /*
     * I1：列表市场（不是四列墙）+ 每张卡是**它自己那张**图稿。
     *
     * ⚠ 跟 E1 同一个道理：全都回落成星星一样有图标、一样不报错，只是一屏
     *   一模一样的灰星——"配了等于没配"。所以判据钉的是"分类各画各的"，
     *   不是"有没有图标"。79 条技能落在 10 个分类里，所以 art 的**种类数**
     *   要等于这一屏出现过的分类数，且没有一个是 fallback。
     *
     * ⚠ 2026-08-26 第二次：四列墙换成 Cursor 那种一行一条。列数 === 4
     *   这条反过来钉——再铺回去会红。
     */
    const skillLayout = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="skills-featured-list"]');
      if (!g) return { ok: false, display: null, cols: 0 };
      const cs = getComputedStyle(g);
      const cols =
        cs.gridTemplateColumns === "none"
          ? 0
          : cs.gridTemplateColumns.split(" ").filter(Boolean).length;
      return {
        ok: cs.display !== "grid" && cols !== 4,
        display: cs.display,
        cols,
      };
    });
    const skillArts = await page.$$eval(
      '[data-testid="skills-featured-list"] [data-testid^="featured-skill-"]',
      els =>
        els.map(e => ({
          art:
            e.querySelector('[data-testid="skill-icon"]')?.getAttribute("data-art") ??
            null,
          svg: !!e.querySelector('[data-testid="skill-icon"] svg'),
        }))
    );
    const artKinds = new Set(skillArts.map(a => a.art));
    check(
      "I1 技能是列表不是四列墙；每个分类画自己那张图稿（不是一屏回落的灰星）",
      skillLayout.ok &&
        skillArts.length > 20 &&
        skillArts.every(a => a.svg && a.art && a.art !== "fallback") &&
        artKinds.size >= 5,
      `display ${skillLayout.display} 列 ${skillLayout.cols} · 卡 ${skillArts.length} · 图稿种类 ${artKinds.size}`
    );

    /*
     * I2：放不下就省略号 + 悬浮看全文，且弹出来的是**这张卡自己**的全文。
     *
     * ⚠ 反面在同一条里：名字那行短，必须 data-clipped="0"。只钉"有截断"的话，
     *   把 TruncatedText 改成无条件截断也照样绿。
     */
    await page.setViewportSize({ width: 1300, height: 940 });
    await page.waitForTimeout(1200);
    const clippedDesc = page
      .locator('[data-testid="skill-desc"][data-clipped="1"]')
      .first();
    let skillTip = [];
    let descFull = "";
    if (await clippedDesc.count()) {
      descFull = ((await clippedDesc.textContent()) || "").trim();
      /*
       * ⚠ **先滚进视口再悬浮。** 2026-08-27：改成列表之后，第一条被截断的
       *   描述落在首屏之下（实测 y=1065，视口高 940），鼠标移过去落在页面
       *   外面，`elementsFromPoint` 返回空、tooltip 当然不弹——判据红了，
       *   而功能是好的。判据自己要负责把要量的东西摆到看得见的地方。
       */
      await clippedDesc.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const bb = await clippedDesc.boundingBox();
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.waitForTimeout(1400);
      skillTip = await page.$$eval('[class*="ant-tooltip-inner"]', els =>
        els.filter(e => e.offsetParent !== null).map(e => (e.textContent || "").trim())
      );
    }
    const shortNames = await page.$$eval('[data-testid="skill-name"]', els =>
      els.map(e => e.getAttribute("data-clipped"))
    );
    check(
      "I2 放不下的描述出省略号、悬浮看全文；放得下的名字不挂 tooltip",
      descFull.length > 0 &&
        skillTip.some(t => t === descFull) &&
        shortNames.some(c => c === "0"),
      `全文「${descFull.slice(0, 24)}…」· 浮层 ${JSON.stringify(skillTip.slice(0, 2))} · 名字未截断 ${shortNames.filter(c => c === "0").length}/${shortNames.length}`
    );
    await page.mouse.move(4, 4);
    await page.setViewportSize({ width: 1500, height: 940 });
    await page.waitForTimeout(900);

    /*
     * I3：「添加」**真的**装上/卸掉。
     *
     * ⚠ 这条是本仓第一条纪律的形态：行上翻不翻绿是一回事，"已安装" tab
     *   里有没有真的多出一张卡是另一回事。只钉前者的话，把 installSkill
     *   换成一个只改 state 的空实现照样绿。
     *
     * ⚠ Cursor 那种 All / Installed 是互斥 tab：装完之后「全部」里只把钮
     *   翻成「已安装」，已安装段要切到「已安装」tab 才看得到。再点一次
     *   「已安装」不会切回去——那是上一版 toggle。要卸得先回到「全部」。
     */
    const firstCard = page.locator('[data-testid^="featured-skill-"]').first();
    const firstId = (await firstCard.getAttribute("data-testid")).replace(
      "featured-skill-",
      ""
    );
    const wasInstalled = await firstCard.getAttribute("data-installed");
    await firstCard.locator('[data-testid="skill-install"]').click();
    await page.waitForTimeout(700);
    const afterInstallFlag = await firstCard.getAttribute("data-installed");
    const stillOnAll = await page.locator('[data-testid="skills-featured-list"]').count();
    await page.click('[data-testid="skills-mine"]');
    await page.waitForTimeout(600);
    const afterInstall = {
      flag: afterInstallFlag,
      stillOnAll,
      section: await page.locator('[data-testid="skills-installed"]').count(),
      card: await page
        .locator(`[data-testid="installed-skill-trae-market/${firstId}"]`)
        .count(),
    };
    await page.click('[data-testid="skills-view-all"]');
    await page.waitForTimeout(600);
    await page
      .locator(`[data-testid="featured-skill-${firstId}"] [data-testid="skill-install"]`)
      .click();
    await page.waitForTimeout(700);
    const afterUninstall = {
      flag: await page
        .locator(`[data-testid="featured-skill-${firstId}"]`)
        .getAttribute("data-installed"),
    };
    await page.click('[data-testid="skills-mine"]');
    await page.waitForTimeout(500);
    afterUninstall.card = await page
      .locator(`[data-testid="installed-skill-trae-market/${firstId}"]`)
      .count();
    await page.click('[data-testid="skills-view-all"]');
    await page.waitForTimeout(400);
    check(
      "I3 「添加」装上：行翻成已安装 + 已安装 tab 真的多出这张卡；回到全部分再卸干净",
      wasInstalled === "0" &&
        afterInstall.flag === "1" &&
        afterInstall.stillOnAll === 1 &&
        afterInstall.section === 1 &&
        afterInstall.card === 1 &&
        afterUninstall.flag === "0" &&
        afterUninstall.card === 0,
      `装前 ${wasInstalled} · 装后 ${JSON.stringify(afterInstall)} · 卸后 ${JSON.stringify(afterUninstall)}`
    );

    /*
     * I4：分类条**真的在筛**。
     *
     * ⚠ 判据是"筛完的卡数 === 这个分类 chip 上写的那个数"，两边都是页面上
     *   看得见的东西，并且互相咬——chip 写死一个数会红，筛选没接上（卡数
     *   还是 79）也会红。
     */
    const firstCat = page.locator('[data-testid="skills-cat"]').first();
    const catName = await firstCat.getAttribute("data-cat");
    const catCount = Number(
      ((await firstCat.textContent()) || "").replace(catName, "").trim()
    );
    const allCards = await page.locator('[data-testid^="featured-skill-"]').count();
    await firstCat.click();
    await page.waitForTimeout(600);
    const catFiltered = await page
      .locator('[data-testid^="featured-skill-"]')
      .count();
    /* 分类条不再有第二颗「全部」，清筛选要点左边那颗 view tab。 */
    await page.click('[data-testid="skills-view-all"]');
    await page.waitForTimeout(400);
    const backAll = await page.locator('[data-testid^="featured-skill-"]').count();
    check(
      `I4 分类「${catName}」筛出来的卡数 === chip 上写的数；点「全部」能回来`,
      catCount > 0 &&
        catFiltered === catCount &&
        catFiltered < allCards &&
        backAll === allCards,
      `chip ${catCount} · 筛后 ${catFiltered} · 全量 ${allCards} · 回来 ${backAll}`
    );

    /* ── E / E2：试取真数据，成功与失败是一对 ─────────────────────── */
    await gotoLayer(page, "connectors");
    /*
     * E0：卡片墙**只列真的能用的**。
     *
     * ⚠ 2026-08-26 用户给的效果图上有 24 个连接器（钉钉、飞书、Notion、
     *   高德地图…），我们只有 2 个。摆上去点不通，就是这整条链路存在的理由
     *   要杀掉的东西——比"没有这个连接器"更糟，因为用户会以为接得上。
     *   判据钉的是**卡片数 === 后端清单长度**，顺带钉住页面上那个数字也是
     *   数出来的、不是写死的。
     */
    const backendIds = await page.evaluate(async () => {
      const r = await fetch("/api/sliderule/connectors");
      if (!r.ok) return [];
      const j = await r.json();
      return (j.connectors || []).map(c => c.id);
    });
    const cardIds = await page.$$eval('[data-testid="connector-card"]', els =>
      els.map(e => e.getAttribute("data-connector"))
    );
    const countText = (
      await page.textContent('[data-testid="connector-count"]')
    )?.trim();
    check(
      "E0 卡片墙只列后端真有的连接器，数量照实数（效果图上那 22 个假的不许摆）",
      backendIds.length > 0 &&
        JSON.stringify([...cardIds].sort()) ===
          JSON.stringify([...backendIds].sort()) &&
        countText === `${backendIds.length} 个`,
      `后端 ${JSON.stringify(backendIds)} · 卡片 ${JSON.stringify(cardIds)} · 页面写 ${countText}`
    );

    /*
     * E1：卡片上是**真图稿**，而且每个连接器画的是它自己那张。
     *
     * ⚠ 判据要盯"画的是不是它自己那张"，不是"有没有图标"。全都回落成插头
     *   一样有图标、一样不报错，只是一排一模一样的灰插头——那是"配了等于
     *   没配"，而这正是这类映射表最容易烂掉的方式（后端加连接器、前端忘了
     *   加图稿）。
     */
    const arts = await page.$$eval('[data-testid="connector-card"]', els =>
      els.map(e => ({
        id: e.getAttribute("data-connector"),
        art:
          e
            .querySelector('[data-testid="connector-icon"]')
            ?.getAttribute("data-art") ?? null,
        svg: !!e.querySelector('[data-testid="connector-icon"] svg'),
      }))
    );
    check(
      "E1 每张卡都有自己那张真图稿（不是一排回落的灰插头）",
      arts.length > 0 &&
        arts.every(a => a.svg && a.art && a.art !== "plug") &&
        new Set(arts.map(a => a.art)).size === arts.length,
      JSON.stringify(arts)
    );

    /*
     * E2b：列表不是四列墙 + 放不下就省略号 + **只在真截断时**弹 tooltip。
     *
     * ⚠ tooltip 的 class 前缀是项目配的 `agent-ant-*`，不是 antd 默认的
     *   `ant-*`。第一版判据按默认前缀找，找不到节点、报"没有 tooltip"——
     *   而功能完全正常。选择器用 [class*="ant-tooltip-inner"] 兜住两种前缀。
     *
     * ⚠ 反面那条（短文案不弹）是这条判据的价值所在：无条件挂 tooltip 也能让
     *   正面全绿，但一屏几十张卡扫过去满屏乱弹，比不做还烦。
     */
    const connectorLayout = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="connectors-featured-list"]');
      if (!g) return { ok: false, display: null, cols: 0 };
      const cs = getComputedStyle(g);
      const cols =
        cs.gridTemplateColumns === "none"
          ? 0
          : cs.gridTemplateColumns.split(" ").filter(Boolean).length;
      return {
        ok: cs.display !== "grid" && cols !== 4,
        display: cs.display,
        cols,
      };
    });
    // 窄一点：右侧 meta 列更挤，长文案一定放不下
    await page.setViewportSize({ width: 1300, height: 940 });
    await page.waitForTimeout(1200);
    const clipState = await page.$$eval('[data-testid="connector-card"]', els =>
      els.map(e => ({
        id: e.getAttribute("data-connector"),
        meta: e
          .querySelector('[data-testid="connector-meta"]')
          ?.getAttribute("data-clipped"),
      }))
    );
    const clipped = page
      .locator('[data-testid="connector-meta"][data-clipped="1"]')
      .first();
    let tipText = [];
    if (await clipped.count()) {
      const bb = await clipped.boundingBox();
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.waitForTimeout(1400);
      tipText = await page.$$eval('[class*="ant-tooltip-inner"]', els =>
        els
          .filter(e => e.offsetParent !== null)
          .map(e => (e.textContent || "").slice(0, 60))
      );
    }
    check(
      "E2b 连接器是列表不是四列墙；放不下的行出省略号，悬浮能看到全文",
      connectorLayout.ok &&
        clipState.every(c => c.meta === "1") &&
        tipText.some(t => t.includes("落成实体")),
      `display ${connectorLayout.display} 列 ${connectorLayout.cols} · 截断 ${JSON.stringify(clipState)} · tooltip ${JSON.stringify(tipText)}`
    );

    /* 反面：没截断的短文案**不许**弹 tooltip */
    await page.mouse.move(4, 4);
    await page.waitForTimeout(900);
    const shortOne = page
      .locator('[data-testid="connector-name"][data-clipped="0"]')
      .first();
    let shortTip = [];
    if (await shortOne.count()) {
      const bb = await shortOne.boundingBox();
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.waitForTimeout(1400);
      const name = (await shortOne.textContent())?.trim();
      shortTip = await page.$$eval(
        '[class*="ant-tooltip-inner"]',
        els =>
          els
            .filter(e => e.offsetParent !== null)
            .map(e => (e.textContent || "").trim())
      );
      shortTip = shortTip.filter(t => t === name);
    }
    check(
      "E2c 没截断的短文案不弹 tooltip（无条件挂会让一屏卡片扫过去满屏乱弹）",
      shortTip.length === 0,
      `弹出来的重复浮层 ${JSON.stringify(shortTip)}`
    );
    await page.setViewportSize({ width: 1500, height: 940 });
    await page.waitForTimeout(900);

    /* E3：卡片上的「+ / ✓ 已添加」= 挂不挂在这一轮，跟 `/` 同一条路径。
       ⚠ 顺带钉住"点 + 不跳页"：用户在挑连接器，跳走了就看不到状态变化、
         也没法接着挑第二个。 */
    const urlBefore = page.url();
    await page.click(
      '[data-testid="connector-card"][data-connector="stock"] [data-testid="connector-attach"]'
    );
    await page.waitForTimeout(800);
    const attachedNow = await page.getAttribute(
      '[data-testid="connector-card"][data-connector="stock"]',
      "data-attached"
    );
    const stayed = page.url() === urlBefore;
    await page.click('[data-testid="connector-mine"]');
    await page.waitForTimeout(600);
    const mine = await page.$$eval('[data-testid="connector-card"]', els =>
      els.map(e => e.getAttribute("data-connector"))
    );
    /* 全部 / 已添加是互斥 tab，再点一次「已添加」不会切回去。 */
    await page.click('[data-testid="connector-view-all"]');
    await page.waitForTimeout(400);
    await page.click(
      '[data-testid="connector-card"][data-connector="stock"] [data-testid="connector-attach"]'
    );
    await page.waitForTimeout(600);
    const detached = await page.getAttribute(
      '[data-testid="connector-card"][data-connector="stock"]',
      "data-attached"
    );
    check(
      "E3 「+ / 已添加」真的挂到这一轮、「我的连接器」筛得出、再点摘掉，且不跳页",
      attachedNow === "1" &&
        stayed &&
        JSON.stringify(mine) === JSON.stringify(["stock"]) &&
        detached === "0",
      `挂上=${attachedNow} 留在原页=${stayed} 我的=${JSON.stringify(mine)} 摘掉后=${detached}`
    );

    const card = page.locator('[data-testid="connector-card"][data-connector="weather"]');
    // 试取藏在卡片展开里（效果图的卡片是紧凑的），先展开
    await card.locator('[data-testid="connector-expand"]').click();
    await page.waitForTimeout(400);
    await card.locator('[data-testid="connector-preview"]').click();
    await card
      .locator('[data-testid="connector-preview-result"], [data-testid="connector-error"]')
      .first()
      .waitFor({ timeout: 60000 })
      .catch(() => {});
    const okBox = await card.locator('[data-testid="connector-preview-result"]').count();
    const okText = okBox
      ? await card.locator('[data-testid="connector-preview-result"]').textContent()
      : "";
    /* ⚠ 判据不是"出了个表格"，而是**表格里是真的**：行数对得上、日期是
       今明两天、来源写着 Open-Meteo。出个表格太容易了——铺 12 行示例数据
       同样出得来，而那正是这条链路要消灭的东西。 */
    const looksReal =
      okBox > 0 &&
      /Open-Meteo/.test(okText) &&
      /\d{4}-\d{2}-\d{2}/.test(okText) &&
      /行 ·/.test(okText);
    check(
      "E 连接器「试取真数据」拿回真值（带来源和日期，不是示例表）",
      looksReal,
      (okText || "（没有结果）").replace(/\s+/g, " ").slice(0, 140)
    );

    await card.locator('[data-testid="connector-arg"]').fill("压根不存在的城市zzz");
    await card.locator('[data-testid="connector-preview"]').click();
    await card
      .locator('[data-testid="connector-error"]')
      .waitFor({ timeout: 60000 })
      .catch(() => {});
    const errText =
      (await card.locator('[data-testid="connector-error"]').count())
        ? await card.locator('[data-testid="connector-error"]').textContent()
        : "";
    const rowsShown = await card.locator('[data-testid="connector-preview-result"]').count();
    check(
      "E2 认不出的城市如实报错，且一行都不显示",
      /zzz/.test(errText) && rowsShown === 0,
      `错误=${(errText || "（没有）").slice(0, 60)} · 还在显示行=${rowsShown}`
    );

    /* ── J：伙伴层（2026-08-26 按效果图重做版式 + 把「存成伙伴」接上）── */
    /* 先在连接器层挂一个天气——J2 要拿它存成伙伴 */
    await page.click(
      '[data-testid="connector-card"][data-connector="weather"] [data-testid="connector-attach"]'
    );
    await page.waitForTimeout(600);
    await gotoLayer(page, "partners");
    await page.waitForSelector('[data-testid="partners-list"]', { timeout: 20000 });
    await page.waitForTimeout(800);

    /*
     * J1：列表市场 + 头像**由它接的连接器拼出来**。
     *
     * ⚠ 判据钉的是"三个伙伴的头像各不相同、且跟它的依赖对得上"，不是
     *   "有没有头像"。全都回落成中性小人一样有头像、一样不报错——那就是
     *   效果图上那种"看着丰满、其实什么也不接"。晨会看板接了两样，
     *   它的头像必须是 weather+chart。
     */
    const pLayout = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="partners-builtin"]');
      if (!g) return { ok: false, display: null, cols: 0 };
      const cs = getComputedStyle(g);
      const cols =
        cs.gridTemplateColumns === "none"
          ? 0
          : cs.gridTemplateColumns.split(" ").filter(Boolean).length;
      return {
        ok: cs.display !== "grid" && cols !== 4,
        display: cs.display,
        cols,
      };
    });
    const pAvatars = await page.$$eval('[data-testid="partner-card"]', els =>
      els.map(e => ({
        id: e.getAttribute("data-partner"),
        icons:
          e.querySelector('[data-testid="partner-avatar"]')?.getAttribute("data-icons") ??
          null,
      }))
    );
    const iconOf = id => pAvatars.find(a => a.id === id)?.icons;
    check(
      "J1 伙伴是列表不是四列墙；头像由它接的连接器拼出来（接两样的出双图）",
      pLayout.ok &&
        pAvatars.length === 3 &&
        iconOf("weather-desk") === "weather" &&
        iconOf("market-desk") === "chart" &&
        iconOf("weather-market") === "weather+chart",
      `display ${pLayout.display} 列 ${pLayout.cols} · ${JSON.stringify(pAvatars)}`
    );

    /*
     * J1b：起手意图那块**不许漏字**。
     *
     * ⚠ 这条只有量渲染后的 DOM 才抓得到（仓里第五条）。第一版把内边距和
     *   `-webkit-line-clamp:2` 放在同一个元素上，第三行会从**底部内边距里**
     *   露出小半截（真机截图上是"和每天的降水概率"被拦腰切开的一条）。
     *
     * ⚠ **第一版判据在这上面打空过。** 当时量的是 `scrollHeight - clientHeight`：
     *   好的坏的都是 0——因为那半截字是渲染在 padding 区里的，属于 padding box
     *   之内，根本不算溢出。把修复改回去、截图上毛病明明白白回来了，判据却
     *   照样绿。这正是仓里第二条说的"没红就是判据没用"。
     *
     *   换成量**行**：拿 Range 数出每一行的行盒，看有几行的顶边落在裁剪线
     *   （clientHeight）以上——也就是"能被看见的行"。夹两行就只许看见两行。
     *   坏的那版第三行顶边在裁剪线上方 3px，这里数出 3，红。
     */
    const openerLines = await page.$$eval('[data-testid="partner-opener"]', els =>
      els.map(el => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const box = el.getBoundingClientRect();
        // 同一行可能有多个行盒（内联被拆开），按顶边去重才是"行数"
        const tops = new Set(
          [...r.getClientRects()]
            .map(x => Math.round(x.top - box.top))
            .filter(top => top < el.clientHeight)
        );
        return tops.size;
      })
    );
    check(
      "J1b 起手意图只露出夹断的那一行（列表行不再用两行夹断填高度）",
      openerLines.length === 3 && openerLines.every(n => n > 0 && n <= 1),
      `每张卡看得见的行数 ${JSON.stringify(openerLines)}`
    );

    /*
     * J2：「存成伙伴」端到端 —— 这条是这次改动的**主证据**。
     *
     * ⚠ 这一页的空态一直写着"挂几个能力再回这里存成小队"，而存的入口
     *   压根不存在（partnerFromCurrent 写好了没人调）。判据必须走完
     *   存 → 出现在「我攒的」→ **刷新后还在**（真落了 localStorage）→ 删掉，
     *   而不是只看弹窗弹没弹：弹窗弹出来但存不下去，正是原来那种半截活。
     */
    const mineName = `烟测小队${Date.now().toString(36).slice(-4)}`;
    await page.click('[data-testid="partner-save-open"]');
    await page.waitForSelector('[data-testid="partner-save-name"]', { timeout: 10000 });
    await page.fill('[data-testid="partner-save-name"]', mineName);
    await page.fill(
      '[data-testid="partner-save-opener"]',
      "做一个城市天气页，把今天和未来三天摆出来。"
    );
    await page.click(".ant-modal-footer .ant-btn-primary, [class*=ant-modal-footer] [class*=ant-btn-primary]");
    await page.waitForTimeout(900);
    const savedNow = await page.locator('[data-testid="partners-mine"]').count();
    const savedCardText = savedNow
      ? await page.locator('[data-testid="partners-mine"]').textContent()
      : "";

    /* 刷新：存档是不是真落盘（只改 state 不写 localStorage 的话这里就没了） */
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await gotoLayer(page, "partners");
    await page.waitForSelector('[data-testid="partners-list"]', { timeout: 20000 });
    await page.waitForTimeout(800);
    const afterReload = await page.locator('[data-testid="partners-mine"]').textContent().catch(() => "");

    /* 删掉，别把测试账号的存档留脏；顺带验删钮真的删得掉 */
    await page.click('[data-testid="partners-mine"] [data-testid="partner-delete"]');
    await page.waitForTimeout(700);
    const afterDelete = await page.locator('[data-testid="partners-mine"]').count();
    check(
      "J2 「存成伙伴」存得下来、刷新后还在、删得掉（空态那句话终于成立）",
      savedNow === 1 &&
        savedCardText.includes(mineName) &&
        (afterReload || "").includes(mineName) &&
        afterDelete === 0,
      `存后=${savedNow} · 刷新后${(afterReload || "").includes(mineName) ? "还在" : "没了"} · 删后段数=${afterDelete}`
    );

    /*
     * J3：「我的伙伴」只看自己攒的。
     * ⚠ 正反一对：开着的时候内置那段整段收起；关掉要能回来。只判"能点"的话，
     *   一个什么也不筛的按钮照样绿。
     */
    await page.click('[data-testid="partner-mine"]');
    await page.waitForTimeout(500);
    const onlyMine = {
      builtin: await page.locator('[data-testid="partners-builtin"]').count(),
      cards: await page.locator('[data-testid="partner-card"]').count(),
    };
    /* 全部 / 我的是互斥 tab，再点一次「我的」不会切回去。 */
    await page.click('[data-testid="partner-view-all"]');
    await page.waitForTimeout(500);
    /* ⚠ 名字不能再叫 backAll —— 技能层那条判据（I4）已经在同一个函数作用域里
       声明过它了。重名会让整个脚本**语法错误、一条判据都跑不了**（真机闸
       从 b4c6080 起就是哑的，直到 2026-08-27 才被发现）。 */
    const partnersBackAll = {
      builtin: await page.locator('[data-testid="partners-builtin"]').count(),
      cards: await page.locator('[data-testid="partner-card"]').count(),
    };
    check(
      "J3 「我的伙伴」把内置那段整段收起，关掉能回来",
      onlyMine.builtin === 0 &&
        onlyMine.cards === 0 &&
        partnersBackAll.builtin === 1 &&
        partnersBackAll.cards === 3,
      `只看我的 ${JSON.stringify(onlyMine)} · 关掉 ${JSON.stringify(partnersBackAll)}`
    );

    /* 把这一轮挂着的天气摘掉，别影响后面的判据 */
    await gotoLayer(page, "connectors");
    await page.click(
      '[data-testid="connector-card"][data-connector="weather"] [data-testid="connector-attach"]'
    );
    await page.waitForTimeout(500);

    /* ── F / G：伙伴 ─────────────────────────────────────────────── */
    await gotoLayer(page, "partners");
    const cards = await page.$$eval('[data-testid="partner-card"]', els =>
      els.map(e => ({
        id: e.getAttribute("data-partner"),
        ready: e.getAttribute("data-ready"),
        missing: e.querySelector('[data-testid="partner-missing"]') ? 1 : 0,
        disabled: e.querySelector('[data-testid="partner-use"]')?.disabled ? 1 : 0,
      }))
    );
    /* ⚠ 正反两条：齐了要能按，缺了要按不动**并且说出缺什么**。
       只判"能按"的话，一个永远显示可用、点了没反应的伙伴照样绿。 */
    const consistent = cards.every(c =>
      c.ready === "1" ? c.disabled === 0 && c.missing === 0 : c.disabled === 1 && c.missing === 1
    );
    check(
      "F 伙伴：依赖齐可按，缺依赖按不动且说明缺什么",
      cards.length > 0 && consistent,
      JSON.stringify(cards)
    );

    const readyOne = cards.find(c => c.ready === "1");
    if (readyOne) {
      await page.click(
        `[data-testid="partner-card"][data-partner="${readyOne.id}"] [data-testid="partner-use"]`
      );
      await page.waitForSelector(TA, { timeout: 30000 });
      await page.waitForTimeout(2500);
      const gChips = await page.$$eval(
        '[data-testid="sliderule-capability-chip"]',
        els => els.map(e => e.getAttribute("data-key"))
      );
      const gText = await page.inputValue(TA);
      check(
        "G 「用这个伙伴」挂上能力 + 跳回推演 + 起手意图填进输入框",
        gChips.length > 0 && gText.trim().length > 10,
        `芯片 ${JSON.stringify(gChips)} · 输入框 ${JSON.stringify(gText.slice(0, 40))}`
      );
    } else {
      check("G 「用这个伙伴」", false, "没有一个依赖齐全的伙伴可点");
    }
  } finally {
    const passed = results.filter(r => r.ok).length;
    log(`${passed}/${results.length} 通过`);
    const failed = results.filter(r => !r.ok);
    if (failed.length) log("失败：" + failed.map(f => f.id).join(", "));
    await browser.close();
    if (failed.length) process.exitCode = 1;
  }
}

main().catch(err => {
  log("崩了：" + String(err));
  process.exitCode = 1;
});
