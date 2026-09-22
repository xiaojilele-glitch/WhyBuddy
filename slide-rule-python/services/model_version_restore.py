# -*- coding: utf-8 -*-
"""版本回退的业务核：**读会话 → 重建闭环证据 → 判决 → 提交**。

## 为什么它在 services 而不是 routes（2026-08-29 搬过来的）

它原来长在 `routes/sliderule_full.py` 里，而 `services/rehearsal_control` 的
`restore_version` 工具要用它，只好**反过来 import routes**——业务层依赖路由层，
方向是反的。后果是一个真的循环依赖：

    routes.sliderule_full -> services.rehearsal_control -> routes.sliderule_full

Python 不会为此报错，它只会逼你把 import 挪进函数体接着跑（那正是当时的写法），
然后在某次 reload 或某个新入口上炸。

抄的是 grok-build 的分层纪律（`docs/欠缺模块清单-对照Claude与Grok-build.md` §17）：
**入口层是个「汇」——箭头只进不出**。实测他们的组合根 `xai-grok-pager-bin`
被依赖数是 **0**：逻辑住在库里，入口只把库接起来。

这个函数里没有一点 HTTP：读会话、重建证据、比对、落库，全是业务。
它住在路由层纯粹是历史。搬下来之后方向就顺了，环和
`services -> routes` 那条越层违规一起清掉。

## ⚠ 还留着的一点 HTTP 味

失败路径仍然返回 `JSONResponse`（404 / 409）。按 grok 的做法，返回什么形状该由
**下层**定义、路由层负责翻译成 HTTP。那是第二步，独立可验：动它要同时改
`rehearsal_control` 里 `isinstance(result, JSONResponse)` 那个判断。
这一次只搬家、不换返回类型——一次只动一件事，坏了才知道是哪一件坏的。

## ⚠ 每会话回退锁**没有**跟着搬

`_RESTORE_LOCKS` 留在路由层，因为它挡的是「同一个会话的并发 HTTP 回退」。
控制面那条路（`_tool_restore`）本来就不走这把锁——这是既有的并发缺口，
不是这次搬家造成的，也不在这次的范围里。
"""

from __future__ import annotations

from typing import Any, Dict, Optional  # noqa: F401  —— 函数体注解用

from fastapi.responses import JSONResponse

from services.slide_rule_session import load_session, save_session


