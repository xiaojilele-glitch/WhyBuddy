"""画页用的库存图：搜到真 URL 就直挂 <img src>，不下载。

2026-08-19 用户裁决：「直接接地址，就不用下载了」。

⚠ 不能让模型自己编 unsplash / pexels 的 photo id——编出来几乎全是 404。
  真机（团购那轮）页面上只有 placehold.co 色块，看起来像「网络找图没生效」。
  原因不是网断：第 3 步提示词写死了关图，外链闸只放行 placehold.co，
  Unsplash 一写进 HTML 整页校验失败（refine_page_scope 头注那次同型）。

做法：画页仍写 placehold.co；落地后按 alt 搜，把**返回里的 URL**直挂进
<img src>。闸只放行这几家图床，页脚仍不许乱挂域名。

搜不到 / 超时 fail-open 回 placehold.co，不拖画页。

⚠ 2026-08-20 真机（满电青年 / 电动车综合服务）：卡片上出现枇杷和
「Battery Error」图。词表当时只有团购生鲜，对不上就回落
`fresh groceries produce`，Openverse 给水果，提示词又写「商品缩略图
优先用上面的地址」——模型照抄，话题对不上也塞进去。
错图比没图更糟：对不上词表就按话题自己的短语搜，绝不回落生鲜。

⚠ 同日第二趟：查询改成充电桩之后，预览卡上仍是番茄 / 彩椒。
规格 purpose 写了「外卖骑手」（用户分层，不是画面主体），词表
`外卖 → food delivery takeaway` 仍进前三条。Openverse 的 q 是
词或匹配，`food` 一条就把生鲜照片抬到最前，模型再照抄进卡片。
车辆族命中时丢掉食物查询；命中标题/标签是生鲜的结果也不注入。

⚠ 同日第三趟：词表挡了「外卖」查询，预览仍可能是番茄。根因是把一袋
URL 注进画页提示词——模型四处粘贴，卡片 alt 是充电桩、src 却是袋里
排第一的生鲜图。

成熟开源不这么干：
  · abi/screenshot-to-code：画页只用 placehold.co，alt 是这张图的描述；
    页面落地后再按 alt 换 src（老版 generate_images；现行 disabled 政策
    同款占位）。
  · kiluazen/tteg：一图一条检索词（batch manifest），不是全局袋子。
    托管 API 有日限额、要他们的 Unsplash key，逻辑抄、服务不接。
  · WordPress/openverse：2026-08 的检索口。2026-08-31 真机（团子的一天 /
    会易订）几乎全 ReadTimeout，偶发命中还是 live.staticflickr.com。
    同日探过：Openverse 源列表里已经没有 unsplash，source=unsplash 直接 400。

⚠ 2026-08-31 用户裁决：换成 Unsplash（给的样例
  https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80
  本机 HEAD 200 / 613ms）。新注入只挂 images.unsplash.com。
  Flickr / Pexels / Wiki / Rawpixel 仍在 STOCK_IMAGE_HOSTS——旧页精修
  不能被判未授权外链——但自动换图和画布「换图」不再往这几家写。
  检索：有 UNSPLASH_ACCESS_KEY 走官方 Search；没 key / 搜空 / 挂了，
  退到下面那份 HEAD 过的直链目录（整词命中才用，对不上留占位图）。
  模型仍然不许自己编 photo id。

所以：提示词不再塞 URL；画完后按每张 <img alt> 搜 Unsplash 直挂地址。
"""

from __future__ import annotations

import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from html import unescape
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlparse

_UNSPLASH_SEARCH = "https://api.unsplash.com/search/photos"
_UA = "SlideRule/stock-images (URL lookup only; no download)"
_TIMEOUT_S = 3.0
_MAX_QUERIES = 3
_MAX_HITS = 6
_MAX_FILL_QUERIES = 8

#: 自动换图一页的墙钟预算。搜图是**增强**，超了就把剩下的留成占位图，
#: 绝不把画页拖成"等图"——这条链路 fail-open 的全部意义就在这里。
#: 12s 是按实测定的：一页最多 8 格、4 并发、单格中位 2.1s，正常在 5s 内跑完，
#: 12s 只在网络异常时才咬得到。
_FILL_BUDGET_S = 12.0

#: 同时打图库的请求数。实测 4 并发 8 条查询 5.0s → 2.2s，且没被限流。
#: 再往上收益递减（单条延迟本身有抖动），而且对免 key 的公共接口不礼貌。
_FILL_WORKERS = 4

# 闸与提示词共用。不在这里的主机，搜到了也不注入——否则模型抄了仍会被拦。
# ⚠ 这是「页面上已经挂了也能过精修」的名单，不是「新搜到的往哪写」。
STOCK_IMAGE_HOSTS = (
    "images.unsplash.com",
    "images.pexels.com",
    "upload.wikimedia.org",
    "staticflickr.com",
    "rawpixel.com",
)

#: 2026-08-31 起新注入只写 Unsplash。用户给的 CDN 比 Flickr 稳。
FILL_IMAGE_HOSTS = ("images.unsplash.com",)

_OK_LICENSE = frozenset({"cc0", "pdm", "unsplash"})

# Unsplash Search 的 orientation。跟 Openverse 那套 wide/tall/square 对齐。
_UNSPLASH_ORIENT = {
    "wide": "landscape",
    "tall": "portrait",
    "square": "squarish",
}

