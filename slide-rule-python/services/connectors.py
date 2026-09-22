"""连接器 —— 把**真实**外部数据接成实体行。

## 这个模块解决的是什么

2026-08-25 用户裁掉了"把造数据规划进 spec"那条提议，原话是：

> 那个数据如果规划到 SPEC 里面，我觉得还是假数据……就算这个网页是给别人
> 看的，假数据其实没有意义。

裁得对。仓里本来就站在这一边——`derive-binding-source.ts` 的注释写着
"模型缺席 / 实体为空时返回空源——**不编数据**"，`missingEntities` 写着
"给报告用——**不是**用来兜底造数据的"。缺的从来不是"造得更像"，是**真的**。

所以这里换了一个方向：**不是把"造什么数据"写进 spec，而是把"数据从哪来、
有哪些字段"写进 spec**。连接器自己声明一个实体 schema，spec 拿这份 schema
去建模，生成期再按同一份 schema 取一次真数据落成行。页面读到的字段名和值
是同一个来源，不需要事后把真数据往 LLM 编出来的形状里塞。

## 三条硬约束（改之前先读）

1. **fail-closed。** 取不到就是取不到：返回 ok=False 加一句人话原因，
   **绝不**回落成编的行。仓里第七条把这类归在"证据/闭环"一侧——增强类
   （生图/取色/合并优化）才允许 fail-open。一个"成功了但数字是假的"天气页
   比一个"数据源没接上"的空页危险得多，因为后者用户看得见，前者看不见。

2. **绑了连接器的实体不许铺演示种子。** demo-seed 的存在前提是"零行 = 一片
   空壳，展会上不好看"，那对普通实体成立；对连接器实体不成立——种子在这里
   正好是它要消灭的东西。这一条是本模块最容易被后人无声破坏的地方：
   种子铺上去不报错、页面还更好看，只有数字是假的。

3. **每一行都带来源与取数时间。** 跟种子行带 `seed: true` 同一个哲学：
   伪造得越像越该标出来，真实得越像也越该标出来源。渲染层据此出
   「实时 · 来源 · 几点取的」，用户一眼分得清这页数字算不算数。

## 为什么第一条链路是天气（Open-Meteo）

用户举的例子就是天气；工程上它也是最适合当第一条的：公开 API、**不要 key**
（不用先回答"用谁的凭据"这个大得多的问题）、返回结构规整、对错一眼看得出来
——判据能写成"北京 8 月最高温落在 15~45℃"这种能被变异咬住的形态，而不是
"返回了个数字"。股票金融那批真实感更强，但数字看着都像真的，首条链路的判据
反而没法写。

⚠ 这里只做**生成期取一次、快照进 runtime**（用户 2026-08-25 的裁决）。
  "运行时每次打开都现取"是同一个 seam 上的第二种取数模式，要先回答
  "用谁的 key / 别人打开你分享的应用算谁的额度"——那是权限边界，不是接线量级。
  别在这个模块里顺手把它做了。
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote

#: **单次 HTTP 调用**的超时。跟总预算是两个数，别合成一个——见 fetch_rows。
_TIMEOUT_S = 12.0

#: 建连超时单独压短。2026-08-25 实测：卡住的那些几乎都卡在建连，
#: 读数据本身很快。连不上就早点认输，把时间留给重试。
_CONNECT_TIMEOUT_S = 8.0

#: 单条链路试几次。
#:
#: ⚠ 2026-08-25 真机第一次跑就撞上：同一个 Open-Meteo 请求，手动 curl 12s 内
#:   回来，模块里 10s 超时——容器出网首包偶尔要十几秒。一次超时就报"取数失败"
#:   对用户是纯误伤（数据源好好的）。**只对传输层异常重试**：认不出城市那种
#:   业务失败重试一百次也还是认不出，重试它只是让用户多等。
_ATTEMPTS = 2

#: 取数**总**预算（含重试）。超了就如实说超时——不是等到天荒地老，也不是补个假的。
_BUDGET_S = 40.0


class ConnectorError(Exception):
    """取数失败。带一句能直接给用户看的中文原因。"""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class ConnectorField:
    id: str
    name: str
    type: str = "text"
    format: Optional[str] = None

    def to_entity_field(self) -> Dict[str, Any]:
        """转成五系统 datamodel 里的字段声明。"""
        out: Dict[str, Any] = {"id": self.id, "name": self.name, "type": self.type}
        if self.format:
            out["format"] = self.format
        return out


@dataclass(frozen=True)
class ConnectorArg:
    id: str
    name: str
    placeholder: str = ""
    default: str = ""
    required: bool = True


@dataclass(frozen=True)
class ConnectorSpec:
    id: str
    name: str
    description: str
    #: 落进 datamodel 的实体（id 要稳定：精修冻结 id 那套按 id 认页/认实体）
    entity_id: str
    entity_name: str
    fields: Tuple[ConnectorField, ...]
    args: Tuple[ConnectorArg, ...] = ()
    #: 数据来源的人话署名，进每一行的 provenance
    source: str = ""
    #: 需要哪个环境变量才能用；空 = 不需要凭据
    needs_env: str = ""
    #: 分类（连接器页的筛选条）。⚠ 跟着连接器走，不在前端另维护一张表——
    #: 前端一张、后端一张的话，加连接器时漏改前端那张不会报错，只会让它
    #: 掉进"未分类"里再也筛不出来（仓里第四条）。
    category: str = "其它"
    #: 图标名（前端映射成一个图案；认不出就用默认的插头）。
    #: 同上：名字跟着连接器走，前端只做"名字 → 图案"的映射并且有兜底。
    icon: str = "plug"

    def available(self) -> bool:
        return not self.needs_env or bool(os.getenv(self.needs_env))

    def entity_declaration(self) -> Dict[str, Any]:
        """给 spec 用的实体声明——**字段名就是真数据的字段名**。"""
        return {
            "id": self.entity_id,
            "name": self.entity_name,
            "fields": [f.to_entity_field() for f in self.fields],
        }

    def to_public(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "entityId": self.entity_id,
            "entityName": self.entity_name,
            "source": self.source,
            "category": self.category,
            "icon": self.icon,
            "available": self.available(),
            "args": [
                {
                    "id": a.id,
                    "name": a.name,
                    "placeholder": a.placeholder,
                    "default": a.default,
                    "required": a.required,
                }
                for a in self.args
            ],
            "fields": [f.to_entity_field() for f in self.fields],
        }


@dataclass(frozen=True)
class ConnectorFetch:
    ok: bool
    connector_id: str
    entity_id: str
    rows: Tuple[Dict[str, Any], ...] = ()
    source: str = ""
    fetched_at: str = ""
    #: 失败原因（人话，直接给用户看）。ok=True 时为空。
    error: str = ""

    def to_public(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "connectorId": self.connector_id,
            "entityId": self.entity_id,
            "rows": list(self.rows),
            "source": self.source,
            "fetchedAt": self.fetched_at,
            "error": self.error,
        }


# ─────────────────────────────────────────────── 天气（Open-Meteo，免 key）

#: WMO 天气代码 → 中文。取自 Open-Meteo 文档的 weather_code 表。
#: ⚠ 别改成"看不懂就写晴"：认不出的代码要如实落成「未知（代码 N）」，
#:   否则一次 API 扩表就会让页面上凭空多出一堆晴天。
_WMO: Dict[int, str] = {
    0: "晴", 1: "少云", 2: "多云", 3: "阴",
    45: "雾", 48: "雾凇",
    51: "毛毛雨", 53: "小雨", 55: "中雨",
    56: "冻毛毛雨", 57: "冻雨",
    61: "小雨", 63: "中雨", 65: "大雨",
    66: "冻雨", 67: "强冻雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
    80: "阵雨", 81: "强阵雨", 82: "暴雨",
    85: "阵雪", 86: "强阵雪",
    95: "雷阵雨", 96: "雷阵雨伴冰雹", 99: "强雷阵雨伴冰雹",
}


def weather_text(code: Any) -> str:
    try:
        n = int(code)
    except (TypeError, ValueError):
        return "未知"
    return _WMO.get(n, f"未知（代码 {n}）")


WEATHER = ConnectorSpec(
    id="weather",
    name="天气",
    description="按城市取未来 7 天真实天气预报（Open-Meteo，免密钥）",
    entity_id="weather_daily",
    entity_name="天气预报",
    fields=(
        ConnectorField("date", "日期", "date"),
        ConnectorField("city", "城市", "text"),
        ConnectorField("condition", "天气", "text"),
        ConnectorField("temp_max", "最高温", "number", "temperature"),
        ConnectorField("temp_min", "最低温", "number", "temperature"),
        ConnectorField("rain_chance", "降水概率", "number", "percent"),
        ConnectorField("wind_max", "最大风速", "number"),
    ),
    args=(ConnectorArg("city", "城市", placeholder="北京", default="北京"),),
    source="Open-Meteo",
    category="出行生活",
    icon="weather",
)


_FORECAST_DAYS = 7


def _timeout(timeout_s: float) -> Any:
    import httpx

    return httpx.Timeout(timeout_s, connect=min(_CONNECT_TIMEOUT_S, timeout_s))


def _http_get(url: str, timeout_s: float) -> Any:
    import httpx

    r = httpx.get(url, timeout=_timeout(timeout_s), follow_redirects=True)
    r.raise_for_status()
    return r.json()


#: 有些行情接口回的是 GBK 文本而不是 JSON。
#:
#: ⚠ 别指望 httpx 的字符集自动探测：它对短响应经常猜成 ISO-8859-1，
#:   于是「贵州茅台」变成一串问号——不报错、不告警，只是名字全错。
#:   编码要显式写死在调用点上。
def _http_get_text(url: str, timeout_s: float, encoding: str = "utf-8") -> str:
    import httpx

    r = httpx.get(
        url,
        timeout=_timeout(timeout_s),
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (compatible; SlideRuleConnector/1.0)"},
    )
    r.raise_for_status()
    r.encoding = encoding
    return r.text


def _geocode(city: str, fetch: Callable[[str, float], Any], timeout_s: float) -> Dict[str, Any]:
    url = (
        "https://geocoding-api.open-meteo.com/v1/search"
        f"?name={quote(city)}&count=1&language=zh&format=json"
    )
    data = fetch(url, timeout_s) or {}
    results = data.get("results") or []
    if not results:
        # ⚠ 认不出城市**不是**"退回北京"。悄悄换一个城市，页面上每个数字都
        #   是真的，只有标题是错的——最难发现的一类假数据。
        raise ConnectorError(f"没有找到城市「{city}」，换个写法再试（如「北京」「Shanghai」）")
    top = results[0]
    return {
        "name": top.get("name") or city,
        "lat": top.get("latitude"),
        "lon": top.get("longitude"),
        "tz": top.get("timezone") or "auto",
    }


def _forecast(place: Dict[str, Any], fetch: Callable[[str, float], Any], timeout_s: float) -> Dict[str, Any]:
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={place['lat']}&longitude={place['lon']}"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,"
        "precipitation_probability_max,wind_speed_10m_max"
        f"&timezone={quote(str(place['tz']))}&forecast_days={_FORECAST_DAYS}"
    )
    data = fetch(url, timeout_s) or {}
    daily = data.get("daily") or {}
    if not daily.get("time"):
        raise ConnectorError("天气服务返回了空预报，稍后再试")
    return daily


def _weather_rows(
    city: str,
    fetch: Callable[[str, float], Any],
    timeout_s: float,
    text: Callable[..., str],
) -> Tuple[str, List[Dict[str, Any]]]:
    place = _geocode(city, fetch, timeout_s)
    daily = _forecast(place, fetch, timeout_s)
    days = daily.get("time") or []
    codes = daily.get("weather_code") or []
    tmax = daily.get("temperature_2m_max") or []
    tmin = daily.get("temperature_2m_min") or []
    rain = daily.get("precipitation_probability_max") or []
    wind = daily.get("wind_speed_10m_max") or []

    def at(seq: Any, i: int) -> Any:
        return seq[i] if isinstance(seq, list) and i < len(seq) else None

    rows: List[Dict[str, Any]] = []
    for i, day in enumerate(days):
        rows.append(
            {
                # id 由 (连接器, 城市, 日期) 决定：同一天重复取数覆盖同一行，
                # 不会每取一次就多铺 7 行。
                "id": f"weather-{place['name']}-{day}",
                "values": {
                    "date": day,
                    "city": place["name"],
                    "condition": weather_text(at(codes, i)),
                    "temp_max": at(tmax, i),
                    "temp_min": at(tmin, i),
                    "rain_chance": at(rain, i),
                    "wind_max": at(wind, i),
                },
            }
        )
    if not rows:
        raise ConnectorError("天气服务没有返回任何一天的预报")
    return str(place["name"]), rows


# ────────────────────────────────────────────── 股票行情（腾讯，免 key）

#: 腾讯行情 `v_sh600519="..."` 那串 `~` 分隔字段里，我们要的那几位。
#:
#: ⚠ 这张表是 **2026-08-25 拿真响应逐位数出来的**，不是从记忆或博客抄的
#:   （实测 88 段）。改之前先重新打一次真响应对位——这类接口没有文档、没有
#:   版本号，字段错位不会报错，只会让「市盈率」那一列显示成换手率。
#:   对位方法：`httpx.get("https://qt.gtimg.cn/q=sh600519")`，按 `~` 切开
#:   打印下标，认得出的值（名称/代码/价格）先钉住，再往两边推。
_TX_IDX = {
    "name": 1,
    "code": 2,
    "price": 3,
    "prev_close": 4,
    "open": 5,
    "quote_time": 30,
    "change": 31,
    "change_pct": 32,
    "high": 33,
    "low": 34,
    "turnover": 37,   # 成交额（万元）
    "pe": 39,
    "amplitude": 43,  # 振幅 %
    "market_cap": 45, # 总市值（亿元）
    "pb": 46,
}

#: 腾讯用 -1 / 空串表示"这一项对这个标的不适用"（指数没有涨跌停价、
#: 没有市净率）。
#:
#: ⚠ **绝不能把它当成数字 0 落进去。** 一个显示「市净率 0.00」的指数页，
#:   每个像素都像真的，只有那一格是编的——正是这条链路要消灭的东西。
#:   不适用就是 None，页面自己会出「—」。
_TX_NOT_APPLICABLE = {"-1", "-1.00", "", "0.00"}

_STOCK = ConnectorSpec(
    id="stock",
    name="股票行情",
    description="按代码或名称取 A 股 / 指数的实时行情（腾讯行情，免密钥）",
    entity_id="stock_quote",
    entity_name="股票行情",
    fields=(
        ConnectorField("code", "代码", "text"),
        ConnectorField("name", "名称", "text"),
        ConnectorField("price", "最新价", "number", "money"),
        ConnectorField("change", "涨跌额", "number", "money"),
        ConnectorField("change_pct", "涨跌幅", "number", "percent"),
        ConnectorField("open", "今开", "number", "money"),
        ConnectorField("prev_close", "昨收", "number", "money"),
        ConnectorField("high", "最高", "number", "money"),
        ConnectorField("low", "最低", "number", "money"),
        ConnectorField("amplitude", "振幅", "number", "percent"),
        ConnectorField("turnover", "成交额万元", "number", "number"),
        ConnectorField("pe", "市盈率", "number", "number"),
        ConnectorField("pb", "市净率", "number", "number"),
        ConnectorField("market_cap", "总市值亿元", "number", "number"),
        ConnectorField("quote_time", "行情时间", "text"),
    ),
    args=(
        ConnectorArg(
            "symbols",
            "股票",
            placeholder="600519,平安银行,上证指数",
            default="600519,000001,000858",
        ),
    ),
    source="腾讯行情",
    category="金融",
    icon="chart",
)

_MAX_SYMBOLS = 20


def _tx_market(code: str) -> Optional[str]:
    """6 位数字代码 → 交易所前缀。认不出返回 None（交给搜索兜）。"""
    if not (len(code) == 6 and code.isdigit()):
        return None
    if code[0] == "6" or code[0] == "9":
        return "sh"
    if code[0] in "03":
        return "sz"
    if code[0] in "48":
        return "bj"
    return None


def _tx_search(token: str, text: Callable[..., str], timeout_s: float) -> str:
    """名称 → `sh600519` 这样的带市场代码。

    腾讯 smartbox 回的是 `v_hint="sh~600519~贵州茅台~gzmt~GP-A^..."`，
    多条用 `^` 分隔。⚠ 响应里的中文是 unicode 转义序列而不是 GBK 汉字，
    所以这一条按 utf-8 读；行情那条才是 GBK。两条读法不同，别顺手统一。
    """
    url = f"https://smartbox.gtimg.cn/s3/?q={quote(token)}&t=all"
    raw = text(url, timeout_s, "utf-8") or ""
    _, _, body = raw.partition("=")
    body = body.strip().strip(";").strip('"')
    for hint in body.split("^"):
        parts = hint.split("~")
        if len(parts) >= 2 and parts[0] and parts[1]:
            return f"{parts[0]}{parts[1]}"
    raise ConnectorError(f"没有找到「{token}」，换成 6 位代码或标准简称再试（如 600519、贵州茅台）")


def _tx_num(raw: Any) -> Optional[float]:
    """行情字段 → 数字。不适用/空 → None，**不是 0**。"""
    s = str(raw or "").strip()
    if s in _TX_NOT_APPLICABLE:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _tx_time(raw: Any) -> str:
    """`20260825161438` → `2026-08-25 16:14:38`。认不出就原样返回。"""
    s = str(raw or "").strip()
    if len(s) != 14 or not s.isdigit():
        return s
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]} {s[8:10]}:{s[10:12]}:{s[12:14]}"


def _stock_rows(
    symbols: str,
    fetch: Callable[[str, float], Any],
    timeout_s: float,
    text: Callable[..., str],
) -> Tuple[str, List[Dict[str, Any]]]:
    tokens = [t.strip() for t in str(symbols or "").replace("，", ",").split(",") if t.strip()]
    if not tokens:
        raise ConnectorError("没有填股票代码或名称")
    if len(tokens) > _MAX_SYMBOLS:
        raise ConnectorError(f"一次最多 {_MAX_SYMBOLS} 只，现在填了 {len(tokens)} 只")

    # ⚠ 认不出的标的**整轮判失败**，不是悄悄跳过。用户要了三只回来两只，
    #   表格看着完全正常——"少了一行"比"错了一格"更难发现。
    codes: List[str] = []
    for token in tokens:
        market = _tx_market(token)
        codes.append(f"{market}{token}" if market else _tx_search(token, text, timeout_s))

    raw = text(f"https://qt.gtimg.cn/q={','.join(codes)}", timeout_s, "gbk") or ""
    rows: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for line in raw.splitlines():
        line = line.strip()
        if not line or "=" not in line:
            continue
        key, _, value = line.partition("=")
        # ⚠ 行 id 必须带交易所前缀。2026-08-25 用真数据跑第一轮当场撞上：
        #   **平安银行是 sz000001、上证指数是 sh000001**，六位代码一模一样。
        #   按六位代码做 id 的话，两条行在 RuntimeState 里是同一行，后取的
        #   把先取的盖掉——表格少一行、不报错、判据（"取到了 N 只"）还全绿。
        #   前缀取自响应自己的键（`v_sh600519`），比我们解析出来的更权威。
        full = key.strip()[2:] if key.strip().startswith("v_") else key.strip()
        parts = value.strip().strip(";").strip('"').split("~")
        # 88 段是实测值；短于我们要读的最大下标就说明这一行不是行情
        # （腾讯对无效代码会回一个空串），跳过而不是读出一堆 None。
        if len(parts) <= max(_TX_IDX.values()):
            continue
        name = parts[_TX_IDX["name"]].strip()
        code = parts[_TX_IDX["code"]].strip()
        if not name or not code:
            continue
        values: Dict[str, Any] = {"code": code, "name": name}
        for field, idx in _TX_IDX.items():
            if field in ("name", "code"):
                continue
            if field == "quote_time":
                values[field] = _tx_time(parts[idx])
            else:
                values[field] = _tx_num(parts[idx])
        rows.append({"id": f"stock-{full or code}", "values": values})
        seen.add(full or code)

    if not rows:
        raise ConnectorError("行情服务没有返回任何一只标的的数据，稍后再试")
    missing = [c for c in codes if c not in seen]
    if missing:
        raise ConnectorError(f"这些标的取不到行情：{'、'.join(missing)}")
    label = rows[0]["values"]["name"] if len(rows) == 1 else f"{len(rows)} 只"
    return label, rows


# ────────────────────────────────────────────── 外汇汇率（Frankfurter，免 key）

#: Frankfurter（https://api.frankfurter.app）是欧洲央行汇率的公开镜像，不要 key。
#:
#: ⚠ 基准货币对自身的汇率不是 1.0 可以编出来的。接口不回 EUR/EUR；缺报价
#:   就整轮失败，不许补 1.0 撑行——那正是硬约束 1 要消灭的假数据。
_FX = ConnectorSpec(
    id="fx",
    name="外汇汇率",
    description="按基准货币取真实汇率（Frankfurter / 欧洲央行，免密钥）",
    entity_id="fx_rate",
    entity_name="外汇汇率",
    fields=(
        ConnectorField("date", "日期", "date"),
        ConnectorField("base", "基准货币", "text"),
        ConnectorField("quote", "报价货币", "text"),
        ConnectorField("rate", "汇率", "number"),
    ),
    args=(
        ConnectorArg("base", "基准货币", placeholder="EUR", default="EUR"),
        ConnectorArg(
            "quotes",
            "报价货币",
            placeholder="USD,CNY,JPY",
            default="USD,CNY,JPY",
        ),
    ),
    source="Frankfurter",
    category="金融",
    icon="fx",
)


def _fx_rows(
    base: str,
    quotes: str,
    fetch: Callable[[str, float], Any],
    timeout_s: float,
    text: Callable[..., str],
) -> Tuple[str, List[Dict[str, Any]]]:
    del text  # JSON 接口，签名跟天气/股票一致，取数走 fetch。
    base_ccy = str(base or "EUR").strip().upper() or "EUR"
    tokens = [
        t.strip().upper()
        for t in str(quotes or "").replace("，", ",").split(",")
        if t.strip()
    ]
    if not tokens:
        raise ConnectorError("没有填报价货币")
    wanted = [t for t in tokens if t != base_ccy]
    if not wanted:
        raise ConnectorError("报价货币不能和基准货币相同，换 USD / CNY 再试")
    url = (
        "https://api.frankfurter.app/latest"
        f"?from={quote(base_ccy)}&to={quote(','.join(wanted))}"
    )
    data = fetch(url, timeout_s) or {}
    rates = data.get("rates") if isinstance(data, dict) else None
    if not isinstance(rates, dict) or not rates:
        raise ConnectorError("汇率服务返回了空行情，稍后再试")
    got_base = str(data.get("base") or base_ccy).upper()
    day = str(data.get("date") or "").strip()
    if not day:
        raise ConnectorError("汇率服务没有返回日期")
    missing = [t for t in wanted if t not in rates]
    if missing:
        raise ConnectorError(f"这些货币取不到汇率：{'、'.join(missing)}")
    rows: List[Dict[str, Any]] = []
    for q in wanted:
        raw = rates.get(q)
        try:
            rate_n = float(raw)
        except (TypeError, ValueError):
            raise ConnectorError(f"{got_base}/{q} 不是数字")
        rows.append(
            {
                "id": f"fx-{got_base}-{q}-{day}",
                "values": {
                    "date": day,
                    "base": got_base,
                    "quote": q,
                    "rate": rate_n,
                },
            }
        )
    if not rows:
        raise ConnectorError("汇率服务没有返回任何一对报价")
    label = f"{got_base} → {','.join(r['values']['quote'] for r in rows)}"
    return label, rows


# ─────────────────────────────────────────────────────────── 注册表 / 取数

_REGISTRY: Dict[str, ConnectorSpec] = {
    WEATHER.id: WEATHER,
    _STOCK.id: _STOCK,
    _FX.id: _FX,
}

_FETCHERS: Dict[str, Callable[..., Tuple[str, List[Dict[str, Any]]]]] = {
    WEATHER.id: _weather_rows,
    _STOCK.id: _stock_rows,
    _FX.id: _fx_rows,
}

STOCK = _STOCK
FX = _FX


def list_connectors() -> List[Dict[str, Any]]:
    return [spec.to_public() for spec in _REGISTRY.values()]


def get_connector(connector_id: str) -> Optional[ConnectorSpec]:
    return _REGISTRY.get(str(connector_id or "").strip())


def _iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime())


def fetch_rows(
    connector_id: str,
    args: Optional[Dict[str, Any]] = None,
    *,
    fetch_fn: Optional[Callable[[str, float], Any]] = None,
    text_fn: Optional[Callable[..., str]] = None,
    timeout_s: Optional[float] = None,
    budget_s: Optional[float] = None,
    now_fn: Optional[Callable[[], str]] = None,
) -> ConnectorFetch:
    """取一次真数据。

    ⚠ **任何失败路径都返回 ok=False，绝不返回编出来的行。** 这个函数是
      "假数据不许进系统"这条产品判断在代码里的落点；把它改成"失败时给点
      兜底数据"，整条链路就白做了——页面照样好看，数字重新变成假的。

    ⚠ `timeout_s` 是**单次 HTTP 调用**的上限，`budget_s` 是**这一整次取数**
      （含重试）的上限。**两者必须分开**——2026-08-25 真机咬出来的：路由把
      45 秒的总预算当 timeout_s 传进来，于是单次调用可以卡满 45 秒，重试
      根本轮不上，一次抖动就是 46 秒白等。并发 6 条能稳定复现 2 条卡满。
      分开之后：单次 12 秒封顶，卡住的那次 12 秒认输，第二次通常 1.5 秒就回来。
    """
    spec = get_connector(connector_id)
    if not spec:
        return ConnectorFetch(False, str(connector_id or ""), "", error=f"没有这个连接器：{connector_id}")
    if not spec.available():
        return ConnectorFetch(
            False, spec.id, spec.entity_id, error=f"{spec.name}还没配置凭据（{spec.needs_env}）"
        )

    fetch = fetch_fn or _http_get
    text = text_fn or _http_get_text
    per_call = float(timeout_s if timeout_s is not None else _TIMEOUT_S)
    budget = float(budget_s if budget_s is not None else _BUDGET_S)
    now = now_fn or _iso_now
    handler = _FETCHERS.get(spec.id)
    if not handler:
        return ConnectorFetch(False, spec.id, spec.entity_id, error=f"{spec.name}还没有取数实现")

    values = dict(args or {})
    call_args = []
    for a in spec.args:
        raw = str(values.get(a.id) or "").strip() or a.default
        if a.required and not raw:
            return ConnectorFetch(False, spec.id, spec.entity_id, error=f"缺少参数：{a.name}")
        call_args.append(raw)

    started = time.monotonic()
    last: Optional[str] = None
    label, rows = "", []
    for attempt in range(_ATTEMPTS):
        try:
            # 剩余预算不够跑满一次调用时，把这次的超时压到剩余值——
            # 不然最后一次尝试会把总预算撑破一大截。
            left = budget - (time.monotonic() - started)
            label, rows = handler(*call_args, fetch, min(per_call, max(1.0, left)), text)
            last = None
            break
        except ConnectorError as exc:
            # 业务失败（城市认不出、返回空预报）——重试没有意义，直接如实回。
            return ConnectorFetch(False, spec.id, spec.entity_id, error=exc.reason)
        except Exception as exc:  # noqa: BLE001 — 外网什么都可能抛，如实转成人话
            last = f"{spec.name}取数失败：{type(exc).__name__}"
            if time.monotonic() - started > budget:
                break
    if last:
        return ConnectorFetch(False, spec.id, spec.entity_id, error=last)
    if time.monotonic() - started > budget:
        return ConnectorFetch(False, spec.id, spec.entity_id, error=f"{spec.name}取数超时")

    source = f"{spec.source} · {label}" if label else spec.source
    return ConnectorFetch(
        True, spec.id, spec.entity_id, rows=tuple(rows), source=source, fetched_at=now()
    )