def restore_model_version_locked(sid: str, version_id: str):
    state = load_session(sid)
    if state is None:
        return JSONResponse(status_code=404, content={"error": "session_not_found"})
    versions = list(getattr(state, "modelVersions", None) or [])
    target = next((v for v in versions if isinstance(v, dict) and v.get("id") == version_id), None)
    if target is None or not isinstance(target.get("model"), dict):
        return JSONResponse(status_code=404, content={"error": "version_not_found"})
    if getattr(state, "currentModelVersionId", None) == version_id:
        # 已经就是当前版本：无操作（防前进/回退连点）
        return {"restored": False, "reason": "already_current", "state": state.model_dump()}

    # ⚠ 页面跟着版本一起回退。不跟的话回退是**说谎**：指针回到 v1，右侧还是
    #   v3 的页面。这跟下面 D8 那条修复（"UI 显示回到 v1、实际跑的还是 v3"）
    #   是同一个病，只是发生在交付物上而不是模型上。
    #
    # ⚠ 但**动手要等到 D8 判完之后**（2026-08-29 真机 sr-it-065848-A）。
    #   原来这一行坐在重建之前，于是：
    #
    #       写 state.specFirstPages = None（目标快照的页早被降级阶梯抹了）
    #         → _ensure_runtime_closure_evidence 内部有三处 persist_state
    #           （capability_start / complete / error 各一），核心集合有增长，
    #           单调守卫放行 → **抹空的那份当场落库**
    #         → D8 判 closure_rebuild_mismatch，409「指针未移动」
    #
    #   指针确实没动，页却已经在库里没了：实测回退前 6 张交付页，409 之后
    #   `payload->'specFirstPages'->'pages'` 直接不存在。而且**补不回来**——
    #   同一个 lastTurnId 再 save 一次会被单调守卫退回旧值（specFirstPages
    #   不在 publishClosure/modelVersions 那几个豁免键里，见
    #   scripts/backfill_page_id_aliases.py 模块头）。
    #
    #   照 grok-build `verify_published` 的顺序：先跑、回读比对、**判完再提交**。
    #   D8 那段一直只做到"回读比对"，提交与回滚这一步从来没写。
    _pages_before = getattr(state, "specFirstPages", None)

    from services.v5_llm_generate import set_model_override
    from services.v5_full_driver import _ensure_runtime_closure_evidence, record_model_version
    from services.v5_publish_closure_response import derive_publish_closure_response
    from services.v5_skill_runtime_graph import derive_skill_runtime_graph_response

    set_model_override(target["model"])
    try:
        # 直供 + 精修权威路径重建闭环证据（跳过旧产物匹配）
        from services.v5_llm_generate import set_refine_context

        set_refine_context(target["model"], f"回退到版本 {version_id}")
        # ⚠ 独立的证据命名空间，别跟首轮那次闭环撞 id（见
        #   _ensure_runtime_closure_evidence 里 _ns 那段注释）：撞了的话单调
        #   守卫判「没进展」，这一轮的 capabilityRuns 被整个退回，只剩豁免名单
        #   里的 publishClosure 活着——于是闭环的权威来源（按 runs 推导那份）
        #   仍然承载着刚被回退掉的那一版，下一轮精修就把回退撤销了。
        #   带上已有运行数，连点 ◀▶ 也不会撞在一起。
        _evidence_tag = (
            f"restore-{version_id}-{len(getattr(state, 'capabilityRuns', None) or [])}"
        )
        state = _ensure_runtime_closure_evidence(
            state, f"restore:{version_id}", 0, evidence_tag=_evidence_tag
        )
    finally:
        set_model_override(None)
        from services.v5_llm_generate import set_refine_context as _clear

        _clear(None)
    closure = derive_publish_closure_response(state)
    # D8 修复（2026-07-27 迭代体验审查）：重建可能静默空转（现有闭环任一段缺
    # modelSection 时 _ensure_runtime_closure_evidence 直接 return）或重建出
    # blocked——此前无论如何都移动指针并报 restored:true，UI 显示回到 v1、
    # 实际跑的还是 v3。诚实判定：重建后的闭环必须真的承载目标版本模型。
    from services.v5_full_driver import extract_model_from_closure

    restored_model = extract_model_from_closure(closure) if closure is not None else None

    def _core_sections(m):
        # 只比增强层不触碰的核心段——enrich 会合法地给老快照补
        # generatedTheme/freeformOverview（page/appbundle 因此可能有增量），
        # 逐字节比较会把正常回退误判成失败。
        return {k: (m or {}).get(k) for k in ("datamodel", "rbac", "workflow", "aigc")}

    if restored_model is None or _core_sections(restored_model) != _core_sections(target["model"]):
        # 指针不动，交付物也不动——上面刻意什么都没改，这里直接走人即可。
        return JSONResponse(
            status_code=409,
            content={
                "restored": False,
                "reason": "closure_rebuild_mismatch",
                "detail": "回退重建未生效（闭环未承载目标版本模型），指针未移动",
            },
        )
    # ── 判完了，这才提交交付物 ────────────────────────────────────────────
    from services.page_id_freeze import merge_page_id_aliases

    _target_pages = target.get("specFirstPages") or None
    _rebuilt = getattr(state, "specFirstPages", None)
    if _target_pages:
        state.specFirstPages = _target_pages
    elif (_rebuilt or {}).get("pages") == (_pages_before or {}).get("pages"):
        # 目标版本没带页（早于 _PAGES_KEPT_VERSIONS 的快照会被降级阶梯抹掉），
        # 重建也没自己画出新的 → 置空。右侧如实回落老区块渲染，而不是拿另一
        # 版的页面冒充这一版的。
        state.specFirstPages = None
    # 重建**自己画出了新页**时（_rebuilt 与回退前不同）保留它：那批页是在
    # set_model_override(target.model) 之下产出的，本来就是目标版本的页，
    # 抹掉它换一块空白才是说谎。

    # ⚠ 页面可以回退，**别名不许跟着回退**。别名是历史（"p1 曾经叫
    #   remote_rx_audit"），一旦被抹掉，交付 HTML 里按老 id 写死的菜单锚点
    #   当场点不动——照例一声不吭。
    #
    #   ⚠ 2026-08-29：这一刀最早只补在 rehearsal_control._tool_restore（控制面
    #   工具）里，而前端 ◀ 按钮走 POST /model-versions/{id}/restore 直接进这个
    #   函数——修了一半，另一半静默失效（CLAUDE.md 第四条）。合并因此坐在两条
    #   路**共用的这个核**里，不在任一条调用方。规则见 merge_page_id_aliases。
    _merged_aliases = merge_page_id_aliases(
        (_pages_before or {}).get("pageIdAliases"),
        (getattr(state, "specFirstPages", None) or {}).get("pageIdAliases"),
    )
    if _merged_aliases:
        # 没页也要把表接住：宁可留一份"只有别名、没有页"的 specFirstPages，
        # 也不能让老 id 失去落点。右侧看 pages 是否为空，不看这张表。
        _base = state.specFirstPages if isinstance(state.specFirstPages, dict) else {}
        state.specFirstPages = {**_base, "pageIdAliases": _merged_aliases}

    state.publishClosure = closure
    state.skillRuntimeGraph = derive_skill_runtime_graph_response(state)
    # 指针移动，不追加副本（经典 undo/redo；精修会从当前指针的模型出发）
    state.currentModelVersionId = version_id
    state = save_session(state)
    return {"restored": True, "state": state.model_dump()}
