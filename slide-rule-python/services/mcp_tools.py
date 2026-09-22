"""MCP 式工具注册表（P2a，2026-07-16）——能力池 MCP 化第一步。

用户裁决的 P2 切法：P2a 只读工具先行（真搜索第一个，免沙盒，证据质量
立竿见影）→ P2b 执行类工具进 E2B 沙盒。本模块是两步共用的地基：

- 工具描述符与 MCP（Model Context Protocol）对齐：name / description /
  inputSchema / readOnly / handler——P2b 的外部 MCP 服务器工具与沙盒
  执行工具接同一注册表，调用面（executor / agentic pick）不再变。
- 信任层海关（本仓独有约束）：工具产物只能作为带 provenance 溯源的
  证据进入系统（retrieval 字段如实标注来源），写结论的权力仍在门手里
  ——工具被骗/抓回脏数据，覆盖门与结构门照拦。

首个工具 web.search（真外网搜索证据源），供应商链按可用凭据自动选择：
  TAVILY_API_KEY → SERPER_API_KEY → Wikipedia 开放 API（免 key 兜底，
  zh 优先 en 补充）。全链不可用返回 None——调用方回落本地 RAG 并保留
  keyword 检索标注（诚实降级，不冒充外部证据）。
停用开关：SLIDERULE_WEB_SEARCH=off。
"""

from __future__ import annotations

import os
import re
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Callable, Iterator, Optional

# Wikipedia 机器人政策要求 UA 携带联系方式（缺了直接 403 "respect our
# robot policy"，实测）——URL + 邮箱齐备
_UA = "SlideRuleEvidenceBot/1.0 (https://sliderule.ai; contact: bot@sliderule.ai) httpx"
_TIMEOUT_S = 12.0
_TAG_RE = re.compile(r"<[^>]+>")


#: 本次请求内临时停用外网检索（见 suppress_web_search）。
#: ContextVar 而不是全局：并发请求各判各的，一个 fork 不能把别人的推演也关掉。
_web_search_suppressed: ContextVar[bool] = ContextVar(
    "sliderule_web_search_suppressed", default=False
)


@contextmanager
def suppress_web_search() -> Iterator[None]:
    """在这段代码里不打外网检索——**给"重建"用，不给"推演"用**。

    ## 为什么需要它

    2026-08-06 剖析 fork（复刻应用）为什么慢，结果很干脆：

        _ensure_runtime_closure_evidence   11027 ms   ← 占 fork 总耗时 99.3%
          └ execute_v5_capability
              └ rag_service.retrieve_evidence
                  └ mcp_tools.web_search
                      └ _search_wikipedia → _wiki_api ×14   9910 ms

    一次 fork 打了 **14 次 Wikipedia 请求**，9.9 秒。而 fork 复制的是一份
    **已经推演完的模型**——它要的只是把闭环证据重新落一遍好让副本能回放，
    根本不需要重新去外网找证据。更难堪的是那些证据本身没用：实测抓回来的是
    「PC」「PCI Express」「网页颜色」这类词条。

    路由那条注释写着"零 LLM"——是真的没调 LLM，但没人数过网络请求。

    ## 为什么不是把 SLIDERULE_WEB_SEARCH 关掉

    那是全局开关，关了连正常推演的外部证据也一起没了。这里要的是
    "**这一次调用**不查外网"，天然是请求域的东西。

    ## 降级是诚实的

    web_search 返回 None 时 retrieve_evidence 回落本地 RAG，并把 retrieval
    字段如实标成 keyword/vector，不会冒充外部证据。所以这里少的是耗时，
    不是把假证据填进去。
    """
    token = _web_search_suppressed.set(True)
    try:
        yield
    finally:
        _web_search_suppressed.reset(token)


def web_search_enabled() -> bool:
    if _web_search_suppressed.get():
        return False
    return str(os.getenv("SLIDERULE_WEB_SEARCH", "on")).strip().lower() not in (
        "off",
        "0",
        "false",
    )


