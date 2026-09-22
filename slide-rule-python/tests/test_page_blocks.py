"""块身份（`data-block`）的判据。

抄的是 grok-build `xai-grok-config/src/managed_text/`：标记即身份、名字唯一、
body 不许含标记、换完过校验器。所以判据也按那四条来，外加本仓第三条纪律
——每条「应该有 X」配一条「不该有 Y / X 真的被用到了」。

⚠ 变异自查（写完把修复改回去，确认变红）：
    · 去掉 _NEVER_BLOCK_TAGS      → 「按钮不是块」红
    · 去掉最外层去重那句           → 「块之间不许嵌套」红
    · mark_page_blocks 改成非幂等   → 「重打不换名字」红
    · 把 pipeline 里两个调用点删掉  → 「接在链路上」红
"""

from __future__ import annotations

import ast
import glob
import os

import pytest

from services.page_blocks import (
    BLOCK_KINDS,
    BLOCK_MARK_ATTR,
    BlockEditError,
    block_summary,
    mark_page_blocks,
    mark_pages_blocks,
    replace_block,
    scan_blocks,
    slice_block,
    validate_block_body,
)

CARD = 'class="bg-white rounded-lg border border-slate-200 shadow-sm p-6"'


def _page(main_inner: str, *, chrome: bool = True) -> str:
    shell = (
        '<aside data-shell="aside"><div class="bg-white rounded-lg border shadow-sm">菜单卡</div></aside>'
        '<header data-shell="header"><div class="bg-white rounded-lg border shadow-sm">面包屑卡</div></header>'
        if chrome
        else ""
    )
    return f"<html><body>{shell}<main data-shell=\"main\">{main_inner}</main></body></html>"


# ── 一、划块 ────────────────────────────────────────────────────────


def test_main_content_cards_get_block_identity():
    html = mark_page_blocks(
        _page(f'<div class="grid"><div {CARD}><h3>库存概览</h3></div><div {CARD}><h3>今日出库</h3></div></div>')
    )
    names = [b["name"] for b in block_summary(html)]
    assert names == ["库存概览", "今日出库"], names


def test_shell_is_never_a_block():
    """反向判据：壳里也有一模一样的卡片签名，**不许**被提成块。

    壳是每页都一样的东西，提成块的话画布上每页都多出两个假块，
    而且「改这一块」会改到菜单上去。
    """
    html = mark_page_blocks(_page(f'<div {CARD}><h3>库存概览</h3></div>'))
    assert [b["name"] for b in block_summary(html)] == ["库存概览"]
    aside = html[html.index("<aside") : html.index("</aside>")]
    assert BLOCK_MARK_ATTR not in aside, "壳里被打了块标"


def test_button_is_not_a_block():
    """2026-08-27 首轮扫真机页抓到的：圆角+投影的按钮吃中卡片签名。

    按钮是块**里面**的零件（画布已有的元素点选管它），不是组装单位。

    ⚠ 判据自查（2026-08-27）：第一版把按钮写在卡片**里面**，那把闸拆了照样
      绿——最外层去重本来就吃掉了它。真机上中招的是**顶层**按钮（工具条里
      「新增老人档案」「导出任务表」直接挂在 main 下）。判据必须摆成真机的形状。
    """
    html = mark_page_blocks(
        _page(
            '<div class="flex justify-between">'
            '<button class="rounded-lg shadow-sm bg-white px-4">新增老人档案</button>'
            '<a class="rounded shadow-sm bg-white px-4" href="#">导出</a>'
            "</div>"
            f'<div {CARD}><h3>工单</h3></div>'
        )
    )
    assert [b["name"] for b in block_summary(html)] == ["工单"]


def test_blocks_never_nest():
    """最外层且互不重叠——unmanaged_text 能原样拼回的前提。"""
    html = mark_page_blocks(_page(f'<section><div {CARD}><h3>里层</h3></div></section>'))
    blocks = scan_blocks(html)
    assert len(blocks) == 1 and blocks[0]["tag"] == "section"
    spans = [(b["start"], b["end"]) for b in blocks]
    assert all(a[1] <= b[0] for a, b in zip(spans, spans[1:])), "块区间重叠了"


