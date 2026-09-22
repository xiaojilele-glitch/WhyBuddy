"""Real E2B private ingress: authenticated HTTP/WS, reconnect, credential stripping.

This is provider transport validation, not the planned gateway, user authorization,
Studio preview, or browser/HMR acceptance. The test server returns only credential
header names and header-value hashes; no raw credentials enter reports or logs.
One unique sandbox is discovered and destroyed in finally, even if create loses
its response. Missing key is blocked. Cleanup failure makes the smoke fail.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "slide-rule-python"))

from dotenv import dotenv_values
import httpx
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect as websocket_connect
from e2b_code_interpreter import Sandbox

from services.e2b_workspace_provider import E2BWorkspaceProvider
from services.workspace_provider import WorkspaceProviderError

PORT = 5187
PROTOCOL = "whybuddy-private-ingress-smoke"
SERVER = r'''
import http from 'node:http';
import crypto from 'node:crypto';
const marker = process.argv[2];
const forbidden = new Set(['e2b-traffic-access-token', 'x-access-token', 'authorization', 'x-api-key']);
const inspect = req => ({marker,
  credentialHeaderNames: Object.keys(req.headers).filter(name => forbidden.has(name.toLowerCase())),
  valueDigests: Object.values(req.headers).flat().filter(x => typeof x === 'string')
    .map(value => crypto.createHash('sha256').update(value).digest('hex'))});
const server = http.createServer((req,res) => {
  res.writeHead(200, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
  res.end(JSON.stringify({...inspect(req), path:req.url}));
});
function frame(text, opcode=1) {
  const body = Buffer.from(text);
  if(body.length > 65535) throw new Error('fixture_frame_too_large');
  const head = Buffer.alloc(body.length < 126 ? 2 : 4);
  head[0] = 0x80 | opcode;
  if(body.length < 126) head[1]=body.length;
  else {head[1]=126; head.writeUInt16BE(body.length,2);}
  return Buffer.concat([head,body]);
}
server.on('upgrade',(req,socket,head) => {
  if(req.url !== '/socket' || req.headers['sec-websocket-version'] !== '13'
      || req.headers['sec-websocket-protocol'] !== 'whybuddy-private-ingress-smoke') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return;
  }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] +
    '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: '+accept+'\r\nSec-WebSocket-Protocol: whybuddy-private-ingress-smoke\r\n\r\n');
  socket.write(frame(JSON.stringify({...inspect(req), type:'connected'})));
  let pending = head;
  const consume = data => {
    pending = Buffer.concat([pending,data]);
    while(pending.length >= 2) {
      let n=pending[1]&127, offset=2;
      if(n===127 || !(pending[1]&128)) {socket.destroy();return;}
      if(n===126) {if(pending.length<4)return; n=pending.readUInt16BE(2); offset=4;}
      if(pending.length<offset+4+n)return;
      const mask=pending.subarray(offset,offset+4), body=Buffer.from(pending.subarray(offset+4,offset+4+n));
      const opcode=pending[0]&15;
      pending=pending.subarray(offset+4+n);
      for(let i=0;i<body.length;i++)body[i]^=mask[i%4];
      if(opcode===8) {socket.end(Buffer.from([0x88,0]));return;}
      if(opcode===9) {socket.write(frame(body,10));continue;}
      if(opcode!==1) {socket.destroy();return;}
      socket.write(frame(JSON.stringify({type:'echo',value:body.toString('utf8')})));
    }
  };
  socket.on('data',consume);
  socket.on('error',()=>{});
  if(pending.length)consume(Buffer.alloc(0));
});
server.listen(5187,'0.0.0.0');
'''


def run(output):
    identity = uuid.uuid4().hex
    workspace = "private-ingress-smoke-" + identity
    directory = output / (str(int(time.time())) + "-" + identity[:8])
    directory.mkdir(parents=True)
    path = directory / "report.json"
    report = {"schemaVersion": 1, "status": "running", "scope": "E2B provider private HTTP/WS transport",
        "notCovered": ["user authorization", "private preview gateway", "browser", "Vite HMR", "business acceptance"],
        "workspaceId": workspace, "checks": [], "cleanup": []}
    key = (os.environ.get("E2B_API_KEY") or dotenv_values(ROOT / ".env").get("E2B_API_KEY") or "").strip()
    if not key:
        report.update(status="blocked", error="e2b_api_key_missing")
        path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"status": "blocked", "report": str(path)}))
        return 2
    provider = E2BWorkspaceProvider(api_key=key)
    handle = None
    attempted_create = False

    def checked(name, condition, *, fatal=True, **evidence):
        report["checks"].append({"name": name, "passed": bool(condition), **evidence})
        if not condition and fatal:
            raise AssertionError(name)
        print(("PASS " if condition else "FAIL ") + name, flush=True)

    def visibility(body, target):
        # These labels are fixed by the fixture. Never retain the value hashes,
        # response body, actual token, or request-header dictionary as evidence.
        return {"credentialHeaderNames": [name for name in body.get("credentialHeaderNames", [])
                if name in {"e2b-traffic-access-token", "x-access-token", "authorization", "x-api-key"}],
            "trafficTokenVisible": hashlib.sha256(target.access_token.encode()).hexdigest() in body.get("valueDigests", []),
            "managementKeyVisible": hashlib.sha256(key.encode()).hexdigest() in body.get("valueDigests", [])}

    def credential_observation(body, target):
        if not isinstance(body, dict) or body.get("marker") != identity:
            return False
        names = body.get("credentialHeaderNames")
        digests = body.get("valueDigests")
        if not isinstance(names, list) or not isinstance(digests, list):
            return False
        secrets = (target.access_token, key)
        return not names and not any(hashlib.sha256(value.encode()).hexdigest() in digests for value in secrets)

    def websocket_denied(target, headers=None):
        try:
            with websocket_connect(target.origin.replace("https://", "wss://", 1) + "/socket",
                    additional_headers=headers, subprotocols=[PROTOCOL], open_timeout=15, close_timeout=3):
                return False, 101
        except InvalidStatus as exc:
            status = exc.response.status_code
            return status in (401, 403, 404), status

    try:
        attempted_create = True
        handle = provider.create(workspace_id=workspace, timeout_seconds=300)
        report["sandboxId"] = handle.sandbox_id
        provider.write_files(handle, {"ingress-smoke.mjs": SERVER})
        started = provider.start_process(handle, "node ingress-smoke.mjs " + shlex.quote(identity), timeout_seconds=300)
        checked("real test server has a managed process", bool(started.process_id) and started.exit_code is None)
        probe = "node -e " + shlex.quote(f"fetch('http://127.0.0.1:{PORT}/').then(r=>r.json()).then(j=>{{if(j.marker!=={json.dumps(identity)})process.exit(1)}})")
        deadline = time.monotonic() + 25
        while provider.run(handle, probe, timeout_seconds=10).exit_code != 0:
            if time.monotonic() >= deadline:
                raise AssertionError("fixture_server_readiness_timeout")
            time.sleep(0.2)
        before_getter = Sandbox.get_info(handle.sandbox_id, api_key=key, request_timeout=20)
        target = provider.private_preview_target(handle, PORT)
        again = provider.private_preview_target(handle, PORT)
        after_getter = Sandbox.get_info(handle.sandbox_id, api_key=key, request_timeout=20)
        checked("connected getter does not resume or extend sandbox lifetime",
            before_getter.state == after_getter.state == "running"
            and before_getter.end_at == after_getter.end_at
            and target.expires_at == again.expires_at == after_getter.end_at.timestamp())
        checked("private target verifies sandbox metadata and expiry", target.expires_at > time.time()
            and target.workspace_id == workspace and target.sandbox_id == handle.sandbox_id and target.port == PORT)
        with httpx.Client(timeout=20, follow_redirects=False) as client:
            denied = client.get(target.origin + "/")
            checked("anonymous HTTP is rejected", denied.status_code in (401,403,404), status=denied.status_code)
            wrong = client.get(target.origin + "/", headers={"E2B-Traffic-Access-Token": "deliberately-invalid-fixture"})
            checked("wrong-token HTTP is rejected", wrong.status_code in (401,403,404), status=wrong.status_code)
            authorized = client.get(target.origin + "/?nonce=" + identity, headers=target.headers())
            checked("authenticated HTTP reaches the actual fixture", authorized.status_code == 200
                and authorized.json().get("marker") == identity, status=authorized.status_code)
            observation = authorized.json()
            checked("application cannot read credentials on HTTP", credential_observation(observation, target),
                fatal=False, **visibility(observation, target))
        denied, status = websocket_denied(target)
        checked("anonymous WebSocket is rejected", denied, status=status)
        denied, status = websocket_denied(target, {"E2B-Traffic-Access-Token": "deliberately-invalid-fixture"})
        checked("wrong-token WebSocket is rejected", denied, status=status)
        with websocket_connect(target.origin.replace("https://", "wss://", 1) + "/socket",
                additional_headers=target.headers(), subprotocols=[PROTOCOL], open_timeout=15, close_timeout=3) as ws:
            observation = json.loads(ws.recv(timeout=15))
            checked("authenticated WebSocket negotiates and reaches fixture", ws.subprotocol == PROTOCOL
                and observation.get("marker") == identity and observation.get("type") == "connected")
            checked("application cannot read credentials on WebSocket", credential_observation(observation, target),
                fatal=False, **visibility(observation, target))
            ws.send("round-trip-" + identity)
            echo = json.loads(ws.recv(timeout=15))
            checked("WebSocket carries real bidirectional messages", echo == {"type": "echo", "value": "round-trip-" + identity})
        fresh = E2BWorkspaceProvider(api_key=key)
        before_fresh = Sandbox.get_info(handle.sandbox_id, api_key=key, request_timeout=20)
        refused = False
        try:
            fresh.private_preview_target(handle, PORT)
        except WorkspaceProviderError as exc:
            refused = str(exc) == "e2b_preview_connection_required"
        after_fresh = Sandbox.get_info(handle.sandbox_id, api_key=key, request_timeout=20)
        checked("fresh getter requires an explicit lifecycle connection without extending expiry",
            refused and before_fresh.end_at == after_fresh.end_at and before_fresh.state == after_fresh.state)
        # This is an explicit lifecycle action under the smoke's sandbox budget,
        # separate from resolving a target; SDK connect can renew/resume.
        fresh.connect(handle, timeout_seconds=300)
        before_recovered = Sandbox.get_info(handle.sandbox_id, api_key=key, request_timeout=20)
        recovered = fresh.private_preview_target(handle, PORT)
        after_recovered = Sandbox.get_info(handle.sandbox_id, api_key=key, request_timeout=20)
        checked("target after explicit reconnect does not further extend lifetime",
            before_recovered.end_at == after_recovered.end_at
            and recovered.expires_at == after_recovered.end_at.timestamp())
        with httpx.Client(timeout=20, follow_redirects=False) as client:
            response = client.get(recovered.origin + "/", headers=recovered.headers())
            checked("new provider restores authenticated HTTP from persisted identity", response.status_code == 200
                and response.json().get("marker") == identity and recovered.origin == target.origin)
        with websocket_connect(recovered.origin.replace("https://", "wss://", 1) + "/socket",
                additional_headers=recovered.headers(), subprotocols=[PROTOCOL], open_timeout=15, close_timeout=3) as ws:
            checked("new provider restores authenticated WebSocket", json.loads(ws.recv(timeout=15)).get("marker") == identity)
            ws.send("reconnect-" + identity)
            checked("reconnected WebSocket exchanges data", json.loads(ws.recv(timeout=15)) == {"type":"echo", "value":"reconnect-" + identity})
        provider.stop(handle, started.process_id)
        checked("managed process stop is real", not provider.is_process_running(handle, started.process_id))
        Sandbox.pause(handle.sandbox_id, api_key=key, request_timeout=20)
        paused_before = Sandbox.get_info(handle.sandbox_id, api_key=key, request_timeout=20)
        cached_refused = fresh_refused = False
        try:
            provider.private_preview_target(handle, PORT)
        except WorkspaceProviderError as exc:
            cached_refused = str(exc) == "e2b_preview_sandbox_not_running"
        try:
            E2BWorkspaceProvider(api_key=key).private_preview_target(handle, PORT)
        except WorkspaceProviderError as exc:
            fresh_refused = str(exc) == "e2b_preview_connection_required"
        paused_after = Sandbox.get_info(handle.sandbox_id, api_key=key, request_timeout=20)
        checked("cached and fresh target getters never resume a paused sandbox",
            cached_refused and fresh_refused and paused_before.state == paused_after.state == "paused"
            and paused_before.end_at == paused_after.end_at)
        report["status"] = "passed" if all(item["passed"] for item in report["checks"]) else "failed"
    except Exception as exc:
        # SDK/client errors can contain request headers. Persist a generic type
        # or our fixed assertion name, never their response or exception repr.
        report["status"] = "failed"
        report["error"] = str(exc) if isinstance(exc, (AssertionError, WorkspaceProviderError)) else type(exc).__name__
    finally:
        handles = {handle.sandbox_id: handle} if handle is not None else {}
        if attempted_create:
            try:
                handles.update({found.sandbox_id: found for found in provider.find_workspaces(workspace_id=workspace)})
            except Exception:
                report["cleanup"].append({"status":"discovery_failed"})
                report["status"] = "failed"
        for retained in handles.values():
            try:
                provider.destroy(retained)
                report["cleanup"].append({"sandboxId":retained.sandbox_id, "status":"destroyed"})
            except Exception:
                report["cleanup"].append({"sandboxId":retained.sandbox_id, "status":"destroy_failed"})
                report["status"] = "failed"
        path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"status":report["status"], "checks":len(report["checks"]), "report":str(path),
        "cleanup":report["cleanup"]}))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "project-private-ingress-smoke")
    args = parser.parse_args()
    raise SystemExit(run(args.output.resolve()))
