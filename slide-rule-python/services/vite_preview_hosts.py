"""Platform Vite Host inject: wrap createServer, never patch Agent source.

2026-09-18 真机（allowlist + 156 sslip 中继）：worker 已经把中继 Host 写进
`__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`。Vite CLI 会把这个 env 并进
allowedHosts；Agent 写的 `server.mjs` 走 `createViteServer({ middlewareMode })`
不并。模板里补了 `viteAllowedHosts()`，但耐久源是创建时的拷贝，模型随后整文件
重写 `server.mjs`——改模板、改已有项目，下一轮还是没接。

⚠ 同日重启后仍拦：工程钉的是 Vite 7.3.6，`resolveServerOptions` 把整段 env
当成**一个** hostname 推进名单，并不按逗号拆。iframe 的 Host 是中继名，
env 却是 `中继,5173-*.e2b.app`，对不上。所以这个 env **只许放中继那一个**；
完整名单写在工程树外的 hosts.json，给 --import 钩子用。

⚠ 同日第三次真机：命令是 `export NODE_OPTIONS=--import=… && npm run dev`。
npm 自己就是 Node 进程，loader 套在 npm 上，真正执行 `node server.mjs` 的那
一发仍可能没套上。Vite 照样起来，照样回 Blocked request。启动改成直接
`node --import=register ./server.mjs`，并在 node:http 上把中继 Host 改成
127.0.0.1——Vite 默认放行 loopback，不依赖 Agent 有没有写 allowedHosts。

注入属于运行时：启动命令落下 `/home/user/.whybuddy/vite-allowed-hosts/`，
env 放行 iframe Host，node --import 包 createServer / http。Never set
allowedHosts=true，never take hosts from tool input.
"""

from __future__ import annotations

import json
import re
import shlex


INJECT_ROOT = "/home/user/.whybuddy/vite-allowed-hosts"
REGISTER_PATH = INJECT_ROOT + "/register.mjs"
HOOK_PATH = INJECT_ROOT + "/hook.mjs"
HOSTS_PATH = INJECT_ROOT + "/hosts.json"

_HOST = re.compile(
    r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$"
)
_NPM_DEV_PREFIX = "npm run dev -- "

REGISTER_SOURCE = """import { register } from 'node:module';

register(new URL('./hook.mjs', import.meta.url));
"""

# extraHosts is inlined into both wrappers: they are separate modules.
_EXTRA_HOSTS_JS = r"""
function extraHosts() {
  try {
    const listed = JSON.parse(readFileSync('/home/user/.whybuddy/vite-allowed-hosts/hosts.json', 'utf8'));
    if (Array.isArray(listed)) return listed.filter((host) => typeof host === 'string' && host);
  } catch {}
  const fromEnv = String(process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS || '').trim();
  return fromEnv ? [fromEnv] : [];
}
"""

