"""E41 官方示例库——摘要投影必须全真（来自过门冻结模型，不发明数字）。

⚑ 2026-08-14 数据清空（用户裁决：清数据不删功能）：老链路的四条示例
下架，_EXAMPLE_META 置空。本文件从"锁四条示例的真指标"改成锁两件事：
① 空货架如实为空（接口/投影不因为没数据而炸）；
② 投影口径不坏——将来往 _EXAMPLE_META 上架新条目时，指标必须还是从
   冻结模型里数出来的（用临时 meta 注入验证，不依赖货架上有没有货）。
"""

import json
from pathlib import Path

import services.builtin_examples as be
from services.schema_legal import legal_snapshot

_FIXTURE = Path(__file__).resolve().parent.parent / "services" / "data" / "builtin_domain_models.json"


def test_货架清空后如实返回空列表():
    be._cache = None
    assert be.list_builtin_examples() == []


def test_上架口径不坏_指标仍从冻结模型数出来(monkeypatch):
    """临时上架一条（用冻结夹具里真实存在的域），投影必须全真。"""
    models = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    domain = next(iter(models))
    monkeypatch.setattr(
        be, "_EXAMPLE_META", {domain: {"intent": "试上架一条", "category": "测试"}}
    )
    monkeypatch.setattr(be, "_cache", None)
    try:
        examples = be.list_builtin_examples()
        assert len(examples) == 1
        ex = examples[0]
        model = models[domain]
        assert ex["pages"] == len(model["page"]["pages"])
        assert ex["roles"] == len(model["rbac"]["roles"])
        assert ex["aiCapabilities"] == len(model["aigc"]["capabilities"])
        # 标签 = 真实页面名前三，不是营销词
        assert ex["tags"] == [p.get("name") for p in model["page"]["pages"][:3]]
        # 身份字段仍在合法域内
        legal = legal_snapshot()
        assert ex["theme"] in legal["identityThemes"]
        assert ex["icon"] in legal["identityIcons"]
        assert ex["nav"] in legal["identityNavs"]
        assert ex["intent"] == "试上架一条"
    finally:
        be._cache = None  # 别把注入的货留在缓存里污染别的测试


def test_元数据里的域必须真实存在于冻结夹具(monkeypatch):
    """指向不存在的域 → 该条如实不出现（fail-closed，不摆空壳卡）。"""
    monkeypatch.setattr(
        be, "_EXAMPLE_META", {"no_such_domain": {"intent": "x", "category": "y"}}
    )
    monkeypatch.setattr(be, "_cache", None)
    try:
        assert be.list_builtin_examples() == []
    finally:
        be._cache = None
