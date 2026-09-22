"""工程预览网关配置体检：**缺哪一项就说哪一项**。

## 为什么要它（2026-09-14）

真机跑通工程链路之后，右栏预览永远是同一句：

    工程预览当前不可用
    工程预览尚未配置独立预览域名、网关密钥或其他必要参数。

这句话**没法据以行动**——六个环境变量里缺哪个、哪个写错了，一个字都没说。
服务端把它们折叠成了一个 `project_preview_not_configured`。

这个脚本**直接调产线那几个校验函数**（不重抄一份判断，§4：重抄的体检只能
证明「我抄对了」），把每一项的真实结论打出来。

    slide-rule-python/.venv/bin/python scripts/project-preview-doctor.py

## 它不做什么

不改配置、不写文件、不连网。它只回答「照现在的环境变量，服务端会不会认为
预览已配置」，以及不认的话卡在哪一条。
"""
from __future__ import annotations

import os
import pathlib
import urllib.error
import urllib.request
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "slide-rule-python"))

# ⚠ 必须跟 `scripts/dev-all.mjs` 用同一套注入方式，否则体检结果跟真正在跑的
#   服务端对不上：这几个变量是 `os.getenv` 读的**进程环境**，而 dev-all 启动时
#   用 dotenv override:true 把根 .env 灌进进程环境。不灌就会全报「未设置」，
#   把一个环境问题误诊成配置问题。
try:
    from dotenv import load_dotenv

    _ENV = ROOT / ".env"
    _LOADED = load_dotenv(_ENV, override=True) if _ENV.exists() else False
except Exception:  # pragma: no cover - dotenv 缺席时按纯进程环境体检
    _LOADED = False

from services.project_preview_config import (  # noqa: E402
    gateway_key,
    origin_for_runtime,
    preview_configuration_enabled,
)
from services.project_rollout import rollout_readiness  # noqa: E402

OK, BAD, WARN = "  ok  ", " 缺/错 ", " 注意 "


def line(mark: str, name: str, detail: str) -> None:
    print(f"[{mark}] {name:46} {detail}")


def check_gateway_key() -> bool:
    raw = os.getenv("WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", "")
    try:
        gateway_key()
    except ValueError as exc:
        line(BAD, "WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY",
             f"{exc}（当前长度 {len(raw)}，要求 32~4096 个可打印 ASCII）")
        return False
    line(OK, "WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", f"长度 {len(raw)}")
    return True


def check_origin() -> bool:
    template = os.getenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "")
    try:
        # 用产线那个探针 id，跟 preview_configuration_enabled 完全一致。
        resolved = origin_for_runtime("rt-configuration-probe")
    except ValueError as exc:
        line(BAD, "WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", f"{exc}；当前值 {template!r}")
        print("       · 必须正好含一个 {runtimeId}，且它要占**主机名第一个标签**")
        print("       · https 任意域名；http 只在主机名以 .localhost 结尾时放行")
        print("       · 不许带路径/查询/账号密码；端口 1~65535")
        return False
    line(OK, "WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", f"探针解析为 {resolved}")
    return True


def check_gateway_process_env() -> None:
    """网关进程自己要的那几个（`server/project-preview/main.ts`）。

    ⚠ 这几个**不在 Python 侧校验**——它们喂的是 Node 网关进程。这里只提示，
      不计入「服务端认不认」。
    """
    # ⚠ 这几项按文档是写在 `.env.preview` 里的（网关用 `--env-file` 自己读），
    #   **不在根 .env**。只看进程环境会把它们全报成「缺」——体检脚本里的假警报
    #   比没有检查更糟：会让人去补一份本来就不该补的配置。所以两处都看。
    gateway_env = _read_env_file(pathlib.Path(__file__).resolve().parents[1] / ".env.preview")
    for name, default, why in (
        ("WHYBUDDY_PROJECT_PREVIEW_AUTHORITY_URL", "", "网关回头找 Python 做授权校验的地址"),
        ("WHYBUDDY_PROJECT_PREVIEW_PORT", "3002", "网关监听端口"),
        ("WHYBUDDY_PROJECT_PREVIEW_PUBLIC_PROTOCOL", "https:", "对外协议；本地 .localhost 要写 http:"),
        ("WHYBUDDY_PROJECT_WORKBENCH_ORIGIN", "", "工作台来源，用于隔离校验"),
    ):
        value = os.getenv(name, "")
        source = "进程环境"
        if not value and gateway_env.get(name):
            value, source = gateway_env[name], ".env.preview"
        if value:
            line(OK, name, f"{value}    （来自 {source}）")
            # ⚠ 2026-09-16：授权地址光「有值」不算数。网关自己会校验它
            #   （createPreviewService → preview_authority_https_required）：
            #   http: 只放行回环，写成 compose 服务名（`http://python:9700/...`）
            #   网关**一起来就抛**，日志里是个跟"预览打不开"字面无关的 config 错。
            #   体检不替它判合法性，只把这条最容易踩的形态点出来。
            if name == "WHYBUDDY_PROJECT_PREVIEW_AUTHORITY_URL":
                from urllib.parse import urlsplit

                parts = urlsplit(value)
                host = parts.hostname or ""
                if parts.scheme == "http" and host not in {"localhost", "127.0.0.1", "::1"}:
                    line(BAD, "  ↑ 网关收不下", (
                        f"http: + 非回环主机 {host!r}：网关启动时抛 "
                        "preview_authority_https_required。容器里请给 https 地址"
                        "（通常就是工作台自己 https://域名/api/sliderule/internal/project-preview）。"
                    ))
        elif default:
            line(WARN, name, f"未设置，网关会用默认 {default!r} —— {why}")
        else:
            line(BAD, name, f"未设置 —— {why}")


