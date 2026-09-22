# -*- coding: utf-8 -*-
"""`async def` 里不许直接做同步 IO —— 一处就够全站停摆。

## 事故（2026-08-10）

两台电脑同时开着页面，一台发起推演，另一台**一直转圈**。

服务器上的初判是"只跑了一个 worker"。worker 确实只有一个（Dockerfile 的 CMD
没带 `--workers`），但那是放大器不是病根：**病根是标着 `async def` 的函数在
里面做同步网络 IO**。会话档走 HTTPS 网关（httpx.Client 是阻塞的），而
`async def` 的函数体直接跑在事件循环上——一阻塞就是整个进程停摆。

对着线上库实测：

    select session_id, payload from sliderule_session
    → 34 条会话、5,209,118 字节、2278 ms

`GET /sessions`（侧栏"最近"，每次打开页面都调）就是这条。这 2.3 秒里整个
服务什么都干不了。推演途中 `persist_state` 还要再冻十几次。

## 框架早就给了答案

fastapi/routing.py:344 —

    if is_coroutine:
        return await dependant.call(**values)                        # async def
    else:
        return await run_in_threadpool(dependant.call, **values)     # def

`run_in_threadpool` 就是 `anyio.to_thread.run_sync`（默认 40 令牌）。
**同步路由写成 `def` 才是对的**，写成 `async def` 反而把它钉死在循环上。
本文件里 `drive_full` 早就是这么处理的，还留了注释——只是那条纪律没有铺到
其余路由上。这份测试就是把它铺开、并防止再退回去。

## 判据

- 路由/异步函数体内出现 `load_all` / `load_session` / `save_session` /
  `persist_state` / `read_session_meta` 等**已知阻塞**的调用，
  必须包在 `asyncio.to_thread(...)` 里；
- 函数体一个 `await` 都没有的，最省事的做法是**去掉 `async`**，交给框架。
"""

import ast
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent

#: 已知会打网络/磁盘的同步入口。加新的存储函数时记得进这张表。
BLOCKING_CALLS = {
    "load_all",
    "load_session",
    "save_session",
    "save_session_record",
    "persist_state",
    "read_session_meta",
    "list_session_summaries",
}

TARGETS = [
    "routes/sliderule_full.py",
    "services/v5_full_driver.py",
]


def _offenders(path: pathlib.Path) -> list[tuple[str, int, str]]:
    """返回 (函数名, 行号, 调用名)：在 async 函数体里裸调阻塞 IO 的位置。

    只看**直接归属**于该 async 函数的语句——嵌套的同步 `def` 自己会被单独
    检查（它跑在哪个线程由它的调用方决定，不该在这里判）。
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: list[tuple[str, int, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        nested = {
            id(inner)
            for child in ast.walk(node)
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) and child is not node
            for inner in ast.walk(child)
        }
        for child in ast.walk(node):
            if not isinstance(child, ast.Call) or id(child) in nested:
                continue
            fn = child.func
            name = fn.id if isinstance(fn, ast.Name) else getattr(fn, "attr", "")
            if name not in BLOCKING_CALLS:
                continue
            out.append((node.name, child.lineno, name))
    return out


@pytest.mark.parametrize("rel", TARGETS)
def test_异步函数里没有裸的阻塞IO(rel):
    hits = _offenders(ROOT / rel)
    detail = "\n".join(f"  {rel}:{ln}  {fn}() 里裸调 {call}()" for fn, ln, call in hits)
    assert not hits, (
        f"{len(hits)} 处同步 IO 直接跑在事件循环上——一处卡住，全站请求一起排队：\n"
        f"{detail}\n"
        "修法：函数体没有 await 就去掉 `async`（交给 FastAPI 的线程池），"
        "有 await 就把这行包成 `await asyncio.to_thread(...)`。"
    )


def test_嵌套的async里也算数():
    """扫描器自己的哨兵：别因为多包了一层就漏检。"""
    src = (
        "import asyncio\n"
        "async def outer():\n"
        "    async def inner():\n"
        "        load_all()\n"
        "    await inner()\n"
    )
    tree = ast.parse(src)
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "inner":
            found = [
                c.func.id
                for c in ast.walk(node)
                if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)
            ]
    assert "load_all" in found, "内层 async 函数同样跑在事件循环上，必须能被扫到"