def test_unclosed_element_is_not_marked():
    """边界不确定的东西不许当块：改它会顺手吃掉半页。"""
    html = mark_page_blocks(_page(f'<div {CARD}><h3>没闭合</h3>'))
    assert block_summary(html) == []


# ── 二、名字 ────────────────────────────────────────────────────────


def test_duplicate_labels_are_disambiguated_and_stay_addressable():
    html = mark_page_blocks(_page(f'<div {CARD}><h3>今日</h3></div><div {CARD}><h3>今日</h3></div>'))
    names = [b["name"] for b in block_summary(html)]
    assert names == ["今日", "今日#2"], names
    for n in names:  # 消歧完每个名字都还能寻址（grok 那边重名是直接拒）
        assert slice_block(html, n)["name"] == n


def test_metric_label_is_not_the_number():
    """指标卡里字最粗的是那个数。用它当名字，数一变名字就换人。"""
    html = mark_page_blocks(
        _page(f'<div {CARD}><p class="text-sm text-slate-500">总建档人数</p>'
              f'<p class="text-2xl font-bold">1,284</p></div>')
    )
    name = block_summary(html)[0]["name"]
    assert name == "总建档人数", name
    assert "1,284" not in name


def test_table_header_row_is_not_the_label():
    """表头那行也带 font-medium。抓它当标题，块名会变成整行表头。"""
    html = mark_page_blocks(
        _page(
            f'<div {CARD}><table><thead><tr class="font-medium">'
            "<th>姓名</th><th>性别</th><th>年龄</th><th>健康等级</th></tr></thead></table></div>"
        )
    )
    label = block_summary(html)[0]["label"]
    assert "性别" not in label and "健康等级" not in label, label


def test_lead_comment_names_a_titleless_block():
    """真机 24 页里两块表格卡整块没标题，但前面有一条注释。"""
    html = mark_page_blocks(
        _page(f'<!-- 老人档案主表 (占据主要高度) --><div {CARD}><table><tbody></tbody></table></div>')
    )
    assert block_summary(html)[0]["name"] == "老人档案主表"


# ── 三、幂等 ────────────────────────────────────────────────────────


def test_marking_twice_changes_nothing():
    once = mark_page_blocks(_page(f'<div {CARD}><h3>库存概览</h3></div><div {CARD}><h3>库存概览</h3></div>'))
    assert mark_page_blocks(once) == once, "重打把 HTML 改了"


def test_remark_keeps_existing_names_when_content_shifts():
    """名字换人 = 用户在画布上选中的那一块换了人。内容改了也不许换。"""
    once = mark_page_blocks(_page(f'<div {CARD}><h3>库存概览</h3></div>'))
    edited = once.replace("<h3>库存概览</h3>", "<h3>库存总览（改过）</h3>")
    assert block_summary(mark_page_blocks(edited))[0]["name"] == "库存概览"


def test_avatars_do_not_make_a_block_a_media_block():
    """2026-08-27 真机（协作空间那趟，20 块里错 6 块）：看板四列每列一堆
    任务卡、卡上带头像，第一版「块里有 <img> 就判图文」把四列全判成了图文。
    头像不是这一块的主角。门槛落在**文字量**上——图文块的字本来就少。
    """
    column = (
        f'<div {CARD}><h3>待办</h3>'
        '<div><img src="a.png" alt="头像"><span>接口联调 · 张三 · 明天到期</span></div>'
        '<div><img src="b.png" alt="头像"><span>补充埋点文档 · 李四 · 本周</span></div>'
        "</div>"
    )
    assert block_summary(mark_page_blocks(_page(column)))[0]["kind"] == "card"
    # 反面：真正的图文块（一张图 + 一句说明）仍然判图文，否则这条闸恒真
    figure = f'<div {CARD}><img src="c.png" alt="封面"><p>门店实景</p></div>'
    assert block_summary(mark_page_blocks(_page(figure)))[0]["kind"] == "media"


