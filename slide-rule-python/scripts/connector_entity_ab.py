"""连接器实体注入的 A/B 标定（2026-08-25）。

## 这个脚本回答的问题

"把连接器的实体声明写进 prompt"到底起没起作用？直接看"挂了连接器之后模型里
有 weather_daily"是**证明不了**的——天气这个意图本来就会让模型建一张天气表。
判据得能被反向咬住，所以这里跑三组，同一句意图：

    A 挂天气连接器
    B 不挂（反向对照）
    C 挂**股票**连接器（交叉对照：注入的东西跟意图无关，看它进不进去）

## 2026-08-25 实测（gemini-3.5-flash-lite，LLM_BASE_URL=api.rcouyi.com）

    A 挂天气   → ['weather_daily']
                 字段 date, city, condition, temp_max, temp_min,
                      rain_chance, wind_max     ← 声明的 7 个，一个不差

    B 不挂     → ['city_weather']
                 字段 id, city_name, record_date, current_temp, high_temp,
                      low_temp, weather_condition, precipitation_prob
                 ← 实体名和**每一个字段名都不一样**

    C 挂股票   → ['stock_quote', 'weather_forecast']
                 stock_quote 的 15 个字段一个不差；
                 weather_forecast 是它自己按意图建的，字段名照样自成一套

B 组正是"为什么字段 id 必须逐字进 prompt"的现场证据：真数据里的字段叫
`temp_max`，模型自己起的叫 `current_temp` / `high_temp`——两边对不上孔，
页面每格填「—」，而 problems 是空的（孔认得出，只是值没有），不报错、不告警。

C 组说明注入是**真的在起作用**，不是意图带出来的：一句纯天气的话，
硬是把 15 个字段的股票表原样收了进去。

## 怎么跑

    set -a; . ./.env; set +a
    slide-rule-python/.venv/bin/python slide-rule-python/scripts/connector_entity_ab.py

⚠ 要真 LLM 凭据。不加载 .env 会直接是
  "LLM not configured (no provider chain)"——那不是结论，是没跑。

⚠ 结论会随模型换代漂移。换 LLM_MODEL 之后**重跑这个脚本再改结论**，
  别只改注释里的数字（仓里第六条：标定过的参数不许拍脑袋改）。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from services.connectors import WEATHER, STOCK  # noqa: E402
from services.v5_llm_generate import (  # noqa: E402
    generate_five_system_model,
    get_generate_diagnostic,
    set_active_connectors,
)

GOAL = (
    "做一个城市天气页：顶部显示今天的天气与温度，下面是未来 7 天的趋势"
    "（最高温/最低温折线）和每天的降水概率。"
)


def run(tag: str, connectors):
    set_active_connectors(connectors)
    model = generate_five_system_model(GOAL)
    if not model:
        print(f"[{tag}] 生成失败：{get_generate_diagnostic()}")
        return {}
    entities = (model.get("datamodel") or {}).get("entities") or []
    out = {
        str(e.get("id")): [str(f.get("id")) for f in (e.get("fields") or [])]
        for e in entities
        if e.get("id")
    }
    print(f"[{tag}] 实体 {list(out)}")
    for eid, fields in out.items():
        print(f"        {eid}: {fields}")
    return out


def main() -> int:
    a = run("A 挂天气", ["weather"])
    b = run("B 不挂", None)
    c = run("C 挂股票", ["stock"])

    want_w = [f.id for f in WEATHER.fields]
    want_s = [f.id for f in STOCK.fields]
    print()
    print("== 结论 ==")
    print(
        "A 天气实体的字段一个不差：",
        all(f in (a.get(WEATHER.entity_id) or []) for f in want_w),
    )
    print(
        "B 不挂时**没有**这张表（反向对照）：",
        WEATHER.entity_id not in b,
    )
    print(
        "C 股票实体的字段一个不差（交叉对照）：",
        all(f in (c.get(STOCK.entity_id) or []) for f in want_s),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
