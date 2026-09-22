"""设备档必须用 1..N 行号映射，漏判不许填 unknown。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from forum_fit_device import parse_devices  # noqa: E402


def test_parse_devices_maps_lineno_not_topic_id():
    rows = [(11, "小程序", "x"), (22, "后台", "y")]
    got = parse_devices(
        [
            {"i": 1, "device": "phone", "why": "小程序"},
            {"i": 2, "device": "desktop", "why": "工作台"},
        ],
        rows,
    )
    assert got[11][0] == "phone"
    assert got[22][0] == "desktop"


def test_parse_devices_does_not_fill_missing():
    rows = [(11, "甲", "a"), (22, "乙", "b")]
    got = parse_devices([{"i": 1, "device": "phone", "why": "App"}], rows)
    assert 11 in got
    assert 22 not in got
    assert "unknown" not in {d for d, _ in got.values()}
