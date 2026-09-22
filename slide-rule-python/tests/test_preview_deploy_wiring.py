"""预览链路的部署配置：Caddy、compose、Python 三者必须对得上。

## 这条判据来自一次真机 502（2026-09-16）

    https://rt-probe.preview.156.239.47.108.sslip.io/  → 502

502 恰恰证明**前三关都通了**：通配符 DNS 解析到了、on-demand TLS 给一个
从没见过的子域当场签了证书、vhost 路由也命中了——它是反代那一步才失败的。
失败原因是 Caddy 反代 `172.18.0.1:3002`（宿主网桥网关），而 compose 里的
project-preview 发布在 `127.0.0.1:3002`：**宿主回环上的监听收不到从网桥
网关来的流量**。两套拓扑并存，哪套都不成立。

⚠ 这种坏法完全静默：Caddy 起得来、网关容器起得来、Python 起得来，
  每一件单看都健康，只有用户点「打开预览」时打不开。仓里当时
  **没有任何判据覆盖部署配置**，所以它可以一直躺着。

这份判据钉三件事，任何一件漂了就红。
"""

from __future__ import annotations

import pathlib
import re

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
CADDYFILE = ROOT / "caddy" / "Caddyfile"
COMPOSE = ROOT / "docker-compose.project.yml"


def _preview_vhost() -> str:
    """Caddyfile 里 `*.preview.*` 那个站点块。"""
    text = CADDYFILE.read_text(encoding="utf-8")
    start = text.index("*.preview.")
    # 站点块从第一个 `{` 到与之配对的 `}`
    brace = text.index("{", start)
    depth, index = 0, brace
    while index < len(text):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
        index += 1
    raise AssertionError("预览站点块没有闭合")


def _services() -> dict:
    return yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]


def test_caddy_反代的是一个真的存在的服务名():
    """⚠ 这是那次 502 的直接原因。"""
    vhost = _preview_vhost()
    match = re.search(r"reverse_proxy\s+(\S+)", vhost)
    assert match, f"预览站点块里没有 reverse_proxy：{vhost}"
    upstream = match.group(1)
    host, _, port = upstream.rpartition(":")
    assert port == "3002", f"预览网关端口应为 3002，实际 {upstream}"
    services = _services()
    assert host in services, (
        f"Caddy 反代 {upstream}，但 docker-compose.project.yml 里没有叫 {host} 的服务。"
        f"现有服务：{sorted(services)}。"
        "⚠ 写成宿主 IP（比如 172.18.0.1）时这条会红——那正是 2026-09-16 那次 502："
        "容器里的 Caddy 打不到宿主回环上的监听。"
    )


def test_两侧的网关key引用同一个变量():
    """Python 发票、网关兑票，用的必须是同一把。

    ⚠ 两边各配各的是最阴的坏法：票照发、界面照常显示就绪，兑票时静默失败。
      在 compose 里引用**同一个变量名**，就从源头上不可能配歪。
    """
    services = _services()
    key = "WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY"
    python_env = services["python"]["environment"]
    gateway_env = services["project-preview"]["environment"]
    assert key in python_env, (
        f"python 服务没有 {key}——Python 侧 os.getenv 读不到，"
        "preview_configuration_enabled() 会是 False，界面停在「尚未配置」，"
        "而网关侧照样起得来。"
    )
    assert key in gateway_env, f"project-preview 服务没有 {key}"
    assert python_env[key] == gateway_env[key], (
        "两侧必须引用同一个 ${...} 表达式，才能保证是同一把 key；"
        f"现在 python={python_env[key]!r} gateway={gateway_env[key]!r}"
    )


def test_python侧拿得到来源模板():
    """`origin_for_runtime()` 少了它就抛 project_preview_origin_not_configured。"""
    python_env = _services()["python"]["environment"]
    name = "WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE"
    assert name in python_env, (
        f"python 服务没有 {name}。它是 os.getenv 读的，只靠 env_file 间接给"
        "会在 .env 漏填时静默退回「尚未配置」。"
    )
    assert "{runtimeId}" in python_env[name] or python_env[name].startswith("${"), (
        f"{name} 必须是含 {{runtimeId}} 的模板或一个 ${{...}} 引用，实际 {python_env[name]!r}"
    )


