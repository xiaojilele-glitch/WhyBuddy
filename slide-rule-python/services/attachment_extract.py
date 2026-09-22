"""attachment_extract — E31 附件内容提取管线（E28 第 3 条的下一期）。

用户上传图片/PDF 附件时把内容提取成文本上下文，随消息注入推演指令。
两条提取路线，各自独立、失败如实：

  - 图片（png/jpg/webp/gif）→ base64 content parts 走视觉 LLM 提取
    （活体探针 2026-07-17：blackaicoding gpt-5.5 视觉可用，实测正确
    识图）。需要 LLM_SUPPORTS_IMAGE_CONTENT_PARTS=1 声明通道支持——
    未声明时 fail-closed 返回人话原因，绝不盲发二进制给不支持的通道。
  - PDF → E2B 一次性沙盒 pypdf 提取文本（宿主零执行，与 code.run 同
    一信任层口径；沙盒跑完即 kill）。文本超预算 → LLM 蒸馏成推演上下
    文；蒸馏失败 → 如实截断注明。无文本层（扫描件）→ 如实说明。

诚实边界：任何一步失败都返回 ok=False + 人话 detail，前端退回
「仅随消息带文件名」，不粉饰成"已解析"。
"""

from __future__ import annotations

import base64
import os
from typing import Any, Optional

from sliderule_llm.config import default_max_tokens

# 与前端 ComposerDock 的注入预算同口径（MAX_CHARS_PER_ATTACHMENT=6000）
MAX_CONTEXT_CHARS = 6000
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_PDF_BYTES = 15 * 1024 * 1024
_PDF_RAW_CAP = 24000  # 沙盒提取原文上限（蒸馏输入预算）
_SANDBOX_TIMEOUT_S = 90

IMAGE_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _ext_of(name: str) -> str:
    name = (name or "").strip().lower()
    dot = name.rfind(".")
    return name[dot:] if dot >= 0 else ""


def classify_attachment(name: str) -> Optional[str]:
    """按扩展名分路：image / pdf / None（其他类型走前端文本注入或只带名）。"""
    ext = _ext_of(name)
    if ext in IMAGE_MIME_BY_EXT:
        return "image"
    if ext == ".pdf":
        return "pdf"
    return None


def _fail(detail: str) -> dict[str, Any]:
    return {"ok": False, "detail": detail, "context": ""}


def _ok(context: str, note: str = "") -> dict[str, Any]:
    context = (context or "").strip()
    if len(context) > MAX_CONTEXT_CHARS:
        context = context[:MAX_CONTEXT_CHARS] + "\n…（内容过长已截断）"
    return {"ok": True, "context": context, "detail": note, "chars": len(context)}


# ── 图片：视觉 LLM ───────────────────────────────────────────────────────


def extract_image(name: str, data: bytes) -> dict[str, Any]:
    if len(data) > MAX_IMAGE_BYTES:
        return _fail(f"图片过大（>{MAX_IMAGE_BYTES // 1024 // 1024}MB），未解析")
    from sliderule_llm.config import get_llm_config

    cfg = get_llm_config()
    if not cfg.api_key:
        return _fail("LLM 通道未配置（无 API key），图片未解析")
    if not cfg.supports_image_content_parts:
        return _fail(
            "当前 LLM 通道未声明支持图片输入"
            "（设 LLM_SUPPORTS_IMAGE_CONTENT_PARTS=1 开启）"
        )
    mime = IMAGE_MIME_BY_EXT.get(_ext_of(name), "image/png")
    b64 = base64.b64encode(data).decode()
    messages = [
        {
            "role": "system",
            "content": (
                "你是产品推演引擎的附件解析器。用户上传了一张图片作为推演"
                "输入的补充材料。把图片里的全部可读信息提取成中文文本："
                "文字逐字抄录；界面/图表/流程图描述其结构与要素；照片描述"
                "关键内容。只输出提取结果本身，不加寒暄或评论。"
            ),
        },
        {
            "role": "user",
            "content": [
                {"type": "text", "text": f"附件文件名：{name}。请提取这张图片的内容。"},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            ],
        },
    ]
    try:
        from sliderule_llm.client import call_llm

        result = call_llm(messages, max_tokens=default_max_tokens())
    except Exception as e:  # LlmError 或连接层异常，一律如实
        return _fail(f"视觉 LLM 提取失败：{e}")
    text = (result.content or "").strip()
    if not text:
        return _fail("视觉 LLM 返回空内容，图片未解析")
    return _ok(text)


