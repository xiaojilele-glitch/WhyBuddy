"""
sliderule_llm/image_client.py — 生图客户端（能力层，不接生产链路）。

复刻 skills/sliderule 那套已验证过的 image_settings.py 单一入口模式：
Key/地址/模型只从环境变量取（IMAGE_API_KEY / IMAGE_API_URL / IMAGE_MODEL），
三者缺一律 fail-closed，不内置任何第三方服务商地址当默认值——
避免在没人明确配置的情况下悄悄把 prompt 发到某个写死的外部端点。

出的图统一按「预览·未验证」对待：只示意、不写真实数据、用完即弃，
不落进产物给终端用户看——这条纪律由调用方（不是本模块）负责执行。
"""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

RETRIES = 3
BACKOFF = 5  # 秒，退避基数：5, 10, 15
DEFAULT_TIMEOUT_S = 600

# 一次 generate_image_png 调用（含全部重试与退避）的**总时长上限**。
#
# 2026-08-01 真机吃到的教训：端点 503 时，"重试 3 次 × 单次超时 600s + 退避"
# 没有任何总量约束——实测两轮分别白等 788s / 686s，理论最坏 3×600+15 = 30 分钟
# 一张；满配 9 张全挂约 4.5 小时。其中一轮直接把整个生成跑挂在 25 分钟超时上，
# 什么都没产出。
#
# fail-open 的语义只保证"不崩"（确实照常降级成纯文字），没人管过"要等多久"。
# 对用户而言，转圈半小时和失败没有区别，只是更糟——他连失败都看不到。
#
# ── 取值依据（2026-08-06 上调 240 → 400）─────────────────────────────
#
# 240 当初的说法是"实测成功出图 34~107s，取 >2× 最慢值"，但 2×107 = 214，
# 240 其实只有 1.12× 冗余，算错了。更要紧的是**这个倍数本来就该按重试算，
# 不是按单次算**：预算约束的是「重试 + 退避」的总和，一次都不许重试的预算
# 等于把重试机制关掉了。
#
# 按最坏的成功路径推：
#   第 1 次瞬时失败（比如端点偶发 502，几秒就回）
#   + 退避 5s
#   + 第 2 次成功，赶上最慢的那张 ≈ 110s
#   ≈ 120s ——240s 扛得住这一轮。
# 但真正会咬人的是**第 1 次卡住不回**：单次超时取 min(600, 剩余预算)，
# 240s 下第一次就能把预算耗光，重试连发都发不出去。
#
# 400s 的取法：容得下「一次 ~110s 的慢出图卡死 + 退避 5s + 再来一次完整
# 110s」≈ 225s，还留一倍余量给端点变慢；同时相对老行为（3×600+30 = 30 分钟）
# 仍然砍掉 93%。展会现场端点抖一下不至于整张丢掉。
#
# 实测（api.gpt.ge / gpt-image-2，2026-08-06）：
#   参照板·桌面 2560x1440  103.6s
#   参照板·手机 1440x2560   71.7s
#   区块图·桌面 1280x720    51.5s
#
# 需要更宽/更窄用 IMAGE_TOTAL_BUDGET_S 调；设 0 表示不限（回到老行为）。
DEFAULT_TOTAL_BUDGET_S = 400

LABEL = "预览·未验证"


class ImageGenError(RuntimeError):
    pass


@dataclass(frozen=True)
class ImageGenConfig:
    url: str
    model: str
    key: str
    timeout: int
    # 请求体形态。不同服务商对"要多大的图"用的字段不一样，实测过两种：
    #   "size"       → {"size": "1792x1024"}          （OpenAI images 接口标准写法）
    #   "image_size" → {"image_size": "2K", "aspect_ratio": "16:9"}
    # 后者是那份第三方技能包默认模板用的写法。写成配置项而不是写死，是因为
    # 这两家我们都要能打——首页参照板可以单独指到出图更大的那家（见
    # freeform_block._generate_overview_sheet_b64）。
    body_style: str = "size"
    aspect_ratio: str = "16:9"


def get_image_gen_config(prefix: str = "") -> ImageGenConfig | None:
    """三项全配才返回配置；缺任意一项返回 None（调用方按 fail-closed 处理）。

    prefix 允许同一套变量名开出第二份独立配置——传 "SHEET_" 就读
    SHEET_IMAGE_API_URL / SHEET_IMAGE_MODEL / SHEET_IMAGE_API_KEY。
    没配（或只配了一部分）返回 None，调用方回落到默认那份，行为与从前逐字节
    一致。**不内置任何服务商地址或 key**，这条纪律对带前缀的那份同样成立。
    """
    url = os.environ.get(f"{prefix}IMAGE_API_URL") or ""
    model = os.environ.get(f"{prefix}IMAGE_MODEL") or ""
    key = os.environ.get(f"{prefix}IMAGE_API_KEY") or ""
    if not (url and model and key):
        return None
    timeout = int(
        os.environ.get(f"{prefix}IMAGE_TIMEOUT_S") or os.environ.get("IMAGE_TIMEOUT_S") or DEFAULT_TIMEOUT_S
    )
    body_style = (os.environ.get(f"{prefix}IMAGE_BODY_STYLE") or "size").strip()
    if body_style not in ("size", "image_size"):
        body_style = "size"
    aspect_ratio = (os.environ.get(f"{prefix}IMAGE_ASPECT_RATIO") or "16:9").strip()
    return ImageGenConfig(
        url=url,
        model=model,
        key=key,
        timeout=timeout,
        body_style=body_style,
        aspect_ratio=aspect_ratio,
    )