def test_remark_refreshes_kind_but_never_the_name():
    """名字是**地址**，类型是元信息。

    2026-08-27 真机（协作空间那趟）：第 3.5 步打标那会儿 `data-*` 孔还没打，
    看板那四列看不出是逐行容器，判成了 card；第 6.5 步打完孔再算才是 table。
    所以重打时**类型要重算、名字一个字不许改**——名字一变，用户在画布上
    选中的那一块就换人了。
    """
    once = mark_page_blocks(_page(f'<div {CARD}><h3>待办</h3><div>一条</div></div>'))
    assert block_summary(once)[0]["kind"] == "card"
    # 模拟 bind 往块里打了逐行孔
    bound = once.replace("<div>一条</div>", '<tbody data-rows="task"><tr><td>一条</td></tr></tbody>')
    after = block_summary(mark_page_blocks(bound))[0]
    assert after["name"] == "待办", "名字被改了——用户选中的那一块换人了"
    assert after["kind"] == "table", f"类型没跟着 HTML 重算：{after['kind']}"


def test_marking_a_third_time_still_changes_nothing():
    """⚠ 这条是变异自查逼出来的（2026-08-27）：类型重写那一版把属性偏移
    算在了 `el.body` 上（少了 `1+len(tag)`），替换落进标签名中间。
    第一遍、第二遍都看不出来——**第三遍跟第二遍不一致**才露的馅。
    """
    once = mark_page_blocks(_page(f'<div {CARD}><h3>待办</h3><div>一条</div></div>'))
    bound = once.replace("<div>一条</div>", '<tbody data-rows="task"><tr><td>一条</td></tr></tbody>')
    twice = mark_page_blocks(bound)
    assert mark_page_blocks(twice) == twice
    assert "<div " in twice and "<dtable" not in twice, "标签名被写坏了"


def test_marking_pages_is_fail_open():
    """打标是增强（纪律七）：单页炸了只丢那一页的标，别页照打、页面照交。"""

    class Boom(str):
        def __len__(self):  # noqa: D401 — 制造一个会在打标里炸的"页面"
            raise RuntimeError("boom")

    out = mark_pages_blocks({"p1": Boom(_page(f'<div {CARD}><h3>好页</h3></div>')), "p2": _page(f'<div {CARD}><h3>另一页</h3></div>')})
    assert set(out) == {"p1", "p2"}
    assert block_summary(out["p2"])[0]["name"] == "另一页"


# ── 四、按块改写（grok 的 unmanaged_text / validator 两条）──────────


def test_slice_is_byte_exact():
    html = mark_page_blocks(_page(f'<div {CARD}><h3>库存概览</h3></div><div {CARD}><h3>今日出库</h3></div>'))
    cut = slice_block(html, "库存概览")
    assert cut["before"] + cut["head"] + cut["body"] + cut["tail"] + cut["after"] == html


def test_replace_touches_only_that_block():
    """正向：这一块换了。反向：其余每一个字节都没动（unmanaged_text）。"""
    html = mark_page_blocks(_page(f'<div {CARD}><h3>库存概览</h3></div><div {CARD}><h3>今日出库</h3></div>'))
    out = replace_block(html, "库存概览", "<h3>库存概览</h3><p>新写的一段</p>")
    assert "新写的一段" in out
    other = slice_block(html, "今日出库")
    assert other["head"] + other["body"] + other["tail"] in out, "旁边那块被动了"
    assert out.count(BLOCK_MARK_ATTR) == html.count(BLOCK_MARK_ATTR)


def test_body_may_not_carry_a_block_marker():
    """抄 grok 的 `item {} contains marker-like content`：body 里长出标记
    就能把块的边界劫走，下一次 slice 切到的不是这一块了。"""
    with pytest.raises(BlockEditError, match=BLOCK_MARK_ATTR):
        validate_block_body(f'<div {BLOCK_MARK_ATTR}="偷来的">x</div>')