def test_预览不许绕过TLS入口直接裸露():
    """⚠ publish 必须绑回环。绑 0.0.0.0 等于把生成应用直接挂公网，
    绕过 Caddy 的 TLS 与 on-demand 证书那一层。"""
    ports = _services()["project-preview"].get("ports") or []
    for entry in ports:
        assert str(entry).startswith("127.0.0.1:"), (
            f"project-preview 的 publish 必须绑 127.0.0.1，实际 {entry!r}"
        )


def test_镜像构建必须把预览来源传进前端():
    """CSP 的 frame-src 是**编译期**定死的，构建拿不到就等于没有。

    ⚠ 2026-09-16 线上抓到：新镜像里 CSP 是 `frame-src 'self'`，
      因为 `WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE` 从来没进过构建环境。
      链路是 vite.config.ts 用 loadEnv 读它 → 算出允许的 iframe 来源 →
      transformIndexHtml 塞进 <head>。Dockerfile 不接、workflow 不传，
      这一段就永远拿到空值。

      后果**不是 502**（那是网关没接通）——网关通了、地址也对，
      但浏览器按 CSP 把 iframe 拦掉，表现成「预览就是打不开」，更难查。
      三处缺任何一处都会退回这个形态，所以三处一起钉。
    """
    name = "WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE"

    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert f"ARG {name}" in dockerfile, f"Dockerfile 没有 ARG {name}"
    assert f"ENV {name}" in dockerfile, (
        f"Dockerfile 有 ARG 但没转成 ENV——ARG 不会进 `pnpm run build` 的进程环境，"
        "loadEnv 读不到（这一半最容易漏）"
    )
    build_at = dockerfile.index("RUN pnpm run build")
    assert dockerfile.index(f"ENV {name}") < build_at, (
        f"ENV {name} 必须在 `RUN pnpm run build` **之前**，否则构建时还没有它"
    )

    workflow = (ROOT / ".github" / "workflows" / "deploy-images.yml").read_text(encoding="utf-8")
    assert "build-args:" in workflow, "workflow 没有 build-args，ARG 收不到值"
    assert name in workflow, f"workflow 的 build-args 里没有 {name}"


def test_网关key不许进前端构建():
    """⚠ 反向：前端是公开产物，网关 key 是凭据，绝不许被传进构建。

    上一条要求把预览来源传进去，很容易顺手把整组 WHYBUDDY_PROJECT_PREVIEW_*
    一起传——那就把 key 编进了公开的静态包。
    """
    for path in (ROOT / "Dockerfile", ROOT / ".github" / "workflows" / "deploy-images.yml"):
        text = path.read_text(encoding="utf-8")
        assert "WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY" not in text, (
            f"{path.name} 里出现了网关 key——它不许进前端构建"
        )


# ---------------------------------------------------------------------------
# 网关授权地址：仓里发的那份必须是网关自己收得下的
#
# ⚠ 2026-09-16 线上抓到的第二处。compose 里写死
#     WHYBUDDY_PROJECT_PREVIEW_AUTHORITY_URL: http://python:9700/api/sliderule/internal/project-preview
#   而网关 createPreviewService 第一件事就是校验它：http: 只放行
#   localhost / 127.0.0.1 / [::1]。`python` 是 compose 服务名，于是
#   **网关一起来就抛 preview_authority_https_required**。
#
#   这是「生成侧 / 消费侧」那一对（CLAUDE.md §4）的又一例：发配置的那侧
#   和收配置的那侧各写各的，谁都没错，合起来起不来。而且报的错跟
#   「预览打不开」字面上毫无关系，用户侧只看得到 502 / 一直转圈。
#
#   这条判据不重抄那条规则——**从 service.ts 源码里把白名单取出来再套**。
#   重抄只能证明"我抄对了"（§一之二）；取出来则是：谁改宽了 service.ts，
#   这里跟着变宽，谁改窄了这里跟着变窄。
# ---------------------------------------------------------------------------

GATEWAY_SERVICE = ROOT / "server" / "project-preview" / "service.ts"
AUTHORITY_VAR = "WHYBUDDY_PROJECT_PREVIEW_AUTHORITY_URL"


