"""过夜 inspect 必须看注释外的活标签。

2026-08-20 律所 r0：``<!-- 左侧导航 <aside`` 没闭合，源码 grep ``<aside``
假绿，截图没有侧栏。把 inspect 改回直接搜源码，下面这条要红。
"""

from scripts.overnight_device_iter import inspect_html


def test_注释里的aside不算桌面有侧栏():
    raw = (
        "<header>顶栏</header>"
        "<!-- 左侧导航 <aside class='w-64'><nav><a>工作台</a></nav></aside>\n"
        "<!-- 主正文 <main> -->\n<main>正文</main>"
    )
    hits = inspect_html(raw, "desktop")
    assert "desktop 没有 <aside>" in hits
    assert "desktop 侧栏困在未闭合注释里" in hits


def test_活的aside不报():
    raw = (
        "<aside class='w-64'><nav><a>工作台</a></nav></aside>"
        "<header>顶栏</header><main>正文</main>"
    )
    assert inspect_html(raw, "desktop") == []