#: 真 Unsplash id 是 photo-{数字}-{hex}。测试里的 photo-charger 这种假 id
#: 不要改写，否则断言 URL 字面的闸会莫名其妙红。
_UNSPLASH_PHOTO_RE = re.compile(
    r"https://images\.unsplash\.com/(photo-\d+-[0-9A-Za-z]+)",
    re.I,
)

# 没 key 时的退路。每条都是 2026-08-31 对
# `https://images.unsplash.com/{id}?auto=format&fit=crop&w=80&q=40` HEAD 200。
# 只整词命中；对不上就空——错图比没图更糟，不许拿林间图硬塞进星盘页。
_UNSPLASH_CATALOG: tuple[tuple[tuple[str, ...], str], ...] = (
    (("charging", "charger", "ev"), "photo-1593941707882-a5bba14938c7"),
    (("scooter", "motorcycle", "bicycle", "bike"), "photo-1571068316344-75bc76f77890"),
    (("warehouse", "logistics", "cargo"), "photo-1586528116311-ad8dd3c8310d"),
    (("hospital", "clinic", "medical"), "photo-1519494026892-80bbd2d6fd0d"),
    (("pharmacy", "medicine", "pills"), "photo-1584308666744-24d5c474f2ae"),
    (("auditorium", "stage", "concert"), "photo-1516450360452-9312f5e86fc7"),
    (("meeting", "conference", "boardroom"), "photo-1517245386807-bb43f82c33c4"),
    (("office", "workplace", "coworking"), "photo-1497366216548-37526070297c"),
    (("laptop", "keyboard"), "photo-1486312338219-ce68d2c6f44d"),
    (("team", "collaboration", "creator", "filming"), "photo-1516321318423-f06f85e504b3"),
    (("camera", "photography"), "photo-1516035069371-29a1b244cc32"),
    (("kitchen",), "photo-1556909114-f6e7ad7d3136"),
    (("bedroom",), "photo-1522771739844-6a9f6d5f14af"),
    (("restaurant", "dining"), "photo-1414235077428-338989a2e8c0"),
    (("coffee", "cafe", "latte"), "photo-1495474472287-4d71bcdd2085"),
    (("bakery", "bread"), "photo-1509440159596-0249088772ff"),
    (("apple", "apples"), "photo-1560806887-1e4cd0b6cbd6"),
    (
        ("vegetable", "vegetables", "produce", "groceries"),
        "photo-1488459716781-31db52582fe9",
    ),
    (("fruit", "tomato"), "photo-1488459716781-31db52582fe9"),
    (("cat", "tabby"), "photo-1514888286974-6c03e2ca1dba"),
    (("dog",), "photo-1552053831-71594a27632d"),
    (("library",), "photo-1524995997946-a1c2e315a42f"),
    (("book", "manuscript"), "photo-1512820790803-83ca734da794"),
    (
        ("forest", "woods", "trail", "mist", "mountain"),
        "photo-1500530855697-b586d89ba3ee",
    ),
    (("ocean", "beach", "sea", "wave"), "photo-1507525428034-b723cf961d3e"),
    (("city", "skyline", "street"), "photo-1449824913935-59a10b8d2000"),
    (("portrait", "avatar"), "photo-1438761681033-6461ffad8d80"),
    (("desk",), "photo-1497215728101-856f4ea42174"),
)

# 中文意图 → Openverse 英语查询。只做桥，答案仍是搜到的 URL。
# 长词优先（充电桩 盖住 充电；红富士 盖住 苹果），见 _queries。
_ZH_HINTS = (
    ("充电桩", "ev charging station"),
    ("电动汽车", "electric car charging"),
    ("电动车", "electric scooter motorcycle"),
    ("电瓶车", "electric bicycle scooter"),
    ("锂电池", "lithium battery pack"),
    ("红富士", "fuji apple fruit"),
    ("生鲜", "fresh produce"),
    ("团购", "fresh groceries"),
    ("蔬菜", "fresh vegetables"),
    ("水果", "fresh fruit"),
    ("苹果", "red apple fruit"),
    ("牛奶", "fresh milk bottle"),
    ("鸡蛋", "eggs carton"),
    ("药店", "pharmacy drugstore"),
    ("药品", "medicine pharmacy"),
    ("医院", "hospital clinic"),
    ("诊所", "medical clinic"),
    ("宠物", "pet animal"),
    ("民宿", "guesthouse inn room"),
    ("酒店", "hotel lobby room"),
    ("外卖", "food delivery takeaway"),
    ("仓储", "warehouse logistics"),
    ("物流", "cargo logistics truck"),
    ("工单", "maintenance work order"),
    ("面包", "bakery bread"),
    ("电池", "electric vehicle battery"),
    ("充电", "ev charging cable"),
    ("内容团队", "creative team office"),
    ("自媒体", "content creator filming"),
    ("短视频", "smartphone filming video"),
    ("素材库", "digital content library"),
    ("创作者", "content creator studio"),
    ("素材", "photo video footage"),
    ("封面", "video thumbnail still"),
)

