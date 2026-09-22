# -*- coding: utf-8 -*-
"""模型版本记账：记一版 / 找本轮可复用的那一版（2026-08-29 从驱动器抽出来）。

## 为什么单独成模块

`v5_capability_executor` 要用 `record_model_snapshot` 与 `reusable_model_for_turn`，
而这两个函数长在 `v5_full_driver` 里——驱动器顶层又 import 执行器
（`execute_v5_capability`）。于是最核心的那一对互相 import，是个真的循环依赖：

    services.v5_capability_executor -> services.v5_full_driver -> services.v5_capability_executor

两边只好把 import 藏进函数体绕开。仓里 463 条「藏在函数体里的 import」就是这么
攒出来的。

## 抄的是 grok 的叶子 crate（§17）

共用件切出来，依赖方向就定死：驱动器和执行器都向下依赖这个模块，
它谁都不依赖回去。这四样东西本来就是同一件事——**模型版本这本账**：

    _PAGES_KEPT_VERSIONS    这本账留几版的页
    goal_digest             复用键的一半（目标指纹）
    record_model_snapshot   记一版
    reusable_model_for_turn 找本轮可复用的那一版

## ⚠ 同名转出留在 v5_full_driver

四个名字在 `v5_full_driver` 上都保留了同名转出：仓里 10 个测试文件、
5 个 services 模块按 `from services.v5_full_driver import ...` 引用它们，
判据也钉在那个名字上（包括 `monkeypatch.setattr("services.v5_full_driver.
reusable_model_for_turn", ...)` 这种）。**搬家只该改依赖方向，不该把别人的
调用点和判据弄红。**
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from models.v5_state import V5SessionState


def goal_digest(state: "V5SessionState") -> str:
    """目标文本的确定性指纹，用作模型复用键的一半。"""
    import hashlib

    goal = getattr(state, "goal", None) or {}
    text = goal.get("text", "") if isinstance(goal, dict) else str(goal)
    return hashlib.sha256(str(text).strip().encode("utf-8")).hexdigest()[:16]
def reusable_model_for_turn(state: "V5SessionState") -> "Optional[Dict[str, Any]]":
    """本轮已经生成过、可以直接复用的五系统模型；没有就 None。

    ## 解决什么

    2026-08-04 真跑：模型自己在多个 loop 里选了收口，`MAX_REPEAT_PER_CAP=2`
    放行两次。第二次收口时生成入口**没有复用通道**，从头再调一次 LLM 生成
    （13 万字），拿到一份全新模型。而链路上那三道幂等保护
    （page.freeformOverview 已存在就跳过、chartColors 已有就不重取、
    sheet_used 计数）检查的全是「model 内部字段」——新模型上这些都是空，
    保护形同虚设。于是生图 100s + 取色 12s + 设计 100s 整套重跑一遍，
    两张不同参照图取出两套不同配色，后写的覆盖先写的，第一遍 233 秒全废。

    **锁挂在门上，但每次来的是一扇新门。** 这里补的就是那把会话级的锁。

    modelVersions 存的是**增强之后**的模型（证据由 model_to_linkage_artifacts
    从增强后的 model 转出），所以复用它等于连生图/取色/设计一并省掉——那三道
    既有的幂等保护这次会自然生效，因为终于是同一份 model 了。

    ## 复用键怎么定的

    两个开源方案各贡献一半：

    - vercel/turborepo#4572：缓存最大的坑是**影响输出的输入没进键**，改了
      东西还吃旧结果。所以 goal 必须进键（goalDigest）。
    - Stripe 幂等键：同一个键配不同参数必须报错而不是静默返回旧结果。这里
      对应的就是 goalDigest 对不上时**宁可重算**，绝不返回。

    作用域刻意收窄到**单轮（turnId）**：跨轮复用会让「用户补充需求之后仍然
    拿到旧模型」，那正是 turborepo 那个坑在我们这儿的形态。一轮 = 一次用户
    输入到闭环，轮内 goal 不会变，是安全的。

    精修（refine）与版本回退（override）有各自的通道，调用方在走到这里之前
    就分流了，不会误用本函数。
    """
    versions = list(getattr(state, "modelVersions", None) or [])
    if not versions:
        return None
    last = versions[-1]
    if not isinstance(last, dict) or not isinstance(last.get("model"), dict):
        return None
    turn = str(getattr(state, "lastTurnId", "") or "")
    if not turn or str(last.get("turnId") or "") != turn:
        return None  # 不是本轮的产物，不复用
    if str(last.get("goalDigest") or "") != goal_digest(state):
        return None  # 目标变了（或旧快照没记指纹）——宁可重算
    return last["model"]


def latest_model_snapshot(state: "V5SessionState") -> "Optional[Dict[str, Any]]":
    """账上最新那一份五系统模型，**不问是哪一轮生成的**。

    ⚠ 这不是 `reusable_model_for_turn` 的放宽版，两者服务两件事，别合并：

    - `reusable_model_for_turn`：**生成侧**的省钱锁。它必须锁死单轮，否则
      「用户补充需求之后仍然拿到旧模型」（turborepo#4572 那个坑）。
    - 本函数：**判定侧**的读账。闭环判定的对象就是会话里已经存在的那份
      应用，它是哪一轮画出来的与判定无关——问「这份东西合不合格」时，
      拿本轮没生成过当作「什么都没有」是错的。

    真机（2026-09-04 连锁药店 sr-20260904172213）：pages/structure/bind 三跳
    在 turn-1/5/7 依次把六段模型记进 modelVersions，用户接着答「进行闭环判定」
    ——那是 turn-9，新的一轮。closure 单跳走 spec-first 沿用上一版，按设计
    **不产汇合模型**，`_try_llm_generate_evidence` 老老实实 `return {}`。
    于是判定侧一段证据都没有：库里躺着六段齐全的模型，判定说 0/6 blocked。
    今天 15 个会话里凡是走到闭环的**全是** 0/6，无一例外——一直被当成
    「生成没跑」在查，其实是判定跳读错了地方。

    只读队尾一版：`record_model_snapshot` 保证队尾是最新的。
    """
    versions = list(getattr(state, "modelVersions", None) or [])
    if not versions:
        return None
    last = versions[-1]
    if not isinstance(last, dict) or not isinstance(last.get("model"), dict):
        return None
    return last["model"]


#: 有几版带得起整页 HTML。实测单页 19~28KB、五页一版约 125KB，
#: 而模型版本上限是 20 版——全带就是 2.5MB 的会话 blob，每次存盘都要过一遍。
#:
#: ⚠ 3 → 1（2026-08-18 真机 413）：烘焙店会话本体已 605KB（capabilityRuns
#:   179KB + artifacts 130KB 的永续历史），第二份带页版本一追加就把落库
#:   请求顶过 /db-api 1MB 上限——日志曾写成 `neon http 413`，其实打的是
#:   miantuan.ai/db-api。此后**每一次**落盘全部失败：版本史、轮叙述、
#:   lastTurnId 改名全蒸发，库里停在轮初快照。
#:   只留队尾一版带页 = 回到出事前那晚验证过能落库的体积包络。
#:   代价：◀ 回退到上一版时页面如实降级（回落区块渲染）——比起"整轮
#:   产物全部丢失"，这是能接受的一头。持久层另有超限阶梯降级（见
#:   persistence._next_slim），两道闸独立成立。
_PAGES_KEPT_VERSIONS = 1
def record_model_snapshot(
    state: "V5SessionState", model: "Dict[str, Any]", instruction: str
) -> None:
    """直接拿一份模型记版本 —— 不要求它先变成一个完整闭环。

    ## 为什么要有这条不经过闭环的入口

    2026-08-09 线上真跑（黑灰产情报，22 分 52 秒）里，收口能力跑了**三遍**：

        loop-1  387.7s   loop-2  370.3s   loop-3  355.0s

    后两轮 725 秒（占全程 55%）产出的收口产物与第一轮**字节完全相同**
    （各 3089 字节）。而 `modelVersions` 从头到尾只有 1 条，`createdAt` 是
    18:38:31——最后一轮结束那一刻。也就是说前两轮生成的模型**一份都没留下**，
    每一轮都从零重新生成（172.6s / 208.7s / 165.8s）。

    成因是缓存点挂错了地方：`record_model_version` 从闭环里抽模型，而
    `extract_model_from_closure` 要求 perSkillEvidence 六段齐全，缺一段就返回
    None。轮次没走到完整闭环 → 什么都不记 → 下一轮 `reusable_model_for_turn`
    读到空 → 全价重来。

    **最贵的产物（模型），只在最便宜的条件（闭环齐全）满足时才进缓存。**
    那把锁在最需要它的场景里恰好用不上。

    ## 记的必须是"增强之后"的模型

    `_reuse_this_turn_model` 命中时省掉的是一整套：模型生成 + 二段区块生成
    （freeform.total）+ 首页设计（monitor.total）。能省掉后两样，前提是缓存里
    那份**已经**含 freeformOverview / chartColors。所以调用点定在
    `_try_llm_generate_evidence` 增强完、`model_to_linkage_artifacts` 之后，
    与闭环那条路存进去的是同一份东西。
    """
    if not isinstance(model, dict) or not model:
        return
    # ★ 回退/前进期间一律不记快照（2026-08-16 线上实测）。
    #
    # 版本切换是**指针移动**，不是新产出——restore 路由自己的注释就写着
    # 「指针移动，不追加副本（经典 undo/redo）」。但重建闭环会走到生成层，
    # 生成层把直供回来的历史模型当成"刚产出的模型"记一版，在路由背后把
    # 那条纪律破坏掉。
    #
    # 真机证据（sr-20260816114340）：两轮推演只产出 2 份不同的模型，用户
    # 来回点了几下 ◀▶ 之后 modelVersions 变成 9 条——按 A B A B A B A 交替，
    # 间隔约 10 秒，全部挂在同一个 turn-4-drive-full 上。用户看到的就是
    # 「每点一次数字加 1」。
    #
    # 为什么下面那个去重挡不住：它**只跟队尾比**。回退到 A 时队尾是 B →
    # 不相等 → 追加 A；再切到 B 时队尾成了 A → 又追加 B。来回点就是无限增长。
    # （也正因如此，恰好回退到与队尾同模型的那一版时不会涨——排查时一度
    #  以为复现不了，就是踩在这个巧合上。）
    #
    # 把去重改成"跟所有历史版本比"也能压住条数，但那是治标：它默认了
    # "回退时记一版是对的，只是别记重复的"。不对——**回退时一版都不该记**。
    # override 在场 = 正在直供一份已经存在于历史里的快照，按定义没有新东西。
    from .v5_llm_generate import get_model_override

    if get_model_override() is not None:
        return
    versions = list(getattr(state, "modelVersions", None) or [])
    # ★ "变没变"必须连页面一起比（2026-08-18 烘焙店真机）。
    #
    # 局部精修的常态是：六段 model 字节不变（rbac/workflow/aigc 全沿用、
    # 实体角色没动），**只有页面 HTML 变了**（加一列「临期预警」）。下面那个
    # `last == model` 只看模型 → 判成"没变"直接跳过 → 三连锁反应：
    #   ① 版本不涨，预览停在旧页（用户看到"过程卡在动、右边纹丝不动"）；
    #   ② 队尾 turnId 还是上一轮 → reusable_model_for_turn 的同轮锁合不上；
    #   ③ 外圈第二次收口拿不到复用 → 全价重跑 spec-first，撞 525 后回落
    #      GEN5 整份重画，把第一遍"只重画 1 页"的产物冲掉。
    #
    # turborepo#4572 的同一个坑：**影响输出的输入没进比较键**，改了东西
    # 还吃旧结果。页面就是那个漏掉的输入。
    #
    # 本轮页面从请求域暂存 peek（不 take——take 会把之后
    # _cache_spec_first_pages 的会话落库饿死，见 peek_last_pages 头注）。
    # peek 为空 = 本轮没跑成 spec-first（回落老链路/纯模型轮），此时页面
    # 维度不参与判定，行为与旧版完全一致。
    fresh_pages = None
    try:
        from .spec_first_pipeline import peek_last_pages

        _got = peek_last_pages()
        if isinstance(_got, dict) and (_got.get("pages") or {}):
            fresh_pages = _got
    except Exception:
        fresh_pages = None  # 顺路读暂存；读不到不改变主判定（fail-open）
    if versions:
        tail0 = versions[-1] if isinstance(versions[-1], dict) else {}
        if tail0.get("model") == model:
            if fresh_pages is None or tail0.get("specFirstPages") == fresh_pages:
                # 模型、页面都没变：不记新版本，指针对齐（可能刚从回退态回来）
                print(
                    "[record_model_snapshot] 模型与页面都没变，不记新版本"
                    f"（本轮页面暂存：{'有' if fresh_pages is not None else '无'}）"
                )
                state.currentModelVersionId = tail0.get("id")
                return
            print("[record_model_snapshot] 模型没变但页面变了，照常记版本")
    # ★ 同一轮的第二份模型 → **替换队尾，不追加**（2026-08-18 步伴真机）。
    #
    # 真机形状：精修第一遍 p2 被网关 525 打掉（3/4 页残次交付），外圈第二遍
    # 补全重跑——同一个 turnId 下产出两份**不同**的模型，上面的"跟队尾比"
    # 挡不住，mv-2/mv-3 同挂 turn-1786997607853 进了版本史。
    #
    # 前端刷新回放按「一轮 = 一个气泡」从版本史铺消息，两条同轮版本 = 两个
    # 同 id 气泡，assistant-ui 的 MessageRepository 对重复 id 直接抛错，
    # **整页白屏**（上游口径同此：外部存储的消息 id 必须唯一，见
    # assistant-ui#2380/#4037——官方适配器都在同步前做 id 对账）。
    #
    # 轮内中间态对 ◀▶ 回退也没有价值：那是一份缺页的残次品，回退到它
    # 等于把 525 事故重新端给用户。同轮的最终产物才是这一轮的版本。
    turn_id = str(getattr(state, "lastTurnId", "") or "")
    if (
        turn_id
        and versions
        and isinstance(versions[-1], dict)
        and str(versions[-1].get("turnId") or "") == turn_id
    ):
        tail = dict(versions[-1])
        tail["model"] = model
        tail["instruction"] = str(instruction or "")[:300]
        tail["createdAt"] = datetime.now(timezone.utc).isoformat()
        # 页面优先取本轮暂存（此调用点在 _cache_spec_first_pages **之前**，
        # state.specFirstPages 还是上一轮的旧页——直接存它就是"新模型配旧页"）
        tail["specFirstPages"] = fresh_pages or getattr(state, "specFirstPages", None)
        versions[-1] = tail
        state.modelVersions = versions
        state.currentModelVersionId = tail.get("id")
        print(f"[record_model_snapshot] 同轮替换队尾 {tail.get('id')}（turn={turn_id[:40]}）")
        return
    # ID 必须单调递增、与截断解耦——旧实现 len(versions)+1 配合下面的 [-20:]
    # 截断,从第 22 版起恒生成 "mv-21":restore/findIndex 命中第一个同名旧
    # 快照,◀▶ 错乱(审查实锤)。取"历史最大序号+1",截断也不回卷。
    max_seq = 0
    for v in versions:
        vid = str(v.get("id") or "") if isinstance(v, dict) else ""
        if vid.startswith("mv-"):
            try:
                max_seq = max(max_seq, int(vid[3:]))
            except ValueError:
                pass
    new_id = f"mv-{max_seq + 1}"
    versions.append({
        "id": new_id,
        "turnId": str(getattr(state, "lastTurnId", "") or ""),
        "instruction": str(instruction or "")[:300],
        "createdAt": datetime.now(timezone.utc).isoformat(),
        # 复用键的一半（另一半是 turnId）。教训取自 vercel/turborepo#4572
        # 「cache doesn't invalidate on change in dependent code」——缓存最大
        # 的坑不是没命中，是**影响输出的输入没进键**，于是改了东西还吃旧结果。
        # 模型是照着 goal 生成的，goal 就必须进键；对不上宁可重算。
        "goalDigest": goal_digest(state),
        "model": model,
        # spec-first 画出来的整页（2026-08-14）。不带的话回退是**说谎**：
        # 指针回到 v1，右侧还是 v3 的页面——正是这段代码上面那条 D8 修复
        # （"UI 显示回到 v1、实际跑的还是 v3"）在模型上治过的同一个病。
        # 取本轮暂存优先，理由同上面的同轮替换分支。
        "specFirstPages": fresh_pages or getattr(state, "specFirstPages", None),
    })
    versions = versions[-20:]  # 上限 20 版，防状态无限膨胀
    # ⚠ 页面很重：实测单页 19~28KB，五页一版约 125KB。20 版全带 = 2.5MB，
    #   而这是**每次存盘都要过一遍**的会话 blob。所以只有最近几版带页面，
    #   更早的版本把这个键抹掉。
    #
    #   抹掉之后回退到那些版本会**如实没有页面**（右侧回落老区块渲染），
    #   而不是拿别的版本的页面凑一个——「东西看着在，其实是旧的」是这仓
    #   数得最多的形状，这里宁可少给也不给错的。
    for stale in versions[:-_PAGES_KEPT_VERSIONS]:
        if isinstance(stale, dict):
            stale["specFirstPages"] = None
    state.modelVersions = versions
    state.currentModelVersionId = new_id
    # 写入侧四个出口原本只有追加不出声（2026-08-18 排查代价一整晚）——补上。
    print(
        f"[record_model_snapshot] 追加版本 {new_id}"
        f"（turn={str(getattr(state, 'lastTurnId', '') or '')[:40]}，"
        f"页面：{'本轮暂存' if fresh_pages else ('沿用state' if getattr(state, 'specFirstPages', None) else '无')}）"
    )
