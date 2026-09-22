# -*- coding: utf-8 -*-
"""技能包字节：MinIO/S3 或本地 fs。叶子，只读环境变量。

S3_ENDPOINT=fs 或空 → slide-rule-python/data/skills-oss/
生产 python 容器走 http://minio:9000。
"""

from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

_DEFAULT_FS = Path(__file__).resolve().parent.parent / "data" / "skills-oss"


def blob_put(key: str, data: bytes) -> str:
    """写入，返回 sha256 hex。"""
    digest = hashlib.sha256(data).hexdigest()
    backend = _backend()
    if backend == "fs":
        path = _fs_root() / _safe_key(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return digest
    _s3_request("PUT", key, data=data)
    return digest


def blob_get(key: str) -> bytes:
    backend = _backend()
    if backend == "fs":
        path = _fs_root() / _safe_key(key)
        if not path.is_file():
            raise FileNotFoundError(key)
        return path.read_bytes()
    return _s3_request("GET", key)


def blob_exists(key: str) -> bool:
    try:
        if _backend() == "fs":
            return (_fs_root() / _safe_key(key)).is_file()
        _s3_request("HEAD", key)
        return True
    except FileNotFoundError:
        return False


def _backend() -> str:
    endpoint = (os.environ.get("S3_ENDPOINT") or "").strip()
    if not endpoint or endpoint.lower() in {"fs", "file", "local"}:
        return "fs"
    return "s3"


def _fs_root() -> Path:
    raw = (os.environ.get("S3_FS_ROOT") or "").strip()
    return Path(raw) if raw else _DEFAULT_FS


def _safe_key(key: str) -> str:
    name = (key or "").replace("\\", "/").lstrip("/")
    if not name or ".." in name.split("/"):
        raise ValueError("skill_blob_key_invalid")
    return name


def _s3_request(method: str, key: str, data: bytes | None = None) -> bytes:
    endpoint = (os.environ.get("S3_ENDPOINT") or "").rstrip("/")
    bucket = (os.environ.get("S3_BUCKET") or "sliderule-skills").strip()
    access = os.environ.get("S3_ACCESS_KEY") or ""
    secret = os.environ.get("S3_SECRET_KEY") or ""
    region = os.environ.get("S3_REGION") or "us-east-1"
    path = f"/{bucket}/{_safe_key(key)}"
    url = endpoint + path
    headers = _sigv4_headers(method, url, data or b"", access, secret, region)
    req = Request(url, data=data if method == "PUT" else None, method=method, headers=headers)
    try:
        with urlopen(req, timeout=30) as resp:
            if method == "HEAD":
                return b""
            return resp.read()
    except Exception as exc:
        code = getattr(getattr(exc, "code", None), "real", None) or getattr(exc, "code", None)
        if code in {404, 403} and method in {"GET", "HEAD"}:
            raise FileNotFoundError(key) from exc
        raise


def _sigv4_headers(
    method: str,
    url: str,
    body: bytes,
    access: str,
    secret: str,
    region: str,
) -> dict[str, str]:
    parsed = urlsplit(url)
    host = parsed.netloc
    path = parsed.path or "/"
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()
    canonical_headers = f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    signed = "host;x-amz-content-sha256;x-amz-date"
    canonical = (
        f"{method}\n{quote(path, safe='/~')}\n\n{canonical_headers}\n{signed}\n{payload_hash}"
    )
    scope = f"{datestamp}/{region}/s3/aws4_request"
    string_to_sign = (
        f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    )
    signing_key = _signing_key(secret, datestamp, region, "s3")
    signature = hmac.new(signing_key, string_to_sign.encode(), hashlib.sha256).hexdigest()
    return {
        "Host": host,
        "x-amz-date": amz_date,
        "x-amz-content-sha256": payload_hash,
        "Authorization": (
            f"AWS4-HMAC-SHA256 Credential={access}/{scope}, "
            f"SignedHeaders={signed}, Signature={signature}"
        ),
        "Content-Length": str(len(body)),
    }


def _signing_key(secret: str, datestamp: str, region: str, service: str) -> bytes:
    def _hmac(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode(), hashlib.sha256).digest()

    k_date = _hmac(("AWS4" + secret).encode(), datestamp)
    k_region = _hmac(k_date, region)
    k_service = _hmac(k_region, service)
    return _hmac(k_service, "aws4_request")