def test_body_must_balance_its_tags():
    """多一个闭合标签会把外层块提前关掉——闸全绿、页面塌了。"""
    with pytest.raises(BlockEditError):
        validate_block_body("<p>正常</p></div>")
    with pytest.raises(BlockEditError):
        validate_block_body("<div><p>没闭合")
    validate_block_body('<div class="x"><p>好的</p><img src="a.png"><br></div>')  # 不许误伤


def test_body_may_not_carry_script():
    with pytest.raises(BlockEditError):
        validate_block_body("<div><script>alert(1)</script></div>")


def test_duplicate_name_fails_closed_on_read():
    """名字指两块，改哪一块都是猜——照 grok 的口径直接判失败，不猜。"""
    html = f'<main><div {CARD} {BLOCK_MARK_ATTR}="同名">a</div><div {CARD} {BLOCK_MARK_ATTR}="同名">b</div></main>'
    with pytest.raises(BlockEditError, match="重复"):
        slice_block(html, "同名")


def test_missing_name_fails_closed():
    with pytest.raises(BlockEditError):
        slice_block(mark_page_blocks(_page(f'<div {CARD}><h3>在的</h3></div>')), "不在的")


# ── 五、接在链路上（纪律一 / 纪律三）────────────────────────────────


def test_marking_reaches_the_live_pipeline():
    """判据不是「函数写对了」，是「它被 spec-first 调了」。

    ⚠ 用 AST，不 grep 源码：本仓被"标识符同时出现在文档字符串里、变异后
      照样绿"咬过一次（CLAUDE.md 第二条）。AST 只看真正的调用节点。
    ⚠ 要求 **≥2** 个调用点：壳统一之后一次、bind 之后一次。bind 会整页
      重写吃掉块标，只打前面那次等于线上成品页没有块身份——
      「改一半必然静默失效」（第四条）。
    """
    src = os.path.join(os.path.dirname(__file__), "..", "services", "spec_first_pipeline.py")
    tree = ast.parse(open(src, encoding="utf-8").read())
    calls = [
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "mark_pages_blocks"
    ]
    assert len(calls) >= 2, f"spec-first 里只找到 {len(calls)} 个块打标调用点"


# ── 六、真机页（纪律五：判据落在真实产物上）────────────────────────


def _real_pages():
    root = os.path.join(os.path.dirname(__file__), "..", "..", "experiments", "refine-fingerprint")
    return sorted(glob.glob(os.path.join(root, "runs-*", "v2-1", "pages_round*", "*.html")))


def test_real_generated_pages_split_into_named_blocks():
    """2026-08-27 基线：24 份真机交付页 → 101 块，其中 100 块有真名字。

    数字本身不是目标，用来咬住"划块规则被改松/改紧"：一放开按钮那条
    立刻涨到 100+ 块，一收紧卡片签名立刻掉到个位数。
    """
    files = _real_pages()
    assert files, "真机页样本不见了"
    total = 0
    dull = 0
    for f in files:
        for b in block_summary(mark_page_blocks(open(f, encoding="utf-8").read())):
            total += 1
            assert b["kind"] in BLOCK_KINDS, b
            assert b["name"].strip(), b
            if b["label"] in ("卡片", "表格", "指标", "图表", "列表", "表单", "详情", "图文"):
                dull += 1
    assert 3.0 <= total / len(files) <= 7.0, f"每页 {total / len(files):.1f} 块，划块规则漂了"
    assert dull <= 2, f"{dull} 块没能取到名字（基线 1）"


def test_real_pages_round_trip_through_slice():
    """真机页上切一块再拼回去，必须一个字节不差。"""
    for f in _real_pages()[:6]:
        html = mark_page_blocks(open(f, encoding="utf-8").read())
        for b in block_summary(html):
            cut = slice_block(html, b["name"])
            assert cut["before"] + cut["head"] + cut["body"] + cut["tail"] + cut["after"] == html, (f, b["name"])