def _clean(text: str) -> str:
    return _TAG_RE.sub("", text or "").replace("&quot;", '"').replace("&amp;", "&").strip()


# ── 供应商实现（每家：query → list[evidence dict] | None）────────────────
# 证据 dict 形状与 rag_service 检索结果同构（content/source/score/id/
# retrieval），下游 report/evidence 汇编零改动。


def _search_tavily(query: str, top_k: int) -> Optional[list[dict[str, Any]]]:
    key = (os.getenv("TAVILY_API_KEY") or "").strip()
    if not key:
        return None
    import httpx

    r = httpx.post(
        "https://api.tavily.com/search",
        json={"api_key": key, "query": query, "max_results": top_k},
        headers={"User-Agent": _UA},
        timeout=_TIMEOUT_S,
    )
    r.raise_for_status()
    results = (r.json() or {}).get("results") or []
    return [
        {
            "content": _clean(item.get("content") or "")[:400],
            "source": item.get("url") or "tavily",
            "title": item.get("title") or "",
            "score": round(float(item.get("score") or 0.5), 2),
            "id": f"web-tavily-{i}",
            "retrieval": "web:tavily",
        }
        for i, item in enumerate(results[:top_k])
    ] or None


def _search_serper(query: str, top_k: int) -> Optional[list[dict[str, Any]]]:
    key = (os.getenv("SERPER_API_KEY") or "").strip()
    if not key:
        return None
    import httpx

    r = httpx.post(
        "https://google.serper.dev/search",
        json={"q": query, "num": top_k},
        headers={"X-API-KEY": key, "User-Agent": _UA},
        timeout=_TIMEOUT_S,
    )
    r.raise_for_status()
    organic = (r.json() or {}).get("organic") or []
    return [
        {
            "content": _clean(item.get("snippet") or "")[:400],
            "source": item.get("link") or "serper",
            "title": item.get("title") or "",
            "score": 0.7,
            "id": f"web-serper-{i}",
            "retrieval": "web:serper",
        }
        for i, item in enumerate(organic[:top_k])
    ] or None


def _wiki_api(lang: str, params: dict[str, Any]) -> dict[str, Any]:
    import httpx

    r = httpx.get(
        f"https://{lang}.wikipedia.org/w/api.php",
        params={**params, "format": "json"},
        headers={"User-Agent": _UA},
        timeout=_TIMEOUT_S,
    )
    r.raise_for_status()
    return r.json() or {}


