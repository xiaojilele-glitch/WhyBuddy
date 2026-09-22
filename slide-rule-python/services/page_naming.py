# -*- coding: utf-8 -*-
"""页面名与产品名的纯文本处理 —— 叶子模块，**不依赖 services 里任何其它模块**。

## 为什么单独有这个文件（2026-08-29）

它是从 `page_shell` 与 `spec_tree` 各抽一块拼出来的。抽之前那两个文件互相
import，是一个真的循环依赖：

    services.page_shell -> services.spec_tree -> services.page_shell

而**全部原因只有两个小函数**：page_shell 要 `is_host_brand_name`（3 处），
spec_tree 要 `nav_tab_label`（1 处）。两边都只好把 import 写进函数体里绕开——
仓里 463 条「藏在函数体里的 import」就是这么攒出来的。

## 抄的是哪一条

grok-build 的叶子 crate（`docs/欠缺模块清单-对照Claude与Grok-build.md` §17）：
他们 90 个 crate 里有 51 个是 ≤10 个文件的小叶子（`xai-token-estimation`、
`xai-dirs`、`xai-file-utils`…）。**共用件切成叶子，依赖方向就被编译器焊死**——
大块能用叶子，叶子永远碰不到大块。

这两个函数天然是同一件事：都在处理「产品名 / 页面名」这类文本。放在一起
不是为了凑数，是因为它们本来就该在一起——`nav_tab_label` 要剥的正是
`is_host_brand_name` 认得的那个牌子。

## ⚠ 这个文件的纪律

**不许 import services 里任何其它模块。** 它的全部价值就是「谁都能安全 import
它」，一旦它开始依赖上层，环立刻长回来，而且是更隐蔽的那种。
架构闸盯着这条：`architecture.toml` 里它属于 `util` 层，
判据 `test_architecture.py::Test叶子层不许碰上层::test_util层实测确实是叶子`。
"""

from __future__ import annotations

import re

#: 生成方自己的牌子。产品名撞上它说明模型把「谁做的」写成了「做什么」。
_HOST_BRAND_RE = re.compile(r"(面团\s*AI|SlideRule|MianTuan|miantuan)", re.I)
_HOST_BRAND_EXACT = frozenset({"面团", "面团AI", "面团 AI", "面团AI系统", "面团 AI 系统"})


def is_host_brand_name(name: str) -> bool:
    """产品名是不是生成方（面团 AI / SlideRule）自己的牌子。"""
    text = (name or "").strip()
    if not text:
        return False
    if text in _HOST_BRAND_EXACT:
        return True
    return bool(_HOST_BRAND_RE.search(text))


def _strip_page_suffix(text: str) -> str:
    """底栏不要「某某页」的「页」。

    ⚠ 2026-08-20 芸编智管：spec.pages.name 全是「古籍列表页」，五项 × 390px，
    「页」单独折成第三行。对照 iOS Tab Bar：标签是短名。「首页」本身就是短名；
    剥完只剩一个字也留着。
    """
    # ⚠ 2026-09-05 补 `主页`：真机（汉字消除小游戏）「挑战主页」被剥成
    #   「挑战主」——「主页」跟「首页」一样，那个「页」是词的一部分，不是后缀。
    #   剥完 `len>=2` 那道保险拦不住它（「挑战主」正好 3 个字）。
    if text.endswith("页") and not text.endswith(("首页", "主页")):
        stripped = text[:-1].rstrip()
        if len(stripped) >= 2:
            return stripped
    return text


def nav_tab_label(
    name: str, app_name: str = "", *, strip_page_suffix: bool = False
) -> str:
    """底栏标签只要短名。精修后 spec.pages.name 常被写成「产品名 - 某页」。

    ⚠ 不能见到 `` - `` 就 rsplit 取后半：真机有过「订单详情 - 团长帮」，
    一刀切会把标签变成产品名。只剥**前缀或后缀等于产品名**的那一截。

    ## `strip_page_suffix`：剥不剥「页」看设备（2026-09-05）

    去 GitHub 抄的标准答案，两边都亲自看过源码，不是凭语感：

      · **手机**——`ant-design/ant-design-mobile`
        `src/components/tab-bar/demos/demo1.tsx`：
        `title: '首页' / '待办' / '消息' / '我的'`。2~4 字短名，除「首页」
        （「页」是词的一部分）外**不带「页」**。这条本来就有真机事故背书：
        2026-08-20 芸编智管，五项 × 390px，「页」单独折成第三行。

      · **桌面**——`ant-design/ant-design-pro`
        `src/locales/zh-CN/menu.ts`：`'menu.dashboard.analysis': '分析页'`、
        `'menu.form': '表单页'`、`'menu.list': '列表页'`、
        `'menu.profile': '详情页'`、`'menu.profile.basic': '基础详情页'`、
        `'menu.result': '结果页'`、`'menu.exception': '异常页'`……
        **14 项带「页」**。侧栏 `w-64`（256px）一行一项，放得下。
        （不带「页」的是那些自带具体名词的：工作台 / 基础表单 / 查询表格。）

    所以：**手机剥，桌面不剥**。此前不分设备一律剥，是把一个为 390px 底栏
    挤出来的补丁套到了完全不缺地方的桌面侧栏上——还顺手把「挑战主页」
    削成了「挑战主」。

    ⚠ 剥**产品名前缀**那一半跟设备无关，两边都做：菜单项里重复一遍产品名
      在哪个设备上都是废话。

    ⚠ 默认 **False（不剥）**，手机那一路显式传 True。默认值刻意选保守的那一头：
      少剥一个字最多是标签长一点，多剥一个字会把「挑战主页」削成「挑战主」
      ——2026-09-05 真机就是这么出的事。忘记传参时，希望它落在不会毁词的那边。
    """
    text = str(name or "").strip()
    brand = str(app_name or "").strip()
    if brand:
        if text.startswith(brand):
            rest = text[len(brand) :].lstrip(" -·|/")
            if rest:
                text = rest
        for sep in (" - ", " · ", " | "):
            suffix = f"{sep}{brand}"
            if text.endswith(suffix) and len(text) > len(suffix):
                text = text[: -len(suffix)].strip()
                break
    return _strip_page_suffix(text) if strip_page_suffix else text