def _build_body(cfg: ImageGenConfig, prompt: str, size: str) -> dict:
    """按服务商的请求体形态装配（见 ImageGenConfig.body_style）。"""
    body: dict = {
        "model": cfg.model,
        "prompt": prompt,
        "response_format": "b64_json",
        "n": 1,
    }
    if cfg.body_style == "image_size":
        body["image_size"] = size
        body["aspect_ratio"] = cfg.aspect_ratio
    else:
        body["size"] = size
    return body


def _total_budget_s() -> float:
    """整段生图（含重试与退避）的总时长上限，秒。<=0 表示不限。"""
    raw = (os.environ.get("IMAGE_TOTAL_BUDGET_S") or "").strip()
    if not raw:
        return float(DEFAULT_TOTAL_BUDGET_S)
    try:
        return max(0.0, float(raw))
    except ValueError:
        return float(DEFAULT_TOTAL_BUDGET_S)


def _transient(exc: Exception) -> bool:
    return isinstance(exc, urllib.error.HTTPError) and exc.code in (429, 500, 502, 503, 504)


def _png_from_payload(payload: dict, *, timeout: float) -> bytes:
    """从生图响应里取出图片字节——**两种形状都要认**。

    ## 为什么不能只认 b64_json

    请求体里明写了 `response_format: "b64_json"`，但 api.gpt.ge + gpt-image-2
    **不保证照办**。2026-08-13 实测，同一个尺寸（1024x1024）连着两次探测：
    第一次返回 `data[0].b64_json`，第二次返回 `data[0].url`。五个尺寸各探一次
    时全是 `url`。也就是说这不是"某些尺寸走 url"，是**同一路请求随机返两种**。

    只认 b64_json 的后果不是"报错好查"，是**随机失败**：整条链路上生图是
    fail-open 的（失败就静默退回纯文字设计），所以表现成"有时候有参照图、
    有时候没有"，而且没有任何一处会说为什么。

    ⚠ 这正是本仓那条老规矩的又一次兑现：**认不认某个参数是端点相关行为，
    换端点必须整份重测，别把旧结论当常量**。上一版客户端是对着上一家端点写的。
    """
    data = (payload or {}).get("data") or []
    if not data or not isinstance(data[0], dict):
        raise ImageGenError(f"生图响应里没有 data：{str(payload)[:200]}")
    item = data[0]
    b64 = item.get("b64_json")
    if b64:
        return base64.b64decode(b64)
    url = item.get("url")
    if url:
        # 图片托管在服务商那边，取一次。这一跳的超时跟生图请求共用同一个数——
        # 它本来就在同一段总预算里，单独给它一个更长的超时等于绕开预算闸。
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.read()
    raise ImageGenError(
        f"生图响应既没有 b64_json 也没有 url，拿到的字段是 {sorted(item.keys())}"
    )


def generate_image_png(
    prompt: str,
    *,
    cfg: ImageGenConfig | None = None,
    size: str = "1024x1024",
) -> bytes:
    """调生图接口，返回 PNG 原始字节。三项配置缺失或多次重试后仍失败均抛 ImageGenError。

    size 的含义跟着 cfg.body_style 走：默认 "size" 形态传 "1792x1024" 这种
    宽x高；"image_size" 形态传 "2K" 这种档位名（另配 aspect_ratio）。

    历史记录更正（2026-07-30）：这里原本写着"image_size/aspect_ratio 那套在
    /v1/images/generations 上会挂到 504"——那是对**上一个**端点的结论，当前
    端点上复测能正常返回（只是 aspect_ratio 被忽略）。换端点必须重测，别把
    旧结论当常量。
    """
    resolved = cfg or get_image_gen_config()
    if resolved is None:
        raise ImageGenError("IMAGE_API_KEY / IMAGE_API_URL / IMAGE_MODEL 未完整配置，生图能力不可用")

    body = _build_body(resolved, prompt, size)
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {resolved.key}"}

    # 总时长闸（见 DEFAULT_TOTAL_BUDGET_S）：单次超时只约束一次请求，约束不了
    # "重试 + 退避" 累计花掉多久。这里按整段计时，每次请求的超时再取
    # min(单次超时, 剩余预算)，退避前也先看还剩不剩得下。
    budget = _total_budget_s()
    started = time.monotonic()

    def _remaining() -> float:
        return float("inf") if budget <= 0 else budget - (time.monotonic() - started)

    last_exc: Exception | None = None
    for attempt in range(1, RETRIES + 1):
        remaining = _remaining()
        if remaining <= 0:
            break
        try:
            req = urllib.request.Request(
                resolved.url,
                data=json.dumps(body).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            per_call = resolved.timeout if budget <= 0 else min(resolved.timeout, remaining)
            with urllib.request.urlopen(req, timeout=per_call) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            return _png_from_payload(payload, timeout=per_call)
        except Exception as exc:  # noqa: BLE001 — 统一走下面的重试/包装逻辑
            last_exc = exc
            if attempt < RETRIES and _transient(exc):
                backoff = BACKOFF * attempt
                # 退避睡完就没预算发下一次请求的话，睡也白睡——直接收工。
                if _remaining() - backoff <= 0:
                    break
                time.sleep(backoff)
                continue
            break
    spent = time.monotonic() - started
    if budget > 0 and spent >= budget:
        raise ImageGenError(
            f"生图超出总时长预算 {budget}s（实耗 {spent:.0f}s，最后一次错误: {last_exc}）"
        )
    raise ImageGenError(f"生图失败（已重试 {RETRIES} 次，耗时 {spent:.0f}s）: {last_exc}")