def _title_matches_term(term: str, title: str) -> bool:
    """命中的条目，是不是**真的就是**我要找的那个概念。

    ## 这道闸治的是什么：搜"黑灰产"，搜回来一只蝴蝶

    2026-08-09 线上一趟真跑（黑灰产情报自动化分析系统，22 分 52 秒），三次收口
    喂进模型的"外部证据"是同一条：

        [web-wiki-zh-黑灰蝶] 黑灰蝶（學名：Niphanda fusca）……一種寄生性蝴蝶

    复现是确定的，直接问维基：

        opensearch("黑灰产") → ['黑灰蝶', '黑灰蝶屬', '黑灰蚁鵙']

    `opensearch` 是**搜索框自动补全**接口（OpenSearch suggestions 规范），按
    标题**前缀**匹配。"黑灰产"和"黑灰蝶"共享前两个字，于是补全给了蝴蝶。
    而这一层**命中即采纳**，没有任何校验，蝴蝶就这么进了三轮建模的上下文。

    ## 为什么不是换成全文检索

    上一版这里的注释写着刻意不用 `srsearch`，理由是"实测宠物医院预约问诊头名是
    电视剧条目"。我复核了一遍，一字不差地复现：

        list=search("宠物医院预约问诊")   → ['關於唐醫生的一切', …]   ← 电视剧
        list=search("黑灰产情报自动化分析系统") → ['咒術迴戰角色列表', …]

    所以那个否决是对的，换接口只会换一种噪声。**缺的从来不是接口，是校验。**

    ## 为什么不是算词面相似度

    试过：拿目标串与条目标题/正文做 CJK bigram 重合（Lucene `CJKBigramFilter`
    那套——CJK 无可靠分词，成熟做法就是按字二元组索引）。实测这条不成立：

        目标「黑灰产情报自动化分析系统」对
          黑灰蝶    正文重合 0.008   ← 该拒，拒了 ✓
          猫池      正文重合 0.000   ← 真·黑灰产黑话，也被拒 ✗
          電信詐騙   正文重合 0.000   ← 同上 ✗

    中文同义词**不共字**（还叠着简繁差异），词面相似度会把真命中一起毙掉。

    ## 判据：恢复这一层原本以为自己有的语义

    `opensearch` 被当成"概念定位"用（原注释：「剧本杀」直中条目），那就把这个
    假设**验一遍**——返回的标题要么包含我问的词，要么被我问的词包含：

        黑灰产  → 黑灰蝶 / 黑灰蝶屬 / 黑灰蚁鵙   全部拒 ✓
        剧本杀  → 剧本杀 ✓ 剧本 ✓ 剧本统筹 ✗
        情报分析 → 情报分析 ✓ 情報分析管理 ✗ 情景分析 ✗
        宠物医  → 宠物 ✓（标题被词包含）宠物店男孩 ✗ 宠物狗寄宿 ✗

    双向包含缺一不可：只留"标题含词"会毙掉「宠物医→宠物」这种正确的泛化。
    """
    t = (term or "").strip().lower()
    ti = (title or "").strip().lower()
    if not t or not ti:
        return False
    return t in ti or ti in t


def _wiki_titles(lang: str, term: str, limit: int) -> list[str]:
    """概念定位：只认 opensearch 标题检索（"剧本杀"直中条目）。刻意不做
    全文搜索兜底——srsearch 排序噪声大（实测"宠物医院预约问诊"头名是
    电视剧条目），精准优先、宁缺勿噪，缺口由本地基线补位。

    2026-08-09 加相关性闸：opensearch 是前缀补全，"黑灰产"会补出"黑灰蝶"。
    判据与实测见 `_title_matches_term`。被拒的打日志——静默丢弃会让"没有外部
    证据"和"检索坏了"长得一模一样。
    """
    data = _wiki_api(lang, {"action": "opensearch", "search": term, "limit": limit})
    titles = [t for t in (data[1] if isinstance(data, list) and len(data) > 1 else []) if t]
    kept = [t for t in titles if _title_matches_term(term, t)]
    dropped = [t for t in titles if t not in kept]
    if dropped:
        print(
            f"[mcp_tools] 维基相关性闸拦下 {len(dropped)} 条"
            f"（词='{term}' lang={lang}）：{'、'.join(dropped[:3])}"
        )
    return kept[:limit]


def _wiki_extracts(lang: str, titles: list[str]) -> list[dict[str, Any]]:
    """条目导语作证据正文（比全文搜索的碎片摘要质量高一个档）。"""
    if not titles:
        return []
    data = _wiki_api(
        lang,
        {
            "action": "query",
            "prop": "extracts",
            "exintro": 1,
            "explaintext": 1,
            "titles": "|".join(titles[:6]),
        },
    )
    pages = ((data.get("query") or {}).get("pages") or {}).values()
    out = []
    for page in pages:
        title = str(page.get("title") or "")
        extract = _clean(str(page.get("extract") or ""))[:420]
        if title and extract:
            out.append(
                {
                    "content": extract,
                    "source": f"https://{lang}.wikipedia.org/wiki/{title.replace(' ', '_')}",
                    "title": title,
                    "score": 0.75,
                    "id": f"web-wiki-{lang}-{title[:16]}",
                    "retrieval": f"web:wikipedia:{lang}",
                }
            )
    return out