def _read_env_file(path: pathlib.Path) -> dict:
    """读一份 dotenv。只认 `KEY=VALUE`，不展开变量——这里是体检不是加载器。"""
    out = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line_ = raw.strip()
        if not line_ or line_.startswith("#") or "=" not in line_:
            continue
        key, _, value = line_.partition("=")
        out[key.strip()] = value.strip()
    return out


def check_two_sides_share_one_key() -> None:
    """Python 发票、网关兑票，用的必须是**同一把** key。

    ⚠ 这是 §4 那种成对物里最阴的一种：两边各自都「配好了」，值却不一样。
      Python 照常发票、界面照常显示「预览就绪」，用户一点——网关兑不出来。
      不报配置错误，只是打不开；查起来会往隧道那边找半天。
      所以单独钉一条：只比对是否相等，两边的值都不打印。
    """
    root = pathlib.Path(__file__).resolve().parents[1]
    gateway_env = _read_env_file(root / ".env.preview")
    if not gateway_env:
        line(WARN, "两侧 key 一致性", "没有 .env.preview——网关进程没在本机按文档方式配置，跳过比对")
        return
    theirs = gateway_env.get("WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", "")
    ours = os.getenv("WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", "")
    if not theirs:
        line(BAD, "两侧 key 一致性", ".env.preview 里没填 WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY")
    elif not ours:
        line(BAD, "两侧 key 一致性", "Python 侧没有 key，无从比对")
    elif theirs == ours:
        line(OK, "两侧 key 一致性", "Python 与 .env.preview 用的是同一把（值不回显）")
    else:
        line(BAD, "两侧 key 一致性",
             "两边的 key **不一样**——票会发出去但兑不出来，界面只会「打不开」，不报配置错")


def check_gateway_is_listening() -> None:
    """网关进程在不在。

    ⚠ 判据是「未授权访问要被拒」而不是「端口通」：端口上蹲着别的东西也会连上，
      而那种情况下预览同样打不开，却比没进程更难查。403/401 才证明是它。
    """
    port = os.getenv("WHYBUDDY_PROJECT_PREVIEW_PORT", "") or "3002"
    url = f"http://127.0.0.1:{port}/"
    try:
        request = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(request, timeout=5) as response:
            code = response.status
    except urllib.error.HTTPError as exc:
        code = exc.code
    except Exception as exc:  # 连不上
        line(BAD, f"网关进程 :{port}", f"连不上（{type(exc).__name__}）——`pnpm run dev:project-preview` 起了吗")
        return
    if code in (401, 403):
        line(OK, f"网关进程 :{port}", f"在，且未授权访问被拒（HTTP {code}）")
    else:
        line(WARN, f"网关进程 :{port}",
             f"端口有响应但返回 HTTP {code}——未授权请求本该 401/403，确认蹲在这个端口上的是网关")


def main() -> int:
    print("工程预览网关体检（只读，不改任何配置）")
    print(f"  环境来源：{'根 .env 已注入进程环境（同 dev-all）' if _LOADED else '仅当前进程环境（没找到 .env）'}\n")
    print("── Python 侧：决定界面上那句「尚未配置」出不出 ──")
    ok_key = check_gateway_key()
    ok_origin = check_origin()
    enabled = preview_configuration_enabled()
    line(OK if enabled else BAD, "preview_configuration_enabled()", str(enabled))
    if enabled != (ok_key and ok_origin):
        line(WARN, "一致性", "单项结论与总开关不一致，产线校验可能已变，先读源码")

    print("\n── Node 网关进程侧（`server/project-preview/main.ts`）──")
    check_gateway_process_env()
    check_two_sides_share_one_key()
    check_gateway_is_listening()

    print("\n── rollout ──")
    status = rollout_readiness()
    line(OK if status["configured"] else BAD, "rollout_readiness",
         f"mode={status['mode']} configured={status['configured']} blockers={status['blockers']}")

    print("\n── 还差的那一步，脚本查不了 ──")
    print("  隧道 agent 跑在 E2B 沙盒里**往外拨**到 relay（server/project-preview/agent-main.ts），")
    print("  所以 relay 必须从沙盒公网可达，而且域名要能给每个 runtimeId 一个子域。")
    print("  纯本机 http://{runtimeId}.localhost:PORT 只够让 Python 侧认，")
    print("  沙盒连不上它——预览仍然打不开。真要通，需要通配符 DNS + TLS 指向 relay。")
    return 0 if enabled else 1


if __name__ == "__main__":
    raise SystemExit(main())