HOOK_SOURCE = r"""const PREFIX = 'whybuddy-vite-hosts://wrap/?u=';

function isVitePackage(url) {
  try {
    const path = new URL(url).pathname.replace(/\\/g, '/');
    return path.endsWith('/node_modules/vite/dist/node/index.js')
      || path.endsWith('/node_modules/vite/index.js');
  } catch {
    return false;
  }
}

function wrapperSource(real) {
  return `
import { readFileSync } from 'node:fs';
import * as vite from ${JSON.stringify(real)};
export * from ${JSON.stringify(real)};
""" + _EXTRA_HOSTS_JS + r"""
function merge(config) {
  const extra = extraHosts();
  if (!extra.length) return config;
  const base = (config && typeof config === 'object') ? config : {};
  const server = { ...(base.server || {}) };
  if (server.allowedHosts === true) return config;
  const list = Array.isArray(server.allowedHosts) ? server.allowedHosts.slice() : [];
  for (const host of extra) {
    if (!list.includes(host)) list.push(host);
  }
  return { ...base, server: { ...server, allowedHosts: list } };
}
export const createServer = (config, ...rest) => vite.createServer(merge(config), ...rest);
const __wbDefault = vite.default;
export default (typeof __wbDefault === 'function')
  ? __wbDefault
  : { ...(__wbDefault || vite), createServer };
`;
}

function httpWrapperSource() {
  return `
import { readFileSync } from 'node:fs';
import * as http from 'node:http';
export * from 'node:http';
""" + _EXTRA_HOSTS_JS + r"""
function rewrite(req) {
  const extra = extraHosts();
  if (!extra.length || !req || !req.headers) return;
  const host = String(req.headers.host || '').split(':')[0];
  if (extra.includes(host)) req.headers.host = '127.0.0.1';
}
function wrapListener(fn) {
  if (typeof fn !== 'function') return fn;
  return function wrapped(req, res) { rewrite(req); return fn.call(this, req, res); };
}
export function createServer(options, listener) {
  if (typeof options === 'function') return http.createServer(wrapListener(options));
  return http.createServer(options, wrapListener(listener));
}
const __wbHttp = { ...http, createServer };
export default __wbHttp;
`;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('whybuddy-vite-hosts:')) {
    return { url: specifier, shortCircuit: true };
  }
  const parent = context.parentURL || '';
  if (parent.startsWith('whybuddy-vite-hosts:')) {
    return nextResolve(specifier, context);
  }
  if (specifier === 'node:http' || specifier === 'http') {
    return { url: PREFIX + encodeURIComponent('node:http'), shortCircuit: true };
  }
  const resolved = await nextResolve(specifier, context);
  if (isVitePackage(resolved.url)) {
    return { url: PREFIX + encodeURIComponent(resolved.url), shortCircuit: true };
  }
  return resolved;
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith('whybuddy-vite-hosts:')) return nextLoad(url, context);
  const marker = '?u=';
  const index = url.indexOf(marker);
  const real = decodeURIComponent(index >= 0 ? url.slice(index + marker.length) : '');
  if (!real) throw new Error('whybuddy_vite_host_wrap_missing');
  const source = real === 'node:http' ? httpWrapperSource() : wrapperSource(real);
  return { format: 'module', shortCircuit: true, source };
}
"""


def validate_preview_hosts(hosts: list[str]) -> list[str]:
    if not hosts:
        raise ValueError("project_preview_origin_invalid")
    cleaned: list[str] = []
    for host in hosts:
        if not isinstance(host, str) or not _HOST.fullmatch(host) or "*" in host:
            raise ValueError("project_preview_origin_invalid")
        if host not in cleaned:
            cleaned.append(host)
    return cleaned


def install_preview_vite_hosts_command(hosts: list[str]) -> str:
    extra = validate_preview_hosts(hosts)
    script = (
        "import pathlib\n"
        f"root = pathlib.Path({INJECT_ROOT!r})\n"
        "root.mkdir(parents=True, exist_ok=True)\n"
        f"(root / 'register.mjs').write_text({REGISTER_SOURCE!r}, encoding='utf-8')\n"
        f"(root / 'hook.mjs').write_text({HOOK_SOURCE!r}, encoding='utf-8')\n"
        f"(root / 'hosts.json').write_text({json.dumps(extra, separators=(',', ':'))!r}, encoding='utf-8')\n"
    )
    return "python3 -I -S -c " + shlex.quote(script)


def _dev_flags(server_command: str) -> str:
    if server_command.startswith(_NPM_DEV_PREFIX):
        return server_command[len(_NPM_DEV_PREFIX):].strip()
    return "--host 0.0.0.0 --port 5173 --strictPort"


def injected_preview_dev_command(server_command: str, hosts: list[str]) -> str:
    """Prefix the sandbox Vite start so createServer sees the relay Host."""
    extra = validate_preview_hosts(hosts)
    # Vite 7.3.6: this env is one hostname. Comma-join never matches Host.
    env_host = extra[0]
    flags = _dev_flags(server_command)
    register = shlex.quote(REGISTER_PATH)
    # Direct node --import. NODE_OPTIONS + npm run was the third live miss:
    # npm is a Node process and ate the loader.
    node_direct = f"node --import={register} ./server.mjs --dev {flags}".rstrip()
    npm_fallback = (
        f"export NODE_OPTIONS={shlex.quote('--import=' + REGISTER_PATH)} && "
        f"{server_command}"
    )
    return (
        f"{install_preview_vite_hosts_command(extra)} && "
        f"export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS={shlex.quote(env_host)} && "
        f"if [ -f ./server.mjs ]; then {node_direct}; else {npm_fallback}; fi"
    )