# 查询蒸馏：话题名是营销句（"XX管理与YY助手 Pro"），直接全文搜噪声大。
# 确定性拆分：连接词切段 + 剥通用后缀，每段独立检索再合并（实测
# "宠物医院预约问诊系统" 整句会命中疫情条目，蒸馏成 "宠物医院" 就正了）
_SPLIT_RE = re.compile(r"[——\-·，,、\s]+|与|和|及")
_GENERIC_RE = re.compile(
    r"(管理系统|管理平台|智能|系统|平台|助手|工具|中台|方案|服务|Pro|pro|App|app)+$"
)


def _distill_queries(query: str) -> list[str]:
    """段落 → 递减前缀候选（CJK 粗分词）：宠物医院预约问诊 →
    [宠物医院预约问诊?, 宠物医院, 宠物医, 宠物]——配合 opensearch
    只认命中，等效"从具体到一般"逐级找存在的百科概念。"""
    out: list[str] = []
    for seg in _SPLIT_RE.split(query):
        seg = _GENERIC_RE.sub("", seg.strip())
        if len(seg) < 2:
            continue
        candidates = [seg] if len(seg) <= 8 else []
        # 递减到 3 字为止，**不再降到 2 字**（2026-08-09）。
        #
        # 2 字前缀过不了相关性闸这一关——它太泛，几乎什么都"包含"它：
        #     opensearch("黑灰") → 黑灰蝶 ✓ 黑灰蝶屬 ✓ 黑灰蚁鵙 ✓   ← 闸全放行
        #     opensearch("宠物") → 宠物 ✓ 宠物店男孩 ✓ 宠物狗寄宿 ✓
        # 也就是说留着这一级，等于给"黑灰产→蝴蝶"留了条后门：3 字那级被闸拦下，
        # 退到 2 字又原样放进来。
        #
        # 代价是极短话题（"外卖""社群"）少一次兜底检索。可接受：那一级本来
        # 召回的就是泛概念条目，对生成没什么用，而它带进来的跨领域噪声是实打
        # 实进了模型上下文的。宁缺勿噪，与本模块既有口径一致。
        for n in (4, 3):
            if len(seg) > n:
                candidates.append(seg[:n])
        for c in candidates:
            if c not in out:
                out.append(c)
    return out[:8] or [query]


def _search_wikipedia(query: str, top_k: int) -> Optional[list[dict[str, Any]]]:
    """免 key 兜底：蒸馏词逐个「opensearch 定位条目 → extracts 取导语」，
    zh 优先（无果补 en），合并去重。"""
    results: list[dict[str, Any]] = []
    seen_sources: set[str] = set()
    for term in _distill_queries(query):
        if len(results) >= top_k:
            break
        for lang in ("zh", "en"):
            got_for_term = 0
            try:
                for item in _wiki_extracts(lang, _wiki_titles(lang, term, 2)):
                    if item["source"] not in seen_sources:
                        seen_sources.add(item["source"])
                        results.append(item)
                        got_for_term += 1
                        if len(results) >= top_k:
                            break
            except Exception:
                continue
            if got_for_term:
                break  # 该词 zh 已命中就不查 en（中文话题优先中文源）
    return results[:top_k] or None


_PROVIDERS: tuple[tuple[str, Callable[[str, int], Optional[list[dict[str, Any]]]]], ...] = (
    ("tavily", _search_tavily),
    ("serper", _search_serper),
    ("wikipedia", _search_wikipedia),
)


def web_search(query: str, top_k: int = 6) -> Optional[list[dict[str, Any]]]:
    """web.search 工具入口：按供应商链取第一个有产出的。失败/停用 → None
    （调用方回落本地 RAG——诚实降级，检索方式永远如实标注）。"""
    if not web_search_enabled():
        return None
    query = (query or "").strip()
    if not query:
        return None
    for _name, provider in _PROVIDERS:
        try:
            results = provider(query, top_k)
            if results:
                return results
        except Exception:
            continue
    return None