def _gateway_http_hosts() -> list[str]:
    """从网关源码里取出「http: 还放行哪些 host」。"""
    text = GATEWAY_SERVICE.read_text(encoding="utf-8")
    assert "preview_authority_https_required" in text, (
        "网关里找不到 preview_authority_https_required 了。"
        "校验要是挪了位置/改了名，这条判据也得跟着重写——别直接删。"
    )
    match = re.search(
        # ⚠ 非贪婪到 `].includes(` 为止，别写成 `[^\]]*`：白名单里的
        #   `"[::1]"` 自带一个 `]`，字符类版本会在那里就断掉，
        #   结果整条规则认不出来（第一版就是这么红的）。
        r'authority\.protocol === "http:" && !\[(.*?)\]\.includes\(authority\.hostname\)',
        text,
    )
    assert match, (
        "没在 service.ts 里认出 http: 的 host 白名单。"
        "校验改形状了，这条判据必须跟着改，不许靠重抄一份规则蒙混过去。"
    )
    return re.findall(r'"([^"]+)"', match.group(1))


def _gateway_accepts_authority(url: str) -> bool:
    """按网关自己的规则判一个授权地址收不收。"""
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"}:
        return False
    if parts.scheme != "http":
        return True
    host = parts.hostname or ""
    # ⚠ 别删这两行。JS 的 WHATWG URL 里 IPv6 的 `hostname` **带方括号**
    #   （`new URL("http://[::1]/").hostname === "[::1]"`），Python 的
    #   urlsplit 则把方括号剥掉给 `"::1"`。不补回来，白名单里的 `[::1]`
    #   就永远匹配不上，这条判据会把一个网关其实收得下的地址判成红。
    if ":" in host:
        host = f"[{host}]"
    return host in _gateway_http_hosts()


def test_仓里发的网关授权地址网关自己收得下():
    gateway_env = _services()["project-preview"]["environment"]
    assert AUTHORITY_VAR in gateway_env, f"project-preview 服务没有 {AUTHORITY_VAR}"
    value = str(gateway_env[AUTHORITY_VAR])

    if value.startswith("${"):
        # 交给部署方给值。那就必须是**必填**（`:?`），不许给一个默认值——
        # 默认值等于又把一份可能被拒的地址发出去了，而且是静默的。
        assert ":?" in value, (
            f"{AUTHORITY_VAR} 交给部署方时必须写成 ${{...:?说明}}（必填），"
            f"实际 {value!r}。给默认值 = 发一份网关可能拒收的地址，"
            "而部署方不会知道自己漏填了。"
        )
        return

    assert _gateway_accepts_authority(value), (
        f"compose 发的 {AUTHORITY_VAR}={value!r} 会被网关自己拒掉"
        f"（http: 只放行 {_gateway_http_hosts()}），网关一起来就抛 "
        "preview_authority_https_required。这正是 2026-09-16 那次："
        "写的是 http://python:9700/...，`python` 是服务名不是回环。"
    )


def test_那条规则确实会咬住服务名形态():
    """反向（§3）：证明上面那条判据不是空转。

    ⚠ 判据本身要能被变异咬住（§2）。这里直接喂真机当时那一发的原样值。
    """
    assert not _gateway_accepts_authority(
        "http://python:9700/api/sliderule/internal/project-preview"
    ), "服务名 + http: 居然被判成可收——白名单取错了，上面那条判据是空转的"
    assert _gateway_accepts_authority(
        "https://miantuan.ai/api/sliderule/internal/project-preview"
    )
    assert _gateway_accepts_authority(
        "http://127.0.0.1:9700/api/sliderule/internal/project-preview"
    ), ".env.preview.example 走的就是这条（网关跑在宿主上），不许误伤"


def test_本地网关样例也过同一条规则():
    """`.env.preview.example` 是另一套拓扑（网关直接跑在宿主），
    但收它的是同一个 createPreviewService，所以过同一把尺。"""
    sample = (ROOT / ".env.preview.example").read_text(encoding="utf-8")
    match = re.search(rf"^{AUTHORITY_VAR}=(.+)$", sample, re.MULTILINE)
    assert match, f".env.preview.example 里没有 {AUTHORITY_VAR}"
    value = match.group(1).strip()
    assert _gateway_accepts_authority(value), (
        f".env.preview.example 发的 {value!r} 会被网关拒掉"
    )
