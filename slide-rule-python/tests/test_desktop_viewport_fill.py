"""桌面页铺满 1920×1080（2026-08-20 满电青年）。

真机形状：模型把 aside+header+main 塞进 ``max-w-6xl mx-auto`` 白卡片，
body 浅绿底 + items-center justify-center。1920×1080 画布是满的，
应用缩在正中——三支箭头指的是卡片四周的底，不是侧栏 ml-64 那条缝。

手机页 08-20 已经有铺满层。桌面漏了，所以只改 reconcile 偏移、舞台
items-start，截图上该空的地方还在空。

⚠ 不许抄手机 ``body>*{margin-left:0}``：fixed 侧栏靠 ml-16/ml-64 让位。
⚠ 不许给 body 写 flex-direction:column：aside 和 main 会被竖着叠。
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.page_shell import (  # noqa: E402
    _DESKTOP_FILL_CSS,
    ensure_desktop_viewport_fill,
    main_offset_tokens,
    unify_shell,
)

SPEC = {"pages": [{"id": "p1", "name": "甲页"}, {"id": "p2", "name": "乙页"}]}

CENTERED = (
    '<!doctype html><html><head></head>'
    '<body class="min-h-screen flex items-center justify-center bg-emerald-50 p-10">'
    '<div class="max-w-6xl w-full mx-auto bg-white rounded-2xl shadow-xl">'
    '<aside class="w-16 bg-zinc-950 border-r fixed h-full"><nav>'
    '<a data-page-id="p1" aria-current="page"><span>甲页</span></a>'
    '<a data-page-id="p2"><span>乙页</span></a></nav></aside>'
    '<header class="h-16"><nav aria-label="Breadcrumb"><ol>'
    '<li><a href="/">库存管理</a></li>'
    '<li><a aria-current="page">甲页</a></li></ol></nav></header>'
    '<main class="ml-16 min-h-screen"><div>正文</div></main>'
    "</div></body></html>"
)


class Test桌面铺满层:
    def test_注入且幂等(self):
        once = ensure_desktop_viewport_fill(CENTERED)
        assert once.count('id="sliderule-desktop-fill"') == 1
        assert 'body>[class*="mx-auto"]' in once
        assert "max-w-6xl" in once, "原文卡片 class 不删，用 CSS 盖"
        twice = ensure_desktop_viewport_fill(once)
        assert twice == once

    def test_不许抹掉侧栏让位(self):
        """★ 抄手机 body>*{margin-left:0} 本条必须红。"""
        assert "body>*{" not in _DESKTOP_FILL_CSS
        out = ensure_desktop_viewport_fill(CENTERED)
        assert main_offset_tokens(out) == ["ml-16"]

    def test_不许把壳竖着叠(self):
        assert "flex-direction:column" not in _DESKTOP_FILL_CSS

    def test_unify接上了(self):
        """把 unify 里那一行删掉，本条必须红——注入函数写了对但没接线。"""
        out = unify_shell({"p1": CENTERED, "p2": CENTERED}, SPEC)["pages"]
        assert 'id="sliderule-desktop-fill"' in out["p1"]
        assert 'id="sliderule-desktop-fill"' in out["p2"]
        assert main_offset_tokens(out["p1"]) == ["ml-64"]

    def test_与前端同文(self):
        from services.page_shell import _DESKTOP_FILL_STYLE_ID

        ts = (
            Path(__file__).resolve().parents[2]
            / "client/src/pages/sliderule/live-runtime/html-app-surface.tsx"
        ).read_text(encoding="utf-8")
        assert _DESKTOP_FILL_STYLE_ID == "sliderule-desktop-fill"
        assert 'DESKTOP_FILL_STYLE_ID = "sliderule-desktop-fill"' in ts
        for token in (
            'body>[class*="mx-auto"]',
            "border-radius:0!important",
            "padding:0!important",
        ):
            assert token in _DESKTOP_FILL_CSS, token
            assert token in ts, token
        desktop_css = ts.split("export const DESKTOP_FILL_CSS")[1].split("function injectHeadStyle")[0]
        assert "body>*{" not in desktop_css
        assert "flex-direction:column" not in desktop_css
