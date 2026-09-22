"""演示域夹具的离线增强再冻结脚本（golden-file 再生成，2026-07-26）。

问题：E35 冻结的四个演示域模型（builtin_domain_models.json）全部诞生于
V5.4 体验层之前——没有生成式主题、没有 freeformOverview。结果是：需求越
"标准"（采购/请假/工单/入职，恰好是新用户最可能先试的四个），拿到的应用
反而越旧，全套 V5.4 体验只有"新奇意图"吃得到。

修法（Kubernetes testdata / insta 的 golden-file 套路）：本脚本离线跑一遍
体验层增强（身份主题 + monitor 首页设计），把产物写回冻结 JSON；增强后的
模型必须重新过结构门才允许落盘（不过门就保留原样，如实报告）。运行时仍然
零 LLM——增强发生在这里、冻结在 JSON 里，与 E35 的"冻结夹具"哲学一致。
CI 哨兵：tests/test_builtin_domain_models.py（过门）+
tests/test_builtin_enriched.py（增强产物在场且合约合格）。

用法（在 slide-rule-python/ 下）：
    ./.venv/bin/python scripts/enrich_builtin_domain_models.py
需要 LLM 配置（.env）；生图不可用时主题自动退化为纯文字取色（可用
IMAGE_API_URL= 置空来强制跳过生图，省掉对死网关的重试等待）。
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# .env 水合（与 app.py 同语义：根目录 .env 先加载即先赢，包内 .env 补缺；
# 命令行显式 env 永远优先——dotenv 默认不覆盖已存在的变量）。
from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT.parent / ".env")
load_dotenv(ROOT / ".env")

from services.freeform_block import enrich_monitor_page_overviews  # noqa: E402
from services.identity_theme_gen import enrich_identity_theme  # noqa: E402
from services.v5_model_gate import validate_five_system_model  # noqa: E402

FIXTURE = ROOT / "services" / "data" / "builtin_domain_models.json"

# 各域起手意图（原 services/builtin_examples._EXAMPLE_META；E41 官方示例库
# 2026-08-14 下架后该模块删除，这份文案只剩本脚本在用，就地冻结）。
_EXAMPLE_META = {
    "purchase_approval": {
        "intent": "设计一个采购审批系统，包含采购申请、部门审批和供应商管理",
    },
    "leave_approval": {
        "intent": "设计一个请假审批系统，包含请假申请、主管审批和假期额度管理",
    },
    "service_ticket": {
        "intent": "我们客服团队需要一个服务工单系统，支持工单流转、SLA 升级和客服绩效",
    },
    "employee_onboarding": {
        "intent": "设计一个员工入职系统，包含入职流程、部门分配和 HR 权限管理",
    },
}

# 各域预设主题 → 色相锚点提示。纯文字取色时四个域容易收敛到同一色系
# （实测全部落青蓝），比原先四套不同预设还"千人一面"——把每个域自己
# 选定的预设主题气质当锚点喂给生成，保住演示矩阵的视觉差异。
_HUE_ANCHORS = {
    "azure": "湛蓝系（企业蓝为主色相）",
    "forest": "松绿系（沉稳绿为主色相）",
    "graphite": "石墨中性灰系",
    "tangerine": "暖橘橙系（活力暖色为主色相）",
    "violet": "紫罗兰系（创意紫为主色相）",
    "amber": "琥珀金褐系",
    "clay": "陶土暖棕系",
    "indigo": "靛蓝系",
}


def main() -> int:
    models = json.loads(FIXTURE.read_text(encoding="utf-8"))
    out: dict = {}
    failures: list[str] = []
    for domain, model in models.items():
        goal = (_EXAMPLE_META.get(domain) or {}).get("intent") or domain
        preset = str(
            ((model.get("appbundle") or {}).get("appIdentity") or {}).get("theme") or ""
        )
        anchor = _HUE_ANCHORS.get(preset)
        if anchor:
            goal = f"{goal}（品牌色相锚点：{anchor}——请围绕这个色相家族设计，不要漂到别的色系）"
        print(f"=== {domain}: enriching (goal: {goal[:30]}…)")
        candidate = json.loads(json.dumps(model))  # 深拷贝，失败不污染原件
        try:
            # 幂等：已有合格生成主题就不重生（golden diff 稳定、省生图配额）。
            # 想强制换一批主题：--refresh-theme。
            existing_theme = (
                (candidate.get("appbundle") or {}).get("appIdentity") or {}
            ).get("generatedTheme")
            from services.freeform_block import is_valid_generated_theme

            if "--refresh-theme" in sys.argv or not is_valid_generated_theme(existing_theme):
                candidate = enrich_identity_theme(candidate, goal)
            else:
                print("    theme: kept existing generatedTheme")
            candidate = enrich_monitor_page_overviews(candidate)
        except Exception as exc:  # noqa: BLE001 — 单域失败不拖垮其余域
            print(f"    enrich failed ({str(exc)[:160]}), keeping original")
            out[domain] = model
            failures.append(domain)
            continue
        gate = validate_five_system_model(candidate, require_landing_page_ref=False)
        if not gate.get("passed"):
            first = (gate.get("findings") or [{}])[0]
            print(f"    gate BLOCKED after enrich ({first}), keeping original")
            out[domain] = model
            failures.append(domain)
            continue
        theme_ok = bool(
            ((candidate.get("appbundle") or {}).get("appIdentity") or {}).get("generatedTheme")
        )
        overviews = sum(
            1
            for p in (candidate.get("page") or {}).get("pages") or []
            if p.get("freeformOverview")
        )
        print(f"    OK: generatedTheme={theme_ok}, freeformOverview pages={overviews}")
        out[domain] = candidate
    # indent=1 与原冻结文件格式一致——golden 文件重生成的 diff 必须只含
    # 真实变更，不掺整文件重排噪音。
    FIXTURE.write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"written: {FIXTURE}")
    if failures:
        print(f"kept original (enrich/gate failed): {failures}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
