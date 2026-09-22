"""连接器：真数据进得来，进不来的时候**不许编**。

这个文件钉的是 2026-08-25 那条产品判断在代码里的落点——用户裁掉了
"把造数据规划进 spec"，理由是"假数据其实没有意义"。所以这里每一条正向判据
（取到了、字段对得上）都配了一条反向判据（取不到时**没有**行冒出来）。

⚠ 判据全部用**注入的 fetch**，不打真外网：真机连通性有它自己的验法
  （scripts 里的手动跑 + 生成期日志），单测要的是"失败路径怎么走"，
  而失败路径正是真外网最不配合复现的部分。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import connectors as C  # noqa: E402


GEO_OK = {
    "results": [
        {"name": "北京", "latitude": 39.9, "longitude": 116.4, "timezone": "Asia/Shanghai"}
    ]
}
DAILY_OK = {
    "daily": {
        "time": ["2026-08-26", "2026-08-27"],
        "weather_code": [61, 3],
        "temperature_2m_max": [24.8, 29.5],
        "temperature_2m_min": [21.3, 22.2],
        "precipitation_probability_max": [78, 22],
        "wind_speed_10m_max": [9.6, 6.1],
    }
}


def fake_fetch(geo=GEO_OK, daily=DAILY_OK, *, calls=None):
    def _f(url, timeout_s):
        if calls is not None:
            calls.append(url)
        if "geocoding-api" in url:
            if isinstance(geo, Exception):
                raise geo
            return geo
        if isinstance(daily, Exception):
            raise daily
        return daily

    return _f


# ── 正向：真数据进得来，而且形状跟 spec 里声明的那份一致 ──────────────


def test_取到的行用的就是实体声明里的字段名():
    """整条设计的命门。

    ⚠ 这一条不是"字段名写对了没有"这种拼写检查，而是**这套做法成不成立**：
      连接器把 schema 交给 spec 去建模，生成期再按同一份 schema 落值。两边
      一旦分叉，页面上的孔和手里的值就对不上——`derive-binding-source` 会
      老老实实每格填「—」，而 problems 是空的（孔认得出，只是值没有），
      正是仓里记了十几次的那种不报错的失效。
    """
    r = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch())
    assert r.ok
    declared = {f["id"] for f in C.WEATHER.entity_declaration()["fields"]}
    for row in r.rows:
        assert set(row["values"].keys()) == declared


def test_值是真的透传下来的_不是重新编的():
    r = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch())
    first = r.rows[0]["values"]
    assert first["date"] == "2026-08-26"
    assert first["temp_max"] == 24.8
    assert first["rain_chance"] == 78
    assert first["condition"] == "小雨"  # WMO 61


def test_每一行都带来源与取数时间():
    """跟种子行带 seed:true 同一个哲学：真实得越像越该标出来源。"""
    r = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch(), now_fn=lambda: "T0")
    assert r.source == "Open-Meteo · 北京"
    assert r.fetched_at == "T0"


def test_行_id_由城市加日期决定_重复取数不会越取越多():
    a = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch())
    b = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch())
    assert [r["id"] for r in a.rows] == [r["id"] for r in b.rows]
    assert len({r["id"] for r in a.rows}) == len(a.rows)


# ── 反向：进不来的时候，一行都不许有 ───────────────────────────────


@pytest.mark.parametrize(
    "kwargs, 说的是",
    [
        (dict(geo=RuntimeError("boom")), "地理编码炸了"),
        (dict(daily=RuntimeError("boom")), "预报接口炸了"),
        (dict(geo={"results": []}), "城市认不出"),
        (dict(daily={"daily": {}}), "返回空预报"),
    ],
)
def test_取不到就是取不到_不许有兜底行(kwargs, 说的是):
    r = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch(**kwargs))
    assert r.ok is False, 说的是
    # ⚠ 这一条比 ok=False 重要：把失败改成"给点兜底数据"时 ok 可能还是 False，
    #   而页面照样铺满假数字。判据要钉在**有没有行**上。
    assert r.rows == (), 说的是
    assert r.error, "失败必须带一句人话原因，不许静静地空着"


def test_认不出城市不许悄悄换成默认城市():
    """最难发现的一类假数据：每个数字都是真的，只有标题是错的。"""
    r = C.fetch_rows("weather", {"city": "zzz"}, fetch_fn=fake_fetch(geo={"results": []}))
    assert r.ok is False
    assert r.rows == ()
    assert "zzz" in r.error


def test_没有这个连接器_和_没配凭据_都如实回绝(monkeypatch):
    miss = C.fetch_rows("nope", {}, fetch_fn=fake_fetch())
    assert miss.ok is False and miss.rows == () and "nope" in miss.error

    gated = C.ConnectorSpec(
        id="gated",
        name="要钥匙的",
        description="",
        entity_id="e",
        entity_name="E",
        fields=(C.ConnectorField("a", "A"),),
        needs_env="SOME_KEY_THAT_IS_NOT_SET",
    )
    monkeypatch.setitem(C._REGISTRY, "gated", gated)
    monkeypatch.delenv("SOME_KEY_THAT_IS_NOT_SET", raising=False)
    r = C.fetch_rows("gated", {}, fetch_fn=fake_fetch())
    assert r.ok is False and r.rows == () and "凭据" in r.error


# ── 重试：只对传输层，业务失败不重试 ───────────────────────────────


def test_传输层异常会再试一次_业务失败不重试():
    """⚠ 两半都要判。只判"会重试"的话，把业务失败也拖进重试同样绿——
    而那只是让用户对着一个永远认不出的城市多等一轮。"""
    calls = []
    C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch(geo=RuntimeError("x"), calls=calls))
    assert len(calls) == C._ATTEMPTS, "传输层炸了要再试"

    calls2 = []
    C.fetch_rows("weather", {"city": "zzz"}, fetch_fn=fake_fetch(geo={"results": []}, calls=calls2))
    assert len(calls2) == 1, "业务失败不许重试"


def test_第一次超时第二次成功_算成功():
    state = {"n": 0}

    def flaky(url, timeout_s):
        if "geocoding-api" in url:
            state["n"] += 1
            if state["n"] == 1:
                raise TimeoutError("首包慢")
            return GEO_OK
        return DAILY_OK

    r = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=flaky)
    assert r.ok and len(r.rows) == 2


# ── 天气代码：认不出的不许写成晴 ────────────────────────────────────


def test_认不出的天气代码如实标未知():
    assert C.weather_text(61) == "小雨"
    assert C.weather_text(0) == "晴"
    # ⚠ 别改成"看不懂就写晴"：Open-Meteo 一次扩表就会让页面凭空多出一堆晴天。
    assert "未知" in C.weather_text(1234)
    assert "1234" in C.weather_text(1234)
    assert C.weather_text(None) == "未知"


def test_连接器清单对外只暴露公开信息():
    items = C.list_connectors()
    assert any(i["id"] == "weather" for i in items)
    w = next(i for i in items if i["id"] == "weather")
    assert w["entityId"] == "weather_daily"
    assert [f["id"] for f in w["fields"]][:2] == ["date", "city"]
    assert w["available"] is True


# ════════════════════════════════════════════════ 股票行情（腾讯，免 key）

#: 真响应，**原样落盘**（2026-08-25 从 qt.gtimg.cn 抓的三行）。
#:
#: ⚠ 第一版是手搓的"差不多的"字符串，结果判据废了一半：手搓那份里
#:   流通市值和总市值恰好写成了同一个数，**把下标 45 改成 44 判据照样全绿**。
#:   自己拼的假响应只能证明解析器解析得了它自己。这里挑了工商银行——
#:   流通 21299.36 / 总市值 28156.09 差得开，下标错一位当场露馅。
#:
#: ⚠ 别"整理"这三行（换行、删中间的买卖五档、改数字）。整理过就不是实测了，
#:   而这个模块的字段下标只有真响应能对得住。
TX_ICBC = 'v_sh601398="1~工商银行~601398~7.90~7.89~7.92~2918582~1413006~1505576~7.89~5942~7.88~43364~7.87~20013~7.86~18013~7.85~16222~7.90~1581~7.91~32847~7.92~17455~7.93~14445~7.94~8524~~20260825161431~0.01~0.13~7.97~7.87~7.90/2918582/2307681767~2918582~230768~0.11~7.58~~7.97~7.87~1.27~21299.36~28156.09~0.73~8.68~7.10~0.79~28702~7.91~8.10~7.64~~~-0.24~230768.1767~134.3000~1700~   A~GP-A~1.79~3.00~3.93~8.58~0.67~8.16~6.68~3.95~-0.88~8.22~269612212539~356406257089~16.09~0.64~269612212539~~~8.52~0.13~~CNY~0~___D__F__N~7.99~-40823~";'
TX_PINGAN = 'v_sz000001="51~平安银行~000001~11.59~11.56~11.57~994881~541768~453114~11.58~21~11.57~694~11.56~1350~11.55~3902~11.54~2411~11.59~1900~11.60~8729~11.61~10004~11.62~5643~11.63~11038~~20260825161418~0.03~0.26~11.64~11.53~11.59/994881/1152242457~994881~115224~0.51~5.18~~11.64~11.53~0.95~2249.12~2249.15~0.48~12.72~10.40~0.91~-28936~11.58~4.38~5.28~~~0.21~115224.2457~42.6512~368~   A~GP-A~4.89~4.89~5.14~7.93~0.72~11.90~9.99~2.93~3.48~9.03~19405684991~19405918198~-63.33~2.11~19405684991~~~-2.23~0.26~~CNY~0~~11.65~-27661~";'
TX_INDEX = 'v_sh000001="1~上证指数~000001~3889.44~3882.01~3863.37~464117264~0~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~~20260825161402~7.43~0.19~3896.21~3850.86~3889.44/464117264/858874228922~464117264~85887423~0.96~17.71~~3896.21~3850.86~1.17~608388.09~688868.33~0.00~-1~-1~0.92~0~3875.73~~~~~~85887422.8922~0.0000~0~ ~ZS~-2.00~-2.53~~~~4258.86~3732.84~-1.13~2.00~-4.15~4847563574053~~-10.85~0.37~4847563574053~~~0.15~0.04~~CNY~0~~0.00~0~";'

def fake_text(body="", *, search='v_hint="sh~601398~工商银行~gsyh~GP-A"', calls=None):
    def _t(url, timeout_s, encoding="utf-8"):
        if calls is not None:
            calls.append(url)
        if "smartbox" in url:
            if isinstance(search, Exception):
                raise search
            return search
        if isinstance(body, Exception):
            raise body
        return body

    return _t


def test_股票行情按实测下标取值_不是随手对位():
    r = C.fetch_rows(
        "stock", {"symbols": "601398"}, fetch_fn=fake_fetch(), text_fn=fake_text(TX_ICBC)
    )
    assert r.ok, r.error
    v = r.rows[0]["values"]
    assert (v["name"], v["code"]) == ("工商银行", "601398")
    assert v["price"] == 7.90 and v["prev_close"] == 7.89 and v["open"] == 7.92
    assert v["change"] == 0.01 and v["change_pct"] == 0.13
    assert v["high"] == 7.97 and v["low"] == 7.87
    assert v["amplitude"] == 1.27
    assert v["turnover"] == 230768
    assert v["pe"] == 7.58 and v["pb"] == 0.73
    # ⚠ 这一条专治"下标错一位"：同一行里 [44] 流通市值是 21299.36、
    #   [45] 总市值是 28156.09。挑工商银行就是为了让这两个数差得开。
    assert v["market_cap"] == 28156.09
    assert v["quote_time"] == "2026-08-25 16:14:31"


def test_沪深两个_000001_不会撞成同一行():
    """真数据跑第一轮当场撞上的：**平安银行 sz000001、上证指数 sh000001**。

    ⚠ 按六位代码做行 id 的话，两条在 RuntimeState 里是同一行，后取的把先取的
      盖掉——表格少一行、不报错，而"取到了 2 只"这种判据还全绿。这一条要钉的
      就是那个全绿：**行数对不够，id 必须也不重**。
    """
    r = C.fetch_rows(
        "stock",
        {"symbols": "000001,000001"},
        fetch_fn=fake_fetch(),
        text_fn=fake_text(TX_PINGAN + "\n" + TX_INDEX),
    )
    assert r.ok, r.error
    ids = [row["id"] for row in r.rows]
    assert len(ids) == 2
    assert len(set(ids)) == 2, f"两只不同标的撞成同一个 id：{ids}"
    assert {row["values"]["name"] for row in r.rows} == {"平安银行", "上证指数"}


def test_不适用的字段是空值_不是数字零():
    """⚠ 「市净率 0.00」的指数页每个像素都像真的，只有那一格是编的。"""
    r = C.fetch_rows(
        "stock",
        {"symbols": "上证指数"},
        fetch_fn=fake_fetch(),
        # ⚠ 名称走搜索才拿得到 sh 前缀；直接填 000001 会被推成 sz（深市），
        #   跟这份沪市指数响应对不上——判据自己先要对得上题。
        text_fn=fake_text(TX_INDEX, search='v_hint="sh~000001~上证指数~szzs~ZS"'),
    )
    assert r.ok, r.error
    assert r.rows[0]["values"]["pb"] is None
    # 反面：真有值的字段不许被这条规则误伤
    assert r.rows[0]["values"]["pe"] == 17.71


def test_六位代码自己推交易所_不用多打一次搜索():
    calls = []
    C.fetch_rows(
        "stock",
        {"symbols": "601398"},
        fetch_fn=fake_fetch(),
        text_fn=fake_text(TX_ICBC, calls=calls),
    )
    assert not any("smartbox" in u for u in calls), "6 位代码不该再去搜一次"
    assert any("qt.gtimg.cn/q=sh601398" in u for u in calls)


def test_名称走搜索_解析出带市场的代码():
    calls = []
    r = C.fetch_rows(
        "stock",
        {"symbols": "工行"},
        fetch_fn=fake_fetch(),
        text_fn=fake_text(TX_ICBC, calls=calls),
    )
    assert r.ok, r.error
    assert any("smartbox" in u for u in calls)
    assert any("q=sh601398" in u for u in calls)


def test_认不出的标的整轮判失败_不是悄悄跳过():
    """⚠ 用户要了三只回来两只，表格看着完全正常——"少了一行"比"错了一格"
    更难发现。所以这里 fail-closed，并且**把认不出的那个词说出来**。"""
    r = C.fetch_rows(
        "stock",
        {"symbols": "601398,压根不存在xyz"},
        fetch_fn=fake_fetch(),
        text_fn=fake_text(TX_ICBC, search='v_hint="";'),
    )
    assert r.ok is False
    assert r.rows == ()
    assert "压根不存在xyz" in r.error


def test_行情回了但少了标的_也判失败():
    """搜索都认得出、行情却只回了一只：同样是"少一行"，同样不许当成功。"""
    r = C.fetch_rows(
        "stock",
        {"symbols": "601398,000001"},
        fetch_fn=fake_fetch(),
        text_fn=fake_text(TX_ICBC),  # 只回茅台
    )
    assert r.ok is False and r.rows == ()
    assert "sz000001" in r.error


def test_股票也守着那条总纪律_取不到不许有行():
    for body in (RuntimeError("boom"), "", 'v_sh601398="";'):
        r = C.fetch_rows(
            "stock", {"symbols": "601398"}, fetch_fn=fake_fetch(), text_fn=fake_text(body)
        )
        assert r.ok is False and r.rows == () and r.error


def test_一次最多二十只_挡住把接口当批量下载用():
    r = C.fetch_rows(
        "stock",
        {"symbols": ",".join(["601398"] * 21)},
        fetch_fn=fake_fetch(),
        text_fn=fake_text(TX_ICBC),
    )
    assert r.ok is False and "20" in r.error


def test_中文逗号也认():
    r = C.fetch_rows(
        "stock",
        {"symbols": "601398，000001"},
        fetch_fn=fake_fetch(),
        text_fn=fake_text(TX_ICBC + "\n" + TX_PINGAN),
    )
    assert r.ok, r.error
    assert len(r.rows) == 2


def test_清单里两个连接器都在_字段名与实体声明一致():
    ids = {c["id"] for c in C.list_connectors()}
    assert ids == {"weather", "stock", "fx"}
    r = C.fetch_rows(
        "stock", {"symbols": "601398"}, fetch_fn=fake_fetch(), text_fn=fake_text(TX_ICBC)
    )
    declared = {f["id"] for f in C.STOCK.entity_declaration()["fields"]}
    assert set(r.rows[0]["values"].keys()) == declared


# ════════════════════════════════ 外汇（Frankfurter）：同样不许编行


FX_OK = {
    "amount": 1.0,
    "base": "EUR",
    "date": "2026-08-26",
    "rates": {"USD": 1.17, "CNY": 8.41, "JPY": 162.3},
}


def fake_fx(body=FX_OK):
    def _f(url, timeout_s):
        if isinstance(body, Exception):
            raise body
        return body

    return _f


def test_fx_取到的行用的就是实体声明里的字段名():
    r = C.fetch_rows("fx", {"base": "EUR", "quotes": "USD,CNY"}, fetch_fn=fake_fx())
    assert r.ok, r.error
    declared = {f["id"] for f in C.FX.entity_declaration()["fields"]}
    for row in r.rows:
        assert set(row["values"].keys()) == declared
    assert r.source.startswith("Frankfurter")
    assert r.fetched_at
    quotes = {row["values"]["quote"] for row in r.rows}
    assert quotes == {"USD", "CNY"}


def test_fx_缺报价整轮失败_不许补_1_点_0():
    """EUR/EUR 编 1.0、少回一只悄悄跳过，都是假数据。"""
    r = C.fetch_rows(
        "fx",
        {"base": "EUR", "quotes": "USD,GBP"},
        fetch_fn=fake_fx({"amount": 1.0, "base": "EUR", "date": "2026-08-26", "rates": {"USD": 1.17}}),
    )
    assert r.ok is False
    assert r.rows == ()
    assert "GBP" in r.error


def test_fx_传输失败不许有行():
    r = C.fetch_rows("fx", {"base": "EUR", "quotes": "USD"}, fetch_fn=fake_fx(RuntimeError("boom")))
    assert r.ok is False and r.rows == () and r.error


def test_fx_空行情不许编():
    r = C.fetch_rows(
        "fx",
        {"base": "EUR", "quotes": "USD"},
        fetch_fn=fake_fx({"base": "EUR", "date": "2026-08-26", "rates": {}}),
    )
    assert r.ok is False and r.rows == ()


# ════════════════════════════════ 超时预算：单次上限 ≠ 总预算


def test_单次调用的超时不会被总预算撑破():
    """⚠ 2026-08-25 真机咬出来的设计 bug。

    路由把 45 秒的**总预算**当 timeout_s 传了进来，于是单次 HTTP 调用可以
    卡满 45 秒，重试根本轮不上——一次网络抖动就是 46 秒白等，而同一个请求
    单条跑只要 1.5 秒（并发 6 条能稳定复现 2 条卡满）。

    判据钉的是"**传给 fetch 的那个超时值**"，不是耗时——耗时判据要真的等，
    既慢又不稳。
    """
    seen = []

    def spy(url, timeout_s, encoding="utf-8"):
        seen.append(timeout_s)
        return TX_ICBC

    C.fetch_rows(
        "stock",
        {"symbols": "601398"},
        fetch_fn=fake_fetch(),
        text_fn=spy,
        timeout_s=12.0,
        budget_s=45.0,
    )
    assert seen, "根本没调到"
    assert max(seen) <= 12.0, f"单次超时被总预算撑破了：{seen}"


def test_预算快用完时最后一次尝试跟着缩短():
    """剩余预算不够跑满一次调用时，这次的超时压到剩余值——
    否则最后一次尝试会把总预算撑破一大截。"""
    seen = []

    def spy(url, timeout_s, encoding="utf-8"):
        seen.append(timeout_s)
        return TX_ICBC

    C.fetch_rows(
        "stock",
        {"symbols": "601398"},
        fetch_fn=fake_fetch(),
        text_fn=spy,
        timeout_s=30.0,
        budget_s=5.0,
    )
    assert max(seen) <= 5.0, f"预算 5 秒却放了 {max(seen)} 秒的调用出去"


def test_两个数缺省时各用各的默认值():
    seen = []

    def spy(url, timeout_s, encoding="utf-8"):
        seen.append(timeout_s)
        return TX_ICBC

    C.fetch_rows("stock", {"symbols": "601398"}, fetch_fn=fake_fetch(), text_fn=spy)
    # 单次默认 _TIMEOUT_S，而不是总预算 _BUDGET_S
    assert max(seen) <= C._TIMEOUT_S
    assert C._TIMEOUT_S < C._BUDGET_S, "单次上限必须小于总预算，否则重试没有意义"