# ── code.run：执行类工具（P2b，readOnly=False → 必须进 E2B 沙盒）──────
# 信任层海关对执行类的加码：宿主零执行——代码只在一次性云沙盒里跑，
# 跑完即销毁；产物 provenance=sandbox:e2b 如实标注，门照常裁决。
# fail-closed：E2B_API_KEY 缺失/开关关闭 → 工具不可用（返回 None），
# 绝不回落到宿主 exec 之类的"方便通道"。

_CODE_RUN_TIMEOUT_S = 60


def code_run_enabled() -> bool:
    if str(os.getenv("SLIDERULE_CODE_RUN", "on")).strip().lower() in ("off", "0", "false"):
        return False
    return bool((os.getenv("E2B_API_KEY") or "").strip())


def _e2b_sandbox(timeout_s: int) -> Any:
    """沙盒创建单独成函数：测试 monkeypatch 这里，SDK 惰性 import
    （web.search-only 部署不需要装 e2b）。"""
    from e2b_code_interpreter import Sandbox  # type: ignore[import-not-found]

    return Sandbox.create(timeout=timeout_s + 30)


def code_run(code: str, timeout_s: int = _CODE_RUN_TIMEOUT_S) -> Optional[dict[str, Any]]:
    """在一次性 E2B 沙盒执行 Python 代码，返回带溯源的执行记录。

    返回 dict：ok / stdout / stderr / result / error / sandboxId /
    provenance="sandbox:e2b"。不可用（无 key、停用、空代码）→ None。
    沙盒创建后无论执行成败都 kill（finally），不留悬挂沙盒计费。
    """
    if not code_run_enabled():
        return None
    code = (code or "").strip()
    if not code:
        return None
    sandbox = _e2b_sandbox(timeout_s)
    try:
        execution = sandbox.run_code(code, timeout=timeout_s)
        logs = getattr(execution, "logs", None)
        stdout = "".join(getattr(logs, "stdout", None) or [])
        stderr = "".join(getattr(logs, "stderr", None) or [])
        error = getattr(execution, "error", None)
        return {
            "ok": error is None,
            "stdout": stdout[:4000],
            "stderr": stderr[:2000],
            "result": str(getattr(execution, "text", None) or "")[:2000],
            "error": f"{error.name}: {error.value}"[:500] if error else None,
            "sandboxId": str(getattr(sandbox, "sandbox_id", "") or ""),
            "provenance": "sandbox:e2b",
            "retrieval": "sandbox:e2b",
        }
    finally:
        try:
            sandbox.kill()
        except Exception:
            pass  # 回收失败不挡产物返回（E2B 侧 timeout 兜底销毁）


# ── MCP 兼容注册表（P2b 的外部 MCP 服务器与沙盒执行工具接到这里）──────

MCP_TOOLS: dict[str, dict[str, Any]] = {
    "web.search": {
        "name": "web.search",
        "description": "真外网搜索取证据（只读）：返回带真实 URL 与溯源标注的检索结果",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "检索词"},
                "top_k": {"type": "integer", "default": 6},
            },
            "required": ["query"],
        },
        "readOnly": True,  # P2a 只读工具；P2b 执行类工具 readOnly=False 且必须走沙盒
        "handler": web_search,
    },
    "code.run": {
        "name": "code.run",
        "description": "在一次性 E2B 云沙盒执行 Python 代码做验证取证（执行类，宿主零执行，用完即毁）",
        "inputSchema": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "要执行的 Python 代码"},
                "timeout_s": {"type": "integer", "default": _CODE_RUN_TIMEOUT_S},
            },
            "required": ["code"],
        },
        "readOnly": False,
        "sandbox": "e2b",  # 执行类工具必须声明隔离面；无沙盒声明的执行工具不准注册
        "handler": code_run,
    },
}