# ── PDF：E2B 沙盒 pypdf 提取（+ 超长 LLM 蒸馏）──────────────────────────


def _pdf_sandbox_extract(data: bytes) -> dict[str, Any]:
    """沙盒创建单独成函数：测试 monkeypatch 这里（与 mcp_tools._e2b_sandbox
    同一手法）。返回 {"text": str} 或 {"error": str}。"""
    from e2b_code_interpreter import Sandbox

    sandbox = Sandbox.create(timeout=_SANDBOX_TIMEOUT_S + 30)
    try:
        sandbox.files.write("/tmp/doc.pdf", data)
        code = (
            "import subprocess, sys\n"
            "try:\n"
            "    import pypdf\n"
            "except ImportError:\n"
            "    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'pypdf'],"
            " check=True, capture_output=True)\n"
            "    import pypdf\n"
            "reader = pypdf.PdfReader('/tmp/doc.pdf')\n"
            "parts = []\n"
            "total = 0\n"
            f"cap = {_PDF_RAW_CAP}\n"
            "for page in reader.pages:\n"
            "    t = page.extract_text() or ''\n"
            "    parts.append(t)\n"
            "    total += len(t)\n"
            "    if total >= cap:\n"
            "        break\n"
            "print('\\n'.join(parts)[:cap])\n"
        )
        execution = sandbox.run_code(code, timeout=_SANDBOX_TIMEOUT_S)
        error = getattr(execution, "error", None)
        if error is not None:
            return {"error": f"{error.name}: {error.value}"[:300]}
        logs = getattr(execution, "logs", None)
        stdout = "".join(getattr(logs, "stdout", None) or [])
        return {"text": stdout}
    finally:
        try:
            sandbox.kill()
        except Exception:
            pass  # 回收失败不挡结果（E2B 侧 timeout 兜底销毁）


def _distill_with_llm(name: str, raw: str) -> Optional[str]:
    """超预算原文 → LLM 蒸馏成推演上下文；失败返回 None（调用方截断兜底）。"""
    try:
        from sliderule_llm.client import call_llm

        result = call_llm(
            [
                {
                    "role": "system",
                    "content": (
                        "你是产品推演引擎的附件解析器。把用户上传文档的原文"
                        "蒸馏成推演上下文：保留关键事实、需求、约束、数字与"
                        "结论，删客套与排版噪音。中文输出，不超过 2000 字，"
                        "只输出蒸馏结果本身。"
                    ),
                },
                {"role": "user", "content": f"文档《{name}》原文：\n\n{raw}"},
            ],
            max_tokens=default_max_tokens(),
        )
        text = (result.content or "").strip()
        return text or None
    except Exception:
        return None


def extract_pdf(name: str, data: bytes) -> dict[str, Any]:
    if len(data) > MAX_PDF_BYTES:
        return _fail(f"PDF 过大（>{MAX_PDF_BYTES // 1024 // 1024}MB），未解析")
    if not (os.getenv("E2B_API_KEY") or "").strip():
        return _fail("E2B 沙盒未配置（无 API key），PDF 未解析")
    try:
        outcome = _pdf_sandbox_extract(data)
    except Exception as e:
        return _fail(f"沙盒提取失败：{e}")
    if outcome.get("error"):
        return _fail(f"PDF 解析失败：{outcome['error']}")
    raw = (outcome.get("text") or "").strip()
    if not raw:
        return _fail("PDF 无可提取文本层（可能是扫描件），未解析")
    if len(raw) <= MAX_CONTEXT_CHARS:
        return _ok(raw)
    distilled = _distill_with_llm(name, raw[:_PDF_RAW_CAP])
    if distilled:
        return _ok(distilled, note="原文超预算，已 LLM 蒸馏")
    return _ok(raw, note="原文超预算且蒸馏失败，已截断")


# ── 统一入口 ─────────────────────────────────────────────────────────────


def extract_attachment(name: str, data: bytes) -> dict[str, Any]:
    """按类型分路提取。返回 {"ok", "kind", "context", "detail", "chars"}。"""
    kind = classify_attachment(name)
    if kind is None:
        return {**_fail("暂不支持该类型的内容提取（文本类附件由前端直接注入）"), "kind": "other"}
    if not data:
        return {**_fail("空文件"), "kind": kind}
    result = extract_image(name, data) if kind == "image" else extract_pdf(name, data)
    return {**result, "kind": kind}