# 车辆 vs 食物：用户分层里的「外卖骑手」不是画面要搜的东西。
_VEHICLE_EN = frozenset(
    {
        "ev charging station",
        "electric car charging",
        "electric scooter motorcycle",
        "electric bicycle scooter",
        "lithium battery pack",
        "electric vehicle battery",
        "ev charging cable",
    }
)
_FOOD_EN = frozenset(
    {
        "fuji apple fruit",
        "fresh produce",
        "fresh groceries",
        "fresh vegetables",
        "fresh fruit",
        "red apple fruit",
        "fresh milk bottle",
        "eggs carton",
        "food delivery takeaway",
        "bakery bread",
    }
)
_VEHICLE_PAD = (
    "ev charging station",
    "electric scooter motorcycle",
    "electric vehicle battery",
)

# 标题/标签里出现这些，非食物查询就丢掉。分词后比对，避免 production 误伤。
_FOOD_HIT_TOKENS = frozenset(
    {
        "tomato",
        "tomatoes",
        "pepper",
        "peppers",
        "capsicum",
        "vegetable",
        "vegetables",
        "fruit",
        "fruits",
        "apple",
        "apples",
        "banana",
        "loquat",
        "grocery",
        "groceries",
        "salad",
        "cuisine",
        "chili",
        "chilli",
        "bibimbap",
        "chippy",
        "chips",
        "takeaway",
        "takeout",
        "food",
        "meal",
        "dinner",
        "lunch",
        "breakfast",
        "produce",
        "greens",
        "leafy",
        "veg",
        "cabbage",
        "carrot",
        "broccoli",
        "lettuce",
    }
)
_FOOD_HIT_ZH = (
    "番茄",
    "西红柿",
    "蔬菜",
    "水果",
    "辣椒",
    "彩椒",
    "柿子椒",
    "枇杷",
    "苹果",
)

_BRACKET_RE = re.compile(r"【[^】]*】|\[[^\]]*\]")
_SPLIT_RE = re.compile(r"[——\-·，,、/｜|\s]+|与|和|及|一站式")
_GENERIC_TAIL_RE = re.compile(
    r"(综合服务|管理系统|管理平台|工作台|智能|系统|平台|助手|工具|中台|方案|服务|赛道)+$"
)
_IMG_RE = re.compile(r"<img\b[^>]*>", re.I | re.S)
_PLACEHOLD_SIZE_RE = re.compile(r"placehold\.co/(\d+)x(\d+)", re.I)
#: 模型常把模板英文写进 alt，placehold.co?text= 会把「AI Workflow Video」
#: 印在卡片上（2026-08-21 素材雷达）。这种 alt 不能当检索词。
_GENERIC_ALT_RE = re.compile(
    r"(workflow|dashboard|placeholder|hero(?:\s+image)?|"
    r"\bai\s+video\b|stock\s+photo|lorem|dummy)",
    re.I,
)


def _host_ok(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return False
    return any(host == a or host.endswith("." + a) for a in STOCK_IMAGE_HOSTS)


def _fill_host_ok(url: str) -> bool:
    """新注入只收 Unsplash。闸白名单仍是 STOCK_IMAGE_HOSTS。"""
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return False
    return any(host == a or host.endswith("." + a) for a in FILL_IMAGE_HOSTS)


def _canonical_unsplash_url(url: str, aspect: Optional[str] = None) -> str:
    """收成用户给的那种稳格式。假 id（测试用 photo-charger）原样返回。"""
    match = _UNSPLASH_PHOTO_RE.search(url or "")
    if not match:
        return url
    photo = match.group(1)
    if aspect == "tall":
        return (
            f"https://images.unsplash.com/{photo}"
            "?auto=format&fit=crop&w=800&h=1200&q=80"
        )
    if aspect == "square":
        return (
            f"https://images.unsplash.com/{photo}"
            "?auto=format&fit=crop&w=800&h=800&q=80"
        )
    return (
        f"https://images.unsplash.com/{photo}"
        "?auto=format&fit=crop&w=1200&q=80"
    )


def _unsplash_access_key() -> str:
    return (
        os.environ.get("UNSPLASH_ACCESS_KEY")
        or os.environ.get("UNSPLASH_API_KEY")
        or ""
    ).strip()


def _topic_text(spec: Dict[str, Any], goal: str = "") -> str:
    pages = spec.get("pages") or []
    names = " ".join(
        f"{p.get('name', '')} {p.get('purpose', '')}"
        for p in pages
        if isinstance(p, dict)
    )
    return f"{goal} {spec.get('appName', '')} {names}"


def _topic_phrases(text: str) -> List[str]:
    """词表没命中时，用话题自己的短语搜。短于 3 字的丢掉（太泛）。"""
    cleaned = _BRACKET_RE.sub(" ", text or "")
    out: List[str] = []
    for raw in _SPLIT_RE.split(cleaned):
        seg = _GENERIC_TAIL_RE.sub("", raw.strip())
        if len(seg) < 3 or seg in out:
            continue
        out.append(seg)
        if len(out) >= _MAX_QUERIES:
            break
    return out


def _reconcile_queries(found: List[str]) -> List[str]:
    """车辆话题丢掉食物查询，空出来的槽补充电桩 / 电摩 / 车电。"""
    if any(q in _VEHICLE_EN for q in found):
        found = [q for q in found if q not in _FOOD_EN]
        for extra in _VEHICLE_PAD:
            if extra not in found and len(found) < _MAX_QUERIES:
                found.append(extra)
    return found[:_MAX_QUERIES]


def _queries(spec: Dict[str, Any], goal: str = "") -> List[str]:
    text = _topic_text(spec, goal)
    found: List[str] = []
    matched_zh: List[str] = []
    # 长词优先，避免「充电」抢在「充电桩」前面、或「苹果」误伤别的词。
    for zh, en in sorted(_ZH_HINTS, key=lambda p: len(p[0]), reverse=True):
        if zh not in text:
            continue
        if any(zh != prev and zh in prev for prev in matched_zh):
            continue
        if en not in found:
            found.append(en)
            matched_zh.append(zh)
        if len(found) >= _MAX_QUERIES:
            break
    found = _reconcile_queries(found)
    if found:
        return found
    # 对不上词表：搜话题短语。空列表 = 不注入，页面走 placehold.co。
    return _topic_phrases(text)


def _row_blob(row: Dict[str, Any]) -> str:
    title = str(row.get("title") or "")
    tags = row.get("tags") or []
    names: List[str] = []
    if isinstance(tags, list):
        for tag in tags:
            if isinstance(tag, dict):
                names.append(str(tag.get("name") or ""))
            else:
                names.append(str(tag))
    return f"{title} {' '.join(names)}"


def _query_is_food(query: str) -> bool:
    return query in _FOOD_EN


def _hit_looks_food(row: Dict[str, Any]) -> bool:
    blob = _row_blob(row)
    if any(mark in blob for mark in _FOOD_HIT_ZH):
        return True
    tokens = set(re.findall(r"[a-z0-9]+", blob.lower()))
    return bool(tokens & _FOOD_HIT_TOKENS)


def _keep_hit(query: str, row: Dict[str, Any]) -> bool:
    # 食物话题要的就是生鲜。车辆 / 其它话题：生鲜命中比缺图更糟。
    if _query_is_food(query):
        return True
    if _hit_looks_food(row):
        title = str(row.get("title") or "").strip()[:40]
        print(f"[stock_images] skip off-topic {title!r} q={query}")
        return False
    return True


def _fetch_openverse(
    query: str,
    fetch_fn: Callable[..., Any],
    limit: int = 2,
    aspect: Optional[str] = None,
) -> List[Dict[str, str]]:
    """从检索口的 {results: [...]} 里挑可注入的 Unsplash 直链。

    函数名是历史包袱（2026-08 检索口是 Openverse）；换 Unsplash 后信封没变，
    测试按这个名字切片，不改名。
    """
    payload = fetch_fn(query)
    rows = (payload or {}).get("results") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    picked: List[Dict[str, str]] = []
    rest: List[Dict[str, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        # ⚠ 真机（2026-08-19）：thumbnail 一律是 api.openverse.org 代理，
        # 不在图床白名单里——优先拿它等于搜到 8 条、注入 0 条，页面还是色块。
        # 用户要的是直挂地址，用原图 url。
        url = str(row.get("url") or row.get("thumbnail") or "").strip()
        if not url.startswith("https://") or not _fill_host_ok(url):
            continue
        url = _canonical_unsplash_url(url, aspect)
        if not _keep_hit(query, row):
            continue
        item = {
            "url": url,
            "query": query,
            "label": str(row.get("title") or query).strip()[:40] or query,
            "source": str(row.get("source") or "unsplash").strip() or "unsplash",
            "license": str(row.get("license") or "").lower(),
        }
        if item["license"] in _OK_LICENSE:
            picked.append(item)
        else:
            rest.append(item)
        if len(picked) >= limit:
            break
    # 薄语料时退到带署名的图，总比只有色块强。
    while len(picked) < limit and rest:
        picked.append(rest.pop(0))
    return picked


def _catalog_fetch(
    query: str, aspect: Optional[str] = None
) -> Dict[str, Any]:
    """没 key 时按整词从已校验目录里挑。对不上返回空 results。"""
    text = query or ""
    best_kw = ""
    best_photo = ""
    for keywords, photo in _UNSPLASH_CATALOG:
        for kw in keywords:
            if not re.search(
                r"(?<![a-z0-9])" + re.escape(kw) + r"(?![a-z0-9])",
                text,
                flags=re.I,
            ):
                continue
            if len(kw) > len(best_kw):
                best_kw = kw
                best_photo = photo
    if not best_photo:
        return {"results": []}
    url = _canonical_unsplash_url(
        f"https://images.unsplash.com/{best_photo}", aspect
    )
    return {
        "results": [
            {
                "title": query,
                "url": url,
                "thumbnail": url,
                "license": "unsplash",
                "source": "unsplash-catalog",
                "tags": [{"name": best_kw}] if best_kw else [],
            }
        ]
    }


def _unsplash_api(
    query: str,
    aspect: Optional[str],
    timeout_s: Optional[float],
    key: str,
) -> Dict[str, Any]:
    import httpx

    params: Dict[str, Any] = {
        "query": query,
        "per_page": 20,
        "content_filter": "high",
    }
    orient = _UNSPLASH_ORIENT.get(aspect or "")
    if orient:
        params["orientation"] = orient
    response = httpx.get(
        _UNSPLASH_SEARCH,
        params=params,
        headers={
            "User-Agent": _UA,
            "Accept": "application/json",
            "Accept-Version": "v1",
            "Authorization": f"Client-ID {key}",
        },
        timeout=_TIMEOUT_S if timeout_s is None else timeout_s,
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        return {"results": []}
    rows: List[Dict[str, Any]] = []
    for item in data.get("results") or []:
        if not isinstance(item, dict):
            continue
        urls = item.get("urls") if isinstance(item.get("urls"), dict) else {}
        raw = str(
            urls.get("raw") or urls.get("regular") or urls.get("full") or ""
        ).strip()
        url = _canonical_unsplash_url(raw, aspect)
        if not url.startswith("https://") or not _fill_host_ok(url):
            continue
        tags: List[Dict[str, str]] = []
        for tag in item.get("tags") or []:
            if isinstance(tag, dict) and tag.get("title"):
                tags.append({"name": str(tag.get("title"))})
        rows.append(
            {
                "title": str(
                    item.get("alt_description")
                    or item.get("description")
                    or query
                ).strip()[:80]
                or query,
                "url": url,
                "thumbnail": url,
                "license": "unsplash",
                "source": "unsplash",
                "tags": tags,
            }
        )
    return {"results": rows}


def _default_fetch(
    query: str,
    aspect: Optional[str] = None,
    timeout_s: Optional[float] = None,
) -> Dict[str, Any]:
    """活路径：Unsplash Search；没 key / 搜空 / 挂了退目录。不再打 Openverse。"""
    key = _unsplash_access_key()
    if key:
        try:
            payload = _unsplash_api(query, aspect, timeout_s, key)
            if payload.get("results"):
                return payload
            print(f"[stock_images] Unsplash 搜空 q={query!r}，退目录")
        except Exception as exc:  # noqa: BLE001 — 搜图是增强，退目录
            print(
                f"[stock_images] ⚠ Unsplash 查询失败，退目录：{str(exc)[:160]}"
            )
    return _catalog_fetch(query, aspect)


def lookup_stock_images(
    spec: Dict[str, Any],
    goal: str = "",
    *,
    fetch_fn: Optional[Callable[[str], Any]] = None,
) -> List[Dict[str, str]]:
    """零 LLM。挂了或空结果返回 []，由调用方继续用 placehold.co。"""
    fetch = fetch_fn or _default_fetch
    hits: List[Dict[str, str]] = []
    seen: set[str] = set()
    queries = _queries(spec, goal)
    print(f"[stock_images] queries={queries}")
    for query in queries:
        try:
            batch = _fetch_openverse(query, fetch)
        except Exception as exc:  # noqa: BLE001 — 搜图是增强，不许拖画页
            print(f"[stock_images] ⚠ 查询失败（{query}）：{str(exc)[:160]}")
            continue
        for item in batch:
            url = item["url"]
            if url in seen:
                continue
            seen.add(url)
            hits.append(item)
            if len(hits) >= _MAX_HITS:
                return hits
    return hits


def render_stock_images(hits: List[Dict[str, str]]) -> str:
    if not hits:
        return ""
    lines = [
        "## 库存图（直接写进 <img src>，不要改 URL、不要另编图床地址）",
    ]
    for item in hits:
        lines.append(f"- {item.get('label') or item.get('query')}：{item['url']}")
    lines.append(
        "只把上面的地址用在画面语义相符的配图上（商品照、场景照、头像）。"
        "对不上话题的格子用 https://placehold.co，不要把无关照片硬塞进去。"
    )
    return "\n".join(lines)


def attach_stock_images(style: str, block: str) -> str:
    prose = (style or "").strip()
    extra = (block or "").strip()
    if not extra:
        return prose
    if not prose:
        return extra
    if extra in prose:
        return prose
    return f"{prose}\n\n{extra}"


def _attr(tag: str, name: str) -> str:
    match = re.search(
        rf'{name}\s*=\s*(["\'])(.*?)\1', tag, flags=re.I | re.S
    )
    return unescape(match.group(2)).strip() if match else ""


def _set_src(tag: str, url: str) -> str:
    if re.search(r"src\s*=", tag, flags=re.I):
        return re.sub(
            r'src\s*=\s*(["\'])([^"\']*)\1',
            lambda m: f"src={m.group(1)}{url}{m.group(1)}",
            tag,
            count=1,
            flags=re.I,
        )
    return tag


def _should_fill(src: str, alt: str) -> bool:
    if len(alt) < 2:
        return False
    low = (src or "").lower()
    if "placehold.co" in low:
        return True
    # 模型默写 unsplash 番茄图：闸放行主机，只能按 alt 重搜换掉。
    return bool(src) and _host_ok(src)


def _aspect_of(src: str) -> Optional[str]:
    match = _PLACEHOLD_SIZE_RE.search(src or "")
    if not match:
        return None
    width, height = int(match.group(1)), int(match.group(2))
    if width <= 0 or height <= 0:
        return None
    ratio = width / height
    if ratio >= 1.3:
        return "wide"
    if ratio <= 0.77:
        return "tall"
    return "square"


def _img_search_query(alt: str, topic_queries: List[str]) -> Optional[str]:
    """tteg：检索词描述**这张照片**。车辆话题里的「外卖骑手」改搜电摩，不搜外卖。"""
    text = " ".join((alt or "").split())
    if _GENERIC_ALT_RE.search(text):
        return topic_queries[0] if topic_queries else "content creator smartphone video"
    if len(text) < 3:
        return None
    vehicle_topic = any(query in _VEHICLE_EN for query in topic_queries)
    latin = len(re.findall(r"[A-Za-z]", text))
    if latin >= 6:
        query = text[:120]
    else:
        found = _queries({"appName": "", "pages": [{"name": text, "purpose": ""}]}, text)
        query = found[0] if found else None
    if not query:
        return None
    foodish = _query_is_food(query) or _hit_looks_food({"title": query, "tags": []})
    if vehicle_topic and foodish:
        low = text.lower()
        if any(mark in low for mark in ("rider", "骑手", "avatar", "头像", "portrait", "scooter")):
            return "electric scooter motorcycle"
        padded = _reconcile_queries(list(topic_queries) + [query])
        return padded[0] if padded else None
    return query


def _resolve_query(
    query: str,
    *,
    fetch_fn: Optional[Callable[[str], Any]],
    aspect: Optional[str],
    cache: Dict[str, Optional[str]],
    deadline: Optional[float] = None,
) -> Optional[str]:
    """一格图找一个地址。**逐级退让**：整句搜不到就删词再搜。

    ⚠ 2026-08-25：这里以前只搜整句，搜不到就留占位图——那是线上
      **77%(49/64) 的图至今还是 placehold.co 的根因**。不是网断、也不是图库
      没图，是那句话问得太长：Openverse 的 q 偏 AND。同一天在生产库量到——

          ancient book page manuscript   → 0 条     ancient book     → 20 条
          orange tabby rescue cat(方图)  → 0 条     orange tabby cat → 20 条

      （数字是 2026-08-25 在 Openverse 上量的；Unsplash Search 同样吃过
      长尾 AND，阶梯留着。）
      16 条真机 alt 只搜整句命中 0～1；接上阶梯命中 15/16。

    ⚠ 放宽只在**同一句话里删词**，绝不换话题。2026-08-20 那次「电动车话题
      回落到生鲜、卡片上出现枇杷」（见模块头）是**换话题**造成的，不是删词。
      删词保住主体（_LADDER_TRIM 只删说明性尾词），跑题闸 _keep_hit 每一级
      照跑。"错图比没图更糟"那条仍然成立，这里没有违反它。

    ⚠ 超预算时**不写缓存**：写了 None 会让后面的页以为"这词搜过、没有"，
      把一次超时放大成整轮不搜图。
    """
    key = f"{query}|{aspect or ''}"
    if key in cache:
        return cache[key]
    url: Optional[str] = None
    hit_query = query
    for level, (q, asp) in enumerate(build_query_ladder(query, aspect), 1):
        if deadline is not None and time.monotonic() >= deadline:
            print(f"[stock_images] ⚠ 换图超预算，这格留占位图（{query[:40]}）")
            return None
        try:
            if fetch_fn is None:
                batch = _fetch_openverse(
                    q,
                    lambda qq, a=asp: _default_fetch(qq, aspect=a),
                    aspect=asp,
                )
            else:
                batch = _fetch_openverse(q, fetch_fn, aspect=asp)
        except Exception as exc:  # noqa: BLE001 — 单级挂了退下一级，不整个放弃
            print(f"[stock_images] ⚠ 按格查询失败（{q}）：{str(exc)[:160]}")
            continue
        if batch:
            url = batch[0]["url"]
            hit_query = q
            if level > 1:
                # 退让过就把落到的那一级打出来。哪天真机上又出现错图，
                # 这行是判断"是不是放宽放过头了"的唯一证据。
                print(
                    f"[stock_images] fill 退让{level}级 {query[:40]!r} -> {q!r}"
                )
            break
    cache[key] = url
    if url:
        host = urlparse(url).hostname or ""
        print(f"[stock_images] fill q={hit_query!r} host={host}")
    return url


def _blank_placehold_src(src: str) -> str:
    match = _PLACEHOLD_SIZE_RE.search(src or "")
    if not match:
        return src
    return f"https://placehold.co/{match.group(1)}x{match.group(2)}/e2e8f0/cbd5e1"


def _neutralize_placehold_text(html: str) -> str:
    """剥掉 placehold.co?text= 里的英文模板词。搜不到真图时卡片也不该写 AI Workflow Video。"""

    def fix(tag: str) -> str:
        src = _attr(tag, "src")
        low = (src or "").lower()
        if "placehold.co" not in low:
            return tag
        if "text=" not in low and "text%3d" not in low:
            return tag
        return _set_src(tag, _blank_placehold_src(src))

    return _IMG_RE.sub(lambda m: fix(m.group(0)), html or "")


def fill_stock_placeholders(
    html: str,
    *,
    spec: Optional[Dict[str, Any]] = None,
    goal: str = "",
    topic_queries: Optional[List[str]] = None,
    fetch_fn: Optional[Callable[[str], Any]] = None,
    cache: Optional[Dict[str, Optional[str]]] = None,
) -> str:
    """screenshot-to-code 的换图步 + tteg 的一图一查询。挂了原样返回。"""
    markup = html or ""
    if "<img" not in markup.lower():
        return markup
    topics = list(topic_queries) if topic_queries is not None else _queries(spec or {}, goal)
    store: Dict[str, Optional[str]] = cache if cache is not None else {}
    matches = list(_IMG_RE.finditer(markup))
    jobs: List[tuple[Any, str, str, Optional[str]]] = []
    seen_q = 0
    queued: set[str] = set()
    for match in matches:
        tag = match.group(0)
        src = _attr(tag, "src")
        alt = _attr(tag, "alt") or _attr(tag, "title")
        if not _should_fill(src, alt):
            continue
        query = _img_search_query(alt, topics)
        if not query:
            continue
        aspect = _aspect_of(src)
        key = f"{query}|{aspect or ''}"
        if key not in queued:
            if seen_q >= _MAX_FILL_QUERIES:
                continue
            queued.add(key)
            seen_q += 1
        jobs.append((match, tag, query, aspect))
    if not jobs:
        return _neutralize_placehold_text(markup)

    # ⚠ 并发解析，不是优化是必需的（2026-08-25）：这个函数挂在
    #   spec_first_pipeline 的 `_sink_stock` 上，跑在**页面流式推给前端的回调
    #   里**——在这儿阻塞多久，用户就多等多久才看得见那一页。
    #   接上阶梯之后单格中位 2.1s（实测 16 张真机 alt），一页 8 格串行 ≈17s；
    #   4 并发实测 5.0s → 2.2s，且图库不限流。
    #
    # ⚠ 同一个 key 只解析一次：jobs 里一个 key 可能对应多张 <img>，
    #   重复解析等于白打图库，还会把预算烧在同一个词上。
    deadline = time.monotonic() + _FILL_BUDGET_S
    todo: List[tuple[str, Optional[str]]] = []
    seen_key: set[str] = set()
    for _match, _tag, query, aspect in jobs:
        key = f"{query}|{aspect or ''}"
        if key in seen_key or key in store:
            continue
        seen_key.add(key)
        todo.append((query, aspect))
    if todo:
        def _one(item: tuple[str, Optional[str]]) -> None:
            q, asp = item
            try:
                _resolve_query(
                    q,
                    fetch_fn=fetch_fn,
                    aspect=asp,
                    cache=store,
                    deadline=deadline,
                )
            except Exception as exc:  # noqa: BLE001 — 搜图是增强，单格挂了不拦
                print(f"[stock_images] ⚠ 解析失败（{q}）：{str(exc)[:120]}")

        if len(todo) == 1:
            _one(todo[0])
        else:
            with ThreadPoolExecutor(
                max_workers=min(_FILL_WORKERS, len(todo))
            ) as pool:
                list(pool.map(_one, todo))
    out = markup
    for match, tag, query, aspect in reversed(jobs):
        url = store.get(f"{query}|{aspect or ''}")
        if not url:
            continue
        out = out[: match.start()] + _set_src(tag, url) + out[match.end() :]
    return _neutralize_placehold_text(out)


def fill_stock_in_pages(
    pages: Dict[str, str],
    spec: Dict[str, Any],
    goal: str = "",
    *,
    fetch_fn: Optional[Callable[[str], Any]] = None,
    cache: Optional[Dict[str, Optional[str]]] = None,
    skip_ids: Optional[set[str]] = None,
) -> Dict[str, str]:
    """对每一页做 fill_stock_placeholders。单页挂了留下原 HTML。"""
    skip = skip_ids or set()
    store: Dict[str, Optional[str]] = cache if cache is not None else {}
    topics = _queries(spec, goal)
    out = dict(pages)
    for page_id, html in pages.items():
        if page_id in skip:
            continue
        try:
            out[page_id] = fill_stock_placeholders(
                html,
                topic_queries=topics,
                fetch_fn=fetch_fn,
                cache=store,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[stock_images] ⚠ 页 {page_id} 换图失败（不拦）：{str(exc)[:160]}")
            out[page_id] = html
    return out


# ------------------------------------------------------------------ 交互式换图
#
# 画布「素材」档的手动换图（2026-08-25）。跟上面 fill_stock_placeholders 那条
# **自动**链路共用检索口和主机白名单，但走的是不同的取舍：自动那条 fail-open
# （搜不到就留占位图，绝不拖垮画页），这条是用户点了「换图」在等结果，搜不到
# 必须**如实说搜不到**，不许静默回落成占位图假装成功。
#
# ⚠ 为什么要加"逐级退让"（2026-08-25 真机量的）：
#   Openverse 的 q 偏 AND，整句 alt 几乎必然落空。同一天在生产库 24 个应用上
#   量到的对照——
#       ancient book page manuscript   → 0 条        ancient book  → 20 条
#       orange tabby rescue cat        → 0 条(square) orange tabby cat → 20 条
#       Tencent tech company corporate badge → 0 条（CC 图库本来就没有企业 logo）
#   直接拿整句 alt 搜，12 条真实 alt 命中 0；按下面的阶梯退让，命中 11/12。
#   **这也是线上 77%(49/64) 的图至今还是 placehold.co 的根因**——自动那条
#   用的就是整句 alt。这里先不动自动链路（那条有自己的标定和真机基线，
#   要连着一起重跑），只让手动这条用上阶梯。
#
# ⚠ aspect_ratio 是第二把刀：`orange tabby rescue cat` 不带 aspect 有 4 条，
#   带 square 直接 0。所以阶梯里每一级都先带 aspect 试、再不带试，
#   而不是把 aspect 一路带到底。

#: 检索词里没有信息量的虚词。
#: ⚠ **不含 and / or**——那两个是短语的分界，要在那里**切断**而不是删掉。
#:   第一版把它们当虚词删了，'advanced mathematics textbook and pet book'
#:   会粘成一句，截出 'textbook pet book' 这种跨短语的碎片。
_LADDER_STOP = frozenset(
    {"a", "an", "the", "of", "for", "with", "in", "on", "at", "to"}
)

#: 短语分界。取**第一个**短语——"猫爬架和休息区"这种并列，画面主体是前一个。
_LADDER_SPLIT = frozenset({"and", "or", "plus"})

#: 说明性尾词——删掉不改主体（"ancient book page manuscript" → "ancient book"）。
#: ⚠ 这些词单独拿去搜会把结果引到完全无关的方向（"badge" 搜出警徽、
#:   "card" 搜出扑克牌），所以它们只做**减法**，绝不单独成词。
_LADDER_TRIM = frozenset(
    {
        "preview", "closeup", "photo", "picture", "image", "thumbnail",
        "badge", "logo", "icon", "avatar", "banner", "background", "view",
        "shot", "setup", "area", "zone", "room", "facility", "environment",
        "document", "certificate", "card", "update", "viewfinder", "portrait",
    }
)

_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'-]*")

#: 手动换图给几个候选。自动链路仍是 2（那条只取第一条，多搜没意义）。
_REPLACEMENT_CANDIDATES = 6


def _ladder_words(alt: str) -> List[str]:
    """切到第一个短语，再去掉虚词。"""
    out: List[str] = []
    for raw in _WORD_RE.findall(alt or ""):
        low = raw.lower()
        if low in _LADDER_SPLIT:
            # 已经攒够一个短语就到此为止；还没攒够（开头就是 and）就当虚词跳过
            if len(out) >= 2:
                break
            continue
        if low in _LADDER_STOP:
            continue
        out.append(raw)
    return out


def build_query_ladder(
    alt: str, aspect: Optional[str] = None
) -> List[tuple[str, Optional[str]]]:
    """(查询词, aspect) 从最贴题到最宽泛。**纯函数**，不发请求。

    顺序刻意是「整句带比例 → 整句不带 → 去掉说明性尾词带比例 → 不带 →
    前三词 → 前两词」：先尽量保住用户 alt 的原意，实在搜不到才放宽。
    """
    words = _ladder_words(alt)
    if not words:
        return []
    core = [w for w in words if w.lower() not in _LADDER_TRIM]
    # ⚠ 尾词删到只剩一个词就别删了：'Admin avatar portrait' 去掉 avatar/portrait
    #   只剩 'Admin'，搜出来是管理面板截图、admin 标志，什么都可能——主体没了。
    #   真机 2026-08-25 A/B 里就是这一条把图搜歪的。宁可保留说明词。
    if len(core) < 2:
        core = list(words)
    out: List[tuple[str, Optional[str]]] = []

    def add(ws: List[str], asp: Optional[str]) -> None:
        query = " ".join(ws).strip()
        if query and (query, asp) not in out:
            out.append((query, asp))

    add(words, aspect)
    add(words, None)
    add(core, aspect)
    add(core, None)
    # ⚠ 截**尾巴**不截开头：英语名词短语的主体在最后
    #   （fresh organic red 【apples basket】）。第一版截前缀，真机 A/B 里
    #   'fresh organic red apples basket' 退成 'fresh organic red'、
    #   'customer picking up groceries order verification' 退成
    #   'customer picking up'——两条都把主体扔了，搜回来的图跟画面无关。
    #   "错图比没图更糟"（见模块头 2026-08-20 那次），所以这里必须留主体。
    add(core[-3:], None)
    add(core[-2:], None)
    # ⚠ 这里试过再加一级「首词 + 尾巴」（想同时保住领域词 Pet/Animal 和对象词
    #   cage/qualification）。真机 A/B 上**一次都没改变结果**——命中只是从第 5
    #   级挪到第 7 级，35/36 一张不多一张不少，还多花 2.4s。想法讲得通、数据
    #   不认，删掉了。哪天想再加，先拿真页面量一遍，别照着直觉加层。
    return out


def search_replacement_images(
    alt: str,
    src: str = "",
    *,
    fetch_fn: Optional[Callable[..., Any]] = None,
    timeout_s: Optional[float] = None,
) -> Dict[str, Any]:
    """按 alt 找可换的真图。返回 {query, aspect, candidates, tried}。

    候选只来自 FILL_IMAGE_HOSTS（Unsplash）——已经在 spec_page_html._ALLOWED_HOSTS
    里，换进页面之后再跑精修不会被「未授权外链」判失败。这条是这个功能能
    不能用的前提，不是风格问题（真机踩过：Unsplash 写进 HTML 整页校验失败）。
    """
    aspect = _aspect_of(src)
    tried: List[str] = []
    ladder = build_query_ladder(alt, aspect)
    for query, asp in ladder:
        tried.append(query if asp is None else f"{query}[{asp}]")
        try:
            if fetch_fn is None:
                batch = _fetch_openverse(
                    query,
                    lambda q, a=asp: _default_fetch(q, aspect=a, timeout_s=timeout_s),
                    limit=_REPLACEMENT_CANDIDATES,
                    aspect=asp,
                )
            else:
                batch = _fetch_openverse(
                    query,
                    fetch_fn,
                    limit=_REPLACEMENT_CANDIDATES,
                    aspect=asp,
                )
        except Exception as exc:  # noqa: BLE001 — 单级挂了就退下一级
            print(f"[stock_images] ⚠ 换图查询失败（{query}）：{str(exc)[:120]}")
            continue
        if batch:
            return {
                "query": query,
                "aspect": asp,
                "candidates": batch,
                "tried": tried,
            }
    return {"query": "", "aspect": aspect, "candidates": [], "tried": tried}
