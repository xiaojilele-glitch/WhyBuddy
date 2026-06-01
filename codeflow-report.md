# CodeFlow Analysis Report

**Repository:** whybuddy-main (1).zip
**Analyzed:** 2026/4/27 12:52:33

## Summary

| Metric | Value |
|--------|-------|
| Health Score | 68/100 (D) |
| Files | 1861 |
| Functions | 8089 |
| Lines of Code | 485,170 |
| Dependencies | 7028 |
| Unused Functions | 227 |
| Security Issues | 164 |

## Security Issues

### HIGH: Hardcoded Secret
- **File:** `.kiro/specs/agent-permission-model/design.md` (line 268)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `issueToken:       "POST   /api/permissions/tokens/:agentId",`

### HIGH: Hardcoded Secret
- **File:** `.kiro/specs/agent-permission-model/design.md` (line 269)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `verifyToken:      "POST   /api/permissions/tokens/verify",`

### HIGH: SQL Injection Risk
- **File:** `.kiro/specs/web-aigc-node-document_search/design.md`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.
- **Code:** `1. 调用方提交 `query + scope.projectId`，可选附带 `documentIds`、`sourceTypes`、`topK`、`mode`

### HIGH: SQL Injection Risk
- **File:** `client/src/components/nl-command/ClarificationPanel.tsx`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.

### HIGH: Shell Command Execution
- **File:** `client/src/components/office/OfficeTaskCockpit.tsx`
- **Description:** Shell() executes system commands. Ensure input is validated.

### HIGH: SQL Injection Risk
- **File:** `client/src/components/tasks/TaskAutopilotPanel.tsx`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.
- **Code:** `return `${labelEn} Summary: Selected ${selectedValue} (${range} range)`;`

### HIGH: XSS Vulnerability
- **File:** `client/src/components/ui/chart.tsx`
- **Description:** Direct HTML injection can lead to XSS attacks. Sanitize user input.

### HIGH: Shell Command Execution
- **File:** `client/src/components/workspace/WorkspacePageShell.tsx`
- **Description:** Shell() executes system commands. Ensure input is validated.

### HIGH: Hardcoded Secret
- **File:** `client/src/i18n/messages.ts` (line 170)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `apiKey: "API Key",`

### HIGH: Hardcoded Secret
- **File:** `client/src/i18n/messages.ts` (line 933)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `apiKey: "API Key",`

### HIGH: Shell Command Execution
- **File:** `scripts/dev-stop.mjs`
- **Description:** Shell() executes system commands. Ensure input is validated.

### HIGH: Hardcoded Secret
- **File:** `scripts/mission-integration-smoke.mjs` (line 514)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `FEISHU_TENANT_ACCESS_TOKEN: "mission-smoke-token",`

### HIGH: SQL Injection Risk
- **File:** `scripts/mission-integration-smoke.mjs`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.
- **Code:** ``Mission socket did not emit updates for ${body.missionId}``

### HIGH: SQL Injection Risk
- **File:** `server/core/export-adapters/autogen.ts`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.
- **Code:** `lines.push(`        speaker_selection_method=gc_cfg_${teamKey}.get("speaker_sele`

### HIGH: SQL Injection Risk
- **File:** `server/core/nl-command/clarification-dialog.ts`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.

### HIGH: SQL Injection Risk
- **File:** `server/core/reputation/reputation-service.ts`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.

### HIGH: Hardcoded Secret
- **File:** `server/permission/agent-integration.test.ts` (line 32)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `const SECRET = "test-agent-integration-secret";`

### HIGH: Hardcoded Secret
- **File:** `server/permission/check-engine.test.ts` (line 54)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `const SECRET = "test-check-engine-secret";`

### HIGH: Hardcoded Secret
- **File:** `server/permission/dynamic-manager.test.ts` (line 48)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `const SECRET = "test-dynamic-manager-secret";`

### HIGH: Hardcoded Secret
- **File:** `server/permission/routes.test.ts` (line 52)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `const SECRET = "test-route-secret";`

### HIGH: Hardcoded Secret
- **File:** `server/permission/routes.test.ts` (line 272)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `const res = await fetch(`${baseUrl}/api/permissions/tokens/verify`, json({ token`

### HIGH: SQL Injection Risk
- **File:** `server/rag/store/qdrant-adapter.ts`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.

### HIGH: SQL Injection Risk
- **File:** `server/routes/node-adapters/command-list-node-adapter.ts`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.

### HIGH: SQL Injection Risk
- **File:** `server/tasks/mission-projection.ts`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.
- **Code:** ``Route selection changed from ${recommendedRouteId} to ${selectedRouteId}.`,`

### HIGH: Hardcoded Secret
- **File:** `server/tests/embedding-provider.test.ts` (line 36)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `apiKey: 'sk-test',`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-delivery.test.ts` (line 42)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `new Response(JSON.stringify({ code: 0, msg: "ok", tenant_access_token: "tenant-t`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-delivery.test.ts` (line 76)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `appSecret: "app-secret",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-delivery.test.ts` (line 143)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `new Response(JSON.stringify({ code: 0, msg: "ok", tenant_access_token: "tenant-t`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-delivery.test.ts` (line 157)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `appSecret: "app-secret",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-delivery.test.ts` (line 207)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `new Response(JSON.stringify({ code: 0, msg: "ok", tenant_access_token: "tenant-t`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-delivery.test.ts` (line 224)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `appSecret: "app-secret",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-delivery.test.ts` (line 253)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `new Response(JSON.stringify({ code: 0, msg: "ok", tenant_access_token: "tenant-t`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-delivery.test.ts` (line 279)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `appSecret: "app-secret",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-delivery.test.ts` (line 297)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `new Response(JSON.stringify({ code: 0, msg: "ok", tenant_access_token: "tenant-t`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-delivery.test.ts` (line 325)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `appSecret: "app-secret",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-routes.test.ts` (line 249)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `webhookVerificationToken: "verification-token",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-routes.test.ts` (line 257)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "verification-token",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-routes.test.ts` (line 291)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `header: { event_type: "im.message.receive_v1", token: "wrong-token" },`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-routes.test.ts` (line 307)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `header: { event_type: "im.message.receive_v1", token: "wrong-token" },`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-routes.test.ts` (line 330)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `webhookVerificationToken: "verification-token",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-routes.test.ts` (line 338)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "verification-token",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-routes.test.ts` (line 427)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `secret: "relay-secret",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/feishu-routes.test.ts` (line 458)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `config: { relaySecret: "relay-secret" },`

### HIGH: Hardcoded Secret
- **File:** `server/tests/internal-api-adapter.test.ts` (line 568)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/internal-api-adapter.test.ts` (line 642)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/internal-api-adapter.test.ts` (line 722)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/internal-api-adapter.test.ts` (line 764)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/mcp-routes.test.ts` (line 119)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/mcp-routes.test.ts` (line 137)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/mcp-routes.test.ts` (line 241)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-mainline",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/mcp-routes.test.ts` (line 276)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-mainline",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/mcp-tool-adapter.test.ts` (line 84)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/mcp-tool-adapter.test.ts` (line 141)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/mcp-tool-adapter.test.ts` (line 182)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/mcp-tool-adapter.test.ts` (line 223)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/mcp-tool-adapter.test.ts` (line 270)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/mcp-tool-adapter.test.ts` (line 303)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/mcp-tool-adapter.test.ts` (line 341)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-mainline",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/mcp-tool-adapter.test.ts` (line 406)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/mcp-tool-adapter.test.ts` (line 436)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/open-dashboard-node-adapter.test.ts` (line 92)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/open-dashboard-routes.test.ts` (line 118)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/open-page-node-adapter.test.ts` (line 141)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/open-page-routes.test.ts` (line 117)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/open-report-node-adapter.test.ts` (line 144)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/open-report-routes.test.ts` (line 122)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/orchestration-recognition-jump-node-adapter.test.ts` (line 100)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/orchestration-recognition-jump-routes.test.ts` (line 136)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/passthrough-api-adapter.test.ts` (line 50)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "secret-token",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/passthrough-api-adapter.test.ts` (line 148)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `{ error: "rate limited", token: "secret-token" },`

### HIGH: Hardcoded Secret
- **File:** `server/tests/permission-governance-audit-routes.test.ts` (line 29)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `const SECRET = "permission-governance-audit-secret";`

### HIGH: SQL Injection Risk
- **File:** `server/tests/qdrant-adapter.test.ts`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.

### HIGH: Hardcoded Secret
- **File:** `server/tests/rag-config.test.ts` (line 49)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `RAG_EMBEDDING_API_KEY: 'sk-test',`

### HIGH: Hardcoded Secret
- **File:** `server/tests/rag-config.test.ts` (line 63)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `OPENAI_API_KEY: 'sk-openai',`

### HIGH: Hardcoded Secret
- **File:** `server/tests/rag-web-aigc-routes.test.ts` (line 392)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/rag-web-aigc-routes.test.ts` (line 432)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/rag-web-aigc-routes.test.ts` (line 477)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-2",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/token-service.test.ts` (line 49)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `const TEST_SECRET = "test-secret-key-for-unit-tests";`

### HIGH: Hardcoded Secret
- **File:** `server/tests/transaction-flow-node-adapter.test.ts` (line 50)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-transaction",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/transaction-flow-node-adapter.test.ts` (line 85)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-transaction",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/transaction-flow-node-adapter.test.ts` (line 117)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-transaction",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/transaction-flow-node-adapter.test.ts` (line 172)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-transaction",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/transaction-flow-routes.test.ts` (line 81)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/transaction-flow-routes.test.ts` (line 111)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/transaction-flow-routes.test.ts` (line 143)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-delete-adapter.test.ts` (line 105)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-delete-adapter.test.ts` (line 153)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-delete-adapter.test.ts` (line 177)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-delete-adapter.test.ts` (line 209)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-delete-adapter.test.ts` (line 233)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-delete-routes.test.ts` (line 94)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-delete-routes.test.ts` (line 151)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: SQL Injection Risk
- **File:** `server/tests/vector-delete-routes.test.ts`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-insert-adapter.test.ts` (line 72)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-insert-adapter.test.ts` (line 109)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-insert-adapter.test.ts` (line 127)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-insert-adapter.test.ts` (line 147)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-update-adapter.test.ts` (line 110)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-update-adapter.test.ts` (line 151)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-update-adapter.test.ts` (line 186)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-update-adapter.test.ts` (line 211)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-update-routes.test.ts` (line 51)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-update-routes.test.ts` (line 91)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-update-routes.test.ts` (line 142)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/vector-update-routes.test.ts` (line 193)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: SQL Injection Risk
- **File:** `server/tests/vector-update-routes.test.ts`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.

### HIGH: Hardcoded Secret
- **File:** `server/tests/web-aigc-risk-actions-routes.test.ts` (line 83)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/web-aigc-risk-actions-routes.test.ts` (line 129)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/web-aigc-risk-actions-routes.test.ts` (line 177)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/web-aigc-risk-actions-routes.test.ts` (line 254)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/web-aigc-risk-actions-routes.test.ts` (line 340)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-1",`

### HIGH: SQL Injection Risk
- **File:** `server/tests/web-aigc-risk-actions-routes.test.ts`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.

### HIGH: Hardcoded Secret
- **File:** `server/tests/workflow-runtime-engine.test.ts` (line 378)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `const resumedState = await engine.resume(workflow.id, { token: "approved" });`

### HIGH: Hardcoded Secret
- **File:** `server/tests/workflow-runtime-engine.test.ts` (line 381)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `acceptedToken: "approved",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/workflow-runtime-engine.test.ts` (line 6024)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "token-global-mcp",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/workflows-routes.test.ts` (line 709)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `acceptedToken: "approved",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/workflows-routes.test.ts` (line 725)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "approved",`

### HIGH: Hardcoded Secret
- **File:** `server/tests/workflows-routes.test.ts` (line 735)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `token: "approved",`

### HIGH: SQL Injection Risk
- **File:** `server/web-aigc/vector-update-adapter.ts`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.

### HIGH: Hardcoded Secret
- **File:** `services/lobster-executor/src/__tests__/ai-image-selection.property.test.ts` (line 25)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `const TEST_API_KEY = "test-api-key-for-property-testing-12345";`

### HIGH: Hardcoded Secret
- **File:** `services/lobster-executor/src/callback-event-coverage.property.test.ts` (line 62)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `{ secret: "test-secret", executorId: "exec-1", maxRetries: 0, baseDelayMs: 1 },`

### HIGH: Hardcoded Secret
- **File:** `services/lobster-executor/src/callback-sender.test.ts` (line 22)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `secret: "test-secret",`

### HIGH: Hardcoded Secret
- **File:** `services/lobster-executor/src/docker-runner.cancel.test.ts` (line 32)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `callbackSecret: "secret",`

### HIGH: Hardcoded Secret
- **File:** `services/lobster-executor/src/docker-runner.security.test.ts` (line 108)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `apiKey: "test-api-key-123456",`

### HIGH: SQL Injection Risk
- **File:** `shared/nl-command/api.ts`
- **Description:** String concatenation in SQL queries. Use parameterized queries instead.

### HIGH: Hardcoded Secret
- **File:** `shared/permission/api.ts` (line 18)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `issueToken:       "POST   /api/permissions/tokens/:agentId",`

### HIGH: Hardcoded Secret
- **File:** `shared/permission/api.ts` (line 19)
- **Description:** Credentials should never be hardcoded. Use environment variables or a secrets manager.
- **Code:** `verifyToken:      "POST   /api/permissions/tokens/verify",`

### MEDIUM: Dynamic Code Execution
- **File:** `.kiro/specs/web-aigc-node-vector_query/tasks.md` (line 52)
- **Description:** eval() executes arbitrary code. Avoid if possible or validate input strictly.
- **Code:** `- `server/rag/observability/metrics.ts` 已定义 `RAGMetrics.recordRetrieval()` 以及 `r`

### MEDIUM: Dynamic Code Execution
- **File:** `.kiro/specs/web-aigc-node-vector_query/现状核查.md` (line 113)
- **Description:** eval() executes arbitrary code. Avoid if possible or validate input strictly.
- **Code:** `- `recordRetrieval()``

### MEDIUM: Dynamic Code Execution
- **File:** `.kiro/specs/web-aigc-node-vector_query/落地现状.md` (line 149)
- **Description:** eval() executes arbitrary code. Avoid if possible or validate input strictly.
- **Code:** `- `recordRetrieval()``

### MEDIUM: Command Execution
- **File:** `docs/superpowers/plans/2026-04-15-trae-sandbox-native-executor.md`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `docs/superpowers/specs/2026-04-15-trae-sandbox-native-executor-design.md`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `scripts/build-pages.mjs`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `scripts/dev-all.mjs`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `scripts/dev-stop.mjs`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `scripts/lobster-executor-smoke.mjs`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `scripts/mission-smoke-shared.mjs`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `scripts/prod-smoke.mjs`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `scripts/secure-sandbox-smoke.mjs`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `scripts/test-server.mjs`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `server/core/dynamic-organization.ts`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `server/core/nl-command/comment-manager.ts`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `server/knowledge/code-extractor.ts`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `server/rag/chunking/code-chunker.ts`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `server/rag/chunking/conversation-chunker.ts`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Dynamic Code Execution
- **File:** `server/rag/observability/metrics.ts` (line 38)
- **Description:** eval() executes arbitrary code. Avoid if possible or validate input strictly.
- **Code:** `recordRetrieval(latencyMs: number, hasResults: boolean): void {`

### MEDIUM: Command Execution
- **File:** `server/routes/node-adapters/static-webpage-read-node-adapter.ts`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Dynamic Code Execution
- **File:** `server/routes/rag.ts` (line 103)
- **Description:** eval() executes arbitrary code. Avoid if possible or validate input strictly.
- **Code:** `deps.metrics.recordRetrieval(latencyMs, resultCount > 0);`

### MEDIUM: Command Execution
- **File:** `server/tests/knowledge-extractor.test.ts`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `services/lobster-executor/ai-bridge/executor.js`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### MEDIUM: Command Execution
- **File:** `services/lobster-executor/src/native-runner.ts`
- **Description:** Shell command execution detected. Ensure input is sanitized to prevent injection.

### LOW: Code Comments
- **File:** `.kiro/specs/autopilot-destination-card-and-goal-lock/tasks.md`
- **Description:** 1 TODO/FIXME comments found. Address before release.

### LOW: Code Comments
- **File:** `.kiro/specs/autopilot-route-planning-overlay/tasks.md`
- **Description:** 1 TODO/FIXME comments found. Address before release.

### LOW: Code Comments
- **File:** `.kiro/steering/task-autopilot-frontend-experience-spec-roadmap-2026-04-26.md`
- **Description:** 1 TODO/FIXME comments found. Address before release.

### LOW: Code Comments
- **File:** `docs/superpowers/plans/2026-04-15-trae-sandbox-native-executor.md`
- **Description:** 1 TODO/FIXME comments found. Address before release.

### LOW: Code Comments
- **File:** `package-lock.json`
- **Description:** 1 TODO/FIXME comments found. Address before release.

### LOW: Code Comments
- **File:** `pnpm-lock.yaml`
- **Description:** 1 TODO/FIXME comments found. Address before release.

### LOW: Debug Statements
- **File:** `scripts/mission-integration-smoke.mjs`
- **Description:** 4 console statements found. Remove before production.

### LOW: Debug Statements
- **File:** `scripts/secure-sandbox-smoke.mjs`
- **Description:** 9 console statements found. Remove before production.

### LOW: Debug Statements
- **File:** `scripts/test-server.mjs`
- **Description:** 5 console statements found. Remove before production.

### LOW: Code Comments
- **File:** `server/core/cost-tracker.ts`
- **Description:** 1 TODO/FIXME comments found. Address before release.

### LOW: Debug Statements
- **File:** `server/core/role-matcher.ts`
- **Description:** 4 console statements found. Remove before production.

### LOW: Debug Statements
- **File:** `server/core/workflow-engine.ts`
- **Description:** 9 console statements found. Remove before production.

### LOW: Code Comments
- **File:** `server/tests/replay-event-collector.test.ts`
- **Description:** 2 TODO/FIXME comments found. Address before release.

## Unused Functions (227)

These functions have zero calls (internal or external) and may be dead code:

### `getFrontendWorkflowBanner()`
- **File:** `client/src/components/WorkflowPanel.tsx`
- **Line:** 265
- **Lines of code:** 11
```
function getFrontendWorkflowBanner(locale: string, canUseAdvanced: boolean) {
  if (locale === "zh-CN") {
    return canUseAdvanced
      ? "当前是浏览器预演视图：你可以先看系统如何准备执行团队、组织分工和展示链路，切到高级模式后才会真正执行。"
      : "当前部署是静态预览版：保留了执行协同的界面表达和流程视图，但不会连接服务端执行真实工作流。";
  }

  return canUseAdvanced
    ? "You are in the browser preview layer: it shows how the system prepares the execution team and coordination flow, but the real run only starts in Advanced Mode."
    : "This deployment is a static preview: it keeps the execution-coordination UI and flow visuals, but does not connect to the server to run a real workflow.";
}
```

### `DirectiveView()`
- **File:** `client/src/components/WorkflowPanel.tsx`
- **Line:** 719
- **Lines of code:** 16
```
function DirectiveView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const setRuntimeMode = useAppStore(state => state.setRuntimeMode);
  const { submitDirective, isSubmitting, submitError } = useWorkflowStore();
  const [directive, setDirective] = useState("");
  const [attachments, setAttachments] = useState<WorkflowInputAttachment[]>([]);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isFrontend = runtimeMode === "frontend";
  const canUpgrade = isFrontend && CAN_USE_ADVANCED_RUNTIME;
  const narrative = useMemo(() => getDirectiveNarrative(locale), [locale]);

  // ...
```

### `OrgView()`
- **File:** `client/src/components/WorkflowPanel.tsx`
- **Line:** 1011
- **Lines of code:** 16
```
function OrgView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const {
    agents,
    agentsError,
    agentStatuses,
    currentWorkflow,
    fetchAgents,
    setActiveView,
    setSelectedMemoryAgent,
  } = useWorkflowStore();
  const fmt = useFmt();
  const organization = getOrganization(currentWorkflow);
  const openMemory = (id: string) => {
  // ...
```

### `ProgressViewLegacy()`
- **File:** `client/src/components/WorkflowPanel.tsx`
- **Line:** 1308
- **Lines of code:** 16
```
function ProgressViewLegacy() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const fmt = useFmt();
  const {
    currentWorkflow,
    tasks,
    messages,
    stages,
    downloadWorkflowReport,
    downloadDepartmentReport,
  } = useWorkflowStore();
  const organization = getOrganization(currentWorkflow);
  const attachments = useMemo(
    () =>
  // ...
```

### `ProgressView()`
- **File:** `client/src/components/WorkflowPanel.tsx`
- **Line:** 2122
- **Lines of code:** 16
```
function ProgressView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const fmt = useFmt();
  const {
    currentWorkflow,
    currentWorkflowId,
    tasks,
    messages,
    stages,
    workflowDetailError,
    downloadWorkflowReport,
    downloadDepartmentReport,
    fetchWorkflowDetail,
    fetchWorkflows,
  // ...
```

### `ReviewView()`
- **File:** `client/src/components/WorkflowPanel.tsx`
- **Line:** 3033
- **Lines of code:** 16
```
function ReviewView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const { currentWorkflow, tasks } = useWorkflowStore();
  return (
    <div className="flex h-full flex-col">
      <Section
        title={copy.workflow.review.title}
        description={copy.workflow.review.description}
      />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tasks.length === 0 ? (
          <div className="rounded-2xl bg-white/5 px-4 py-8 text-center text-[11px] text-white/50">
            {copy.workflow.review.empty}
          </div>
  // ...
```

### `MemoryView()`
- **File:** `client/src/components/WorkflowPanel.tsx`
- **Line:** 3111
- **Lines of code:** 16
```
function MemoryView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const fmt = useFmt();
  const isDemoActive = useDemoStore(s => s.isActive);
  const {
    agents,
    currentWorkflow,
    currentWorkflowId,
    selectedMemoryAgentId,
    setSelectedMemoryAgent,
    agentMemoryRecent,
    agentMemorySearchResults,
    memoryQuery,
    isMemoryLoading,
  // ...
```

### `ReportsView()`
- **File:** `client/src/components/WorkflowPanel.tsx`
- **Line:** 3431
- **Lines of code:** 16
```
function ReportsView() {
  const { copy } = useI18n();
  const fmt = useFmt();
  const {
    heartbeatStatuses,
    heartbeatReports,
    heartbeatError,
    fetchHeartbeatStatuses,
    fetchHeartbeatReports,
    runHeartbeat,
    runningHeartbeatAgentId,
    isHeartbeatLoading,
  } = useWorkflowStore();
  useEffect(() => {
    void fetchHeartbeatStatuses();
  // ...
```

### `HistoryView()`
- **File:** `client/src/components/WorkflowPanel.tsx`
- **Line:** 3611
- **Lines of code:** 16
```
function HistoryView() {
  const { copy } = useI18n();
  const fmt = useFmt();
  const {
    workflows,
    workflowsError,
    setCurrentWorkflow,
    setActiveView,
    fetchWorkflows,
  } = useWorkflowStore();
  useEffect(() => {
    void fetchWorkflows();
  }, [fetchWorkflows]);
  return (
    <div className="flex h-full flex-col">
  // ...
```

### `DemoEvolutionOverlay()`
- **File:** `client/src/components/WorkflowPanel.tsx`
- **Line:** 3674
- **Lines of code:** 6
```
function DemoEvolutionOverlay() {
  const isDemoActive = useDemoStore(s => s.isActive);
  const currentStage = useDemoStore(s => s.currentStage);
  if (!isDemoActive || currentStage !== "evolution") return null;
  return <EvolutionScoreCard />;
}
```

### `DemoControls()`
- **File:** `client/src/components/WorkflowPanel.tsx`
- **Line:** 3681
- **Lines of code:** 16
```
function DemoControls() {
  const isDemoActive = useDemoStore(s => s.isActive);
  const playbackState = useDemoStore(s => s.playbackState);
  const { pauseDemo, resumeDemo, stopDemo } = useDemoMode();

  if (!isDemoActive) return null;

  return (
    <div className="flex items-center gap-2 border-b border-[#7CB9E8]/30 bg-blue-500/10 px-4 py-2">
      <span className="text-[10px] font-semibold text-blue-400">🎬 Demo</span>
      <span className="rounded-full bg-blue-400/20 px-2 py-0.5 text-[9px] font-medium text-blue-400">
        {playbackState}
      </span>
      <div className="flex-1" />
      {playbackState === "playing" ? (
  // ...
```

### `LaunchDestinationExamples()`
- **File:** `client/src/components/launch/UnifiedLaunchComposer.tsx`
- **Line:** 289
- **Lines of code:** 16
```
function LaunchDestinationExamples({
  locale,
  onSelect,
}: {
  locale: string;
  onSelect: (example: AutopilotLaunchExample) => void;
}) {
  return (
    <div className="mt-2 rounded-[18px] border border-[#ead8c3]/70 bg-[#fffaf4]/72 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9a5d32]">
            {t(locale, "目的地示例", "Destination examples")}
          </div>
          <div className="mt-0.5 text-[10px] leading-4 text-stone-600">
  // ...
```

### `formatRouteReference()`
- **File:** `client/src/components/tasks/TaskAutopilotPanel.tsx`
- **Line:** 1046
- **Lines of code:** 16
```
function formatRouteReference(
  source: unknown,
  routeId: string | null,
  locale: string
): string | null {
  if (!routeId) return null;

  const record = routeRecordById(source, routeId);
  const label = record ? pickText(record, ["label", "title", "name"]) : null;
  const summary = record
    ? pickText(record, ["summary", "recommendationReason", "reason", "description"])
    : null;
  const display = label || summary || routeId;

  return display === routeId ? routeId : `${display} (${routeId})`;
  // ...
```

### `localizedExecutorStatus()`
- **File:** `client/src/components/tasks/TaskDetailView.tsx`
- **Line:** 322
- **Lines of code:** 16
```
function localizedExecutorStatus(
  copy: ReturnType<typeof useI18n>["copy"],
  status: string
) {
  switch (status) {
    case "queued":
      return copy.tasks.executor.statusQueued;
    case "running":
      return copy.tasks.executor.statusRunning;
    case "completed":
      return copy.tasks.executor.statusCompleted;
    case "failed":
      return copy.tasks.executor.statusFailed;
    case "warning":
      return copy.tasks.executor.statusWarning;
  // ...
```

### `localizedTimelineLevel()`
- **File:** `client/src/components/tasks/TaskDetailView.tsx`
- **Line:** 342
- **Lines of code:** 14
```
function localizedTimelineLevel(locale: string, level: string) {
  switch (level) {
    case "info":
      return t(locale, "信息", "Info");
    case "warning":
      return t(locale, "警告", "Warning");
    case "error":
      return t(locale, "异常", "Error");
    case "success":
      return t(locale, "成功", "Success");
    default:
      return level;
  }
}
```

### `humanOperatorLabel()`
- **File:** `client/src/components/tasks/task-helpers.ts`
- **Line:** 910
- **Lines of code:** 7
```
function humanOperatorLabel(detail: MissionTaskDetail): string {
  return (
    detail.latestOperatorAction?.requestedBy ||
    detail.blocker?.createdBy ||
    getTaskHelperCopy("en-US").owner.humanOperator
  );
}
```

### `_extends()`
- **File:** `client/src/components/three/OfficeRoom.tsx`
- **Line:** 1
- **Lines of code:** 1
```
import { Html, useGLTF } from "@react-three/drei";
```

### `AlertDialog()`
- **File:** `client/src/components/ui/alert-dialog.tsx`
- **Line:** 7
- **Lines of code:** 5
```
function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}
```

### `AlertDialogTrigger()`
- **File:** `client/src/components/ui/alert-dialog.tsx`
- **Line:** 13
- **Lines of code:** 7
```
function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  );
}
```

### `AlertDialogContent()`
- **File:** `client/src/components/ui/alert-dialog.tsx`
- **Line:** 45
- **Lines of code:** 16
```
function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
          className
        )}
        {...props}
      />
  // ...
```

### `AlertDialogHeader()`
- **File:** `client/src/components/ui/alert-dialog.tsx`
- **Line:** 64
- **Lines of code:** 12
```
function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}
```

### `AlertDialogFooter()`
- **File:** `client/src/components/ui/alert-dialog.tsx`
- **Line:** 77
- **Lines of code:** 16
```
function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  );
}
  // ...
```

### `AlertDialogTitle()`
- **File:** `client/src/components/ui/alert-dialog.tsx`
- **Line:** 93
- **Lines of code:** 12
```
function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  );
}
```

### `AlertDialogDescription()`
- **File:** `client/src/components/ui/alert-dialog.tsx`
- **Line:** 106
- **Lines of code:** 12
```
function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}
```

### `AlertDialogAction()`
- **File:** `client/src/components/ui/alert-dialog.tsx`
- **Line:** 119
- **Lines of code:** 11
```
function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants(), className)}
      {...props}
    />
  );
}
```

### `AlertDialogCancel()`
- **File:** `client/src/components/ui/alert-dialog.tsx`
- **Line:** 131
- **Lines of code:** 11
```
function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  );
}
```

### `AspectRatio()`
- **File:** `client/src/components/ui/aspect-ratio.tsx`
- **Line:** 3
- **Lines of code:** 5
```
function AspectRatio({
  ...props
}: React.ComponentProps<typeof AspectRatioPrimitive.Root>) {
  return <AspectRatioPrimitive.Root data-slot="aspect-ratio" {...props} />;
}
```

### `Avatar()`
- **File:** `client/src/components/ui/avatar.tsx`
- **Line:** 6
- **Lines of code:** 16
```
function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        className
      )}
      {...props}
    />
  );
}
  // ...
```

### `AvatarImage()`
- **File:** `client/src/components/ui/avatar.tsx`
- **Line:** 22
- **Lines of code:** 12
```
function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full", className)}
      {...props}
    />
  );
}
```

### `AvatarFallback()`
- **File:** `client/src/components/ui/avatar.tsx`
- **Line:** 35
- **Lines of code:** 16
```
function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "bg-muted flex size-full items-center justify-center rounded-full",
        className
      )}
      {...props}
    />
  );
}
  // ...
```

### `Breadcrumb()`
- **File:** `client/src/components/ui/breadcrumb.tsx`
- **Line:** 7
- **Lines of code:** 3
```
function Breadcrumb({ ...props }: React.ComponentProps<"nav">) {
  return <nav aria-label="breadcrumb" data-slot="breadcrumb" {...props} />;
}
```

### `BreadcrumbList()`
- **File:** `client/src/components/ui/breadcrumb.tsx`
- **Line:** 11
- **Lines of code:** 12
```
function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        "text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm break-words sm:gap-2.5",
        className
      )}
      {...props}
    />
  );
}
```

### `BreadcrumbItem()`
- **File:** `client/src/components/ui/breadcrumb.tsx`
- **Line:** 24
- **Lines of code:** 9
```
function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    />
  );
}
```

### `BreadcrumbLink()`
- **File:** `client/src/components/ui/breadcrumb.tsx`
- **Line:** 34
- **Lines of code:** 16
```
function BreadcrumbLink({
  asChild,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot : "a";

  return (
    <Comp
      data-slot="breadcrumb-link"
      className={cn("hover:text-foreground transition-colors", className)}
      {...props}
    />
  // ...
```

### `BreadcrumbPage()`
- **File:** `client/src/components/ui/breadcrumb.tsx`
- **Line:** 52
- **Lines of code:** 12
```
function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn("text-foreground font-normal", className)}
      {...props}
    />
  );
}
```

### `BreadcrumbSeparator()`
- **File:** `client/src/components/ui/breadcrumb.tsx`
- **Line:** 65
- **Lines of code:** 16
```
function BreadcrumbSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRight />}
    </li>
  // ...
```

### `BreadcrumbEllipsis()`
- **File:** `client/src/components/ui/breadcrumb.tsx`
- **Line:** 83
- **Lines of code:** 16
```
function BreadcrumbEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn("flex size-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontal className="size-4" />
      <span className="sr-only">More</span>
    </span>
  // ...
```

### `ButtonGroup()`
- **File:** `client/src/components/ui/button-group.tsx`
- **Line:** 24
- **Lines of code:** 16
```
function ButtonGroup({
  className,
  orientation,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  );
}
  // ...
```

### `ButtonGroupText()`
- **File:** `client/src/components/ui/button-group.tsx`
- **Line:** 40
- **Lines of code:** 16
```
function ButtonGroupText({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      className={cn(
        "bg-muted flex items-center gap-2 rounded-md border px-4 text-sm font-medium shadow-xs [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className
      )}
  // ...
```

### `ButtonGroupSeparator()`
- **File:** `client/src/components/ui/button-group.tsx`
- **Line:** 60
- **Lines of code:** 16
```
function ButtonGroupSeparator({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation}
      className={cn(
        "bg-input relative !m-0 self-stretch data-[orientation=vertical]:h-auto",
        className
      )}
      {...props}
    />
  // ...
```

### `Calendar()`
- **File:** `client/src/components/ui/calendar.tsx`
- **Line:** 12
- **Lines of code:** 16
```
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const defaultClassNames = getDefaultClassNames();

  return (
  // ...
```

### `CardAction()`
- **File:** `client/src/components/ui/card.tsx`
- **Line:** 51
- **Lines of code:** 12
```
function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  );
}
```

### `CardFooter()`
- **File:** `client/src/components/ui/card.tsx`
- **Line:** 74
- **Lines of code:** 9
```
function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  );
}
```

### `Carousel()`
- **File:** `client/src/components/ui/carousel.tsx`
- **Line:** 43
- **Lines of code:** 16
```
function Carousel({
  orientation = "horizontal",
  opts,
  setApi,
  plugins,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & CarouselProps) {
  const [carouselRef, api] = useEmblaCarousel(
    {
      ...opts,
      axis: orientation === "horizontal" ? "x" : "y",
    },
    plugins
  // ...
```

### `CarouselContent()`
- **File:** `client/src/components/ui/carousel.tsx`
- **Line:** 133
- **Lines of code:** 16
```
function CarouselContent({ className, ...props }: React.ComponentProps<"div">) {
  const { carouselRef, orientation } = useCarousel();

  return (
    <div
      ref={carouselRef}
      className="overflow-hidden"
      data-slot="carousel-content"
    >
      <div
        className={cn(
          "flex",
          orientation === "horizontal" ? "-ml-4" : "-mt-4 flex-col",
          className
        )}
  // ...
```

### `CarouselItem()`
- **File:** `client/src/components/ui/carousel.tsx`
- **Line:** 154
- **Lines of code:** 16
```
function CarouselItem({ className, ...props }: React.ComponentProps<"div">) {
  const { orientation } = useCarousel();

  return (
    <div
      role="group"
      aria-roledescription="slide"
      data-slot="carousel-item"
      className={cn(
        "min-w-0 shrink-0 grow-0 basis-full",
        orientation === "horizontal" ? "pl-4" : "pt-4",
        className
      )}
      {...props}
    />
  // ...
```

### `CarouselPrevious()`
- **File:** `client/src/components/ui/carousel.tsx`
- **Line:** 172
- **Lines of code:** 16
```
function CarouselPrevious({
  className,
  variant = "outline",
  size = "icon",
  ...props
}: React.ComponentProps<typeof Button>) {
  const { orientation, scrollPrev, canScrollPrev } = useCarousel();

  return (
    <Button
      data-slot="carousel-previous"
      variant={variant}
      size={size}
      className={cn(
        "absolute size-8 rounded-full",
  // ...
```

### `CarouselNext()`
- **File:** `client/src/components/ui/carousel.tsx`
- **Line:** 202
- **Lines of code:** 16
```
function CarouselNext({
  className,
  variant = "outline",
  size = "icon",
  ...props
}: React.ComponentProps<typeof Button>) {
  const { orientation, scrollNext, canScrollNext } = useCarousel();

  return (
    <Button
      data-slot="carousel-next"
      variant={variant}
      size={size}
      className={cn(
        "absolute size-8 rounded-full",
  // ...
```

### `ChartContainer()`
- **File:** `client/src/components/ui/chart.tsx`
- **Line:** 35
- **Lines of code:** 16
```
function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;

  // ...
```

### `ChartTooltipContent()`
- **File:** `client/src/components/ui/chart.tsx`
- **Line:** 105
- **Lines of code:** 16
```
function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
  // ...
```


*...and 177 more unused functions*

## Design Patterns

### Factory
Creates objects without specifying exact class. Enables loose coupling and extensibility.

**Files:** `design.md`, `tasks.md`, `design.md`, `tasks.md`, `tasks.md`NaN more)

### Observer/Event
Defines a subscription mechanism for event-driven architecture. Great for decoupling.

**Files:** `design.md`, `tasks.md`, `design.md`, `tasks.md`, `requirements.md`NaN more)

### Custom Hooks
React hooks for reusable stateful logic. Promotes code reuse and separation of concerns.

**Files:** `design.md`, `design.md`, `design.md`, `dialog.tsx`, `ThemeContext.tsx`NaN more)

### Context Provider
React Context for global state. Alternative to prop drilling.

**Files:** `design.md`, `design.md`, `design.md`, `tasks.md`, `design.md`NaN more)

### Modules
VBA Modules for reusable code and business logic.

**Files:** `lineage-module-entry.test.ts`

## Anti-Patterns

### God Object
Files with too many responsibilities (15+ functions). Consider splitting into smaller modules.

**Affected files:** `debug-collector.js`, `AuditPanel.tsx`, `ConfigPanel.tsx`, `CostDashboard.tsx`, `WorkflowPanel.tsx`

### Long File
Files over 500 lines are harder to maintain. Consider breaking into smaller modules.

**Affected files:** `debug-collector.js`, `ChatPanel.tsx`, `ConfigPanel.tsx`, `CostDashboard.tsx`, `WorkflowPanel.tsx`

### VBA God Module
VBA modules with 20+ procedures. Consider splitting into smaller modules.

**Affected files:** `ConfigPanel.tsx`, `WorkflowPanel.tsx`, `UnifiedLaunchComposer.tsx`, `OfficeTaskCockpit.test.tsx`, `OfficeTaskCockpit.tsx`

## Architecture Issues

### 227 Unused Functions
Functions not called from other files

**Affected:** `getFrontendWorkflowBanner`, `DirectiveView`, `OrgView`, `ProgressViewLegacy`, `ProgressView`

### 121 Large Files
Files with 15+ functions

**Affected:** `debug-collector.js (16 fns)`, `AuditPanel.tsx (17 fns)`, `ConfigPanel.tsx (35 fns)`, `CostDashboard.tsx (17 fns)`, `WorkflowPanel.tsx (106 fns)`

### 207 Highly Coupled
Files imported by 8+ others

**Affected:** `OfficeTaskCockpit.tsx (79 imports)`, `index.ts (69 imports)`, `design.md (54 imports)`, `design.md (54 imports)`, `TaskDetailView.tsx (53 imports)`

### 59 Circular Dependencies
Files that import each other

**Affected:** `tasks.md ↔ task-helpers.ts`, `App.tsx ↔ TaskDetailPage.tsx`, `AnomalyAlertPanel.tsx ↔ EmptyHintBlock.tsx`, `AuditPanel.tsx ↔ RetryInlineNotice.tsx`, `MoreDrawer.tsx ↔ Toolbar.tsx`

### 179 Duplicate Function Names
Same function name in multiple files

**Affected:** `compactText (3 files)`, `onAction (12 files)`, `onRetry (7 files)`, `onError (5 files)`, `onStateChange (5 files)`

### 12 Similar Code Blocks
Copy-paste code detected

**Affected:** `LaunchOperatorActionRail, OperatorActionBar, installMissionDecisionHooks, buildInputData, makePermissionEngine`, `missionStatusTone, agentStatusTone, resolveMissionReplayId`, `missionOperatorStateTone, timelineTone, stageTone, getWorkflowDirectiveContext, missionLatestOperatorAction, normalizeWireApi, resetCurrentMission, mapWorkflowStatusToGraphStatus, workflowSummary, findChunkIndex, load, collectionInfo, getCount, collectionInfo, deriveDepartmentLabels, deriveCompletedTaskCount, deriveActiveAgentCount, deriveDepartmentLabels, deriveCompletedTaskCount, deriveActiveAgentCount`, `makeEvent, makeEvent, makeEvent, buildPlanetSummaryRecord, makeEvent`, `makeTimeline, makeTimeline, makeTimeline`

### 844 Architecture Violations
Lower layers importing from higher layers

**Affected:** `test → utils`, `utils → components`, `test → components`, `utils → components`, `utils → components`

### 257 High Complexity Files
Files with complexity score >30

**Affected:** `tasks-store.ts (1135)`, `autopilot.ts (842)`, `TaskAutopilotPanel.tsx (657)`, `workflow-runtime-engine.ts (578)`, `WorkflowPanel.tsx (356)`

## File Details

| File | Folder | Layer | Lines | Functions |
|------|--------|-------|-------|----------|
| `.env.example` | root | utils | 132 | 0 |
| `deploy-pages.yml` | .github/workflows | utils | 64 | 0 |
| `release-guardrails.yml` | .github/workflows | utils | 186 | 0 |
| `.gitignore` | root | utils | 143 | 0 |
| `design.md` | .kiro/specs/a2a-protocol | note | 717 | 0 |
| `requirements.md` | .kiro/specs/a2a-protocol | note | 131 | 0 |
| `tasks.md` | .kiro/specs/a2a-protocol | note | 186 | 0 |
| `design.md` | .kiro/specs/agent-autonomy-upgrade | note | 1068 | 0 |
| `requirements.md` | .kiro/specs/agent-autonomy-upgrade | note | 137 | 0 |
| `tasks.md` | .kiro/specs/agent-autonomy-upgrade | note | 202 | 0 |
| `design.md` | .kiro/specs/agent-marketplace-platform | note | 928 | 0 |
| `requirements.md` | .kiro/specs/agent-marketplace-platform | note | 322 | 0 |
| `tasks.md` | .kiro/specs/agent-marketplace-platform | note | 293 | 0 |
| `design.md` | .kiro/specs/agent-marketplace | note | 410 | 0 |
| `requirements.md` | .kiro/specs/agent-marketplace | note | 103 | 0 |
| `tasks.md` | .kiro/specs/agent-marketplace | note | 144 | 0 |
| `design.md` | .kiro/specs/agent-permission-model | note | 870 | 0 |
| `requirements.md` | .kiro/specs/agent-permission-model | note | 194 | 0 |
| `tasks.md` | .kiro/specs/agent-permission-model | note | 116 | 0 |
| `design.md` | .kiro/specs/agent-reputation | note | 561 | 0 |
| `requirements.md` | .kiro/specs/agent-reputation | note | 133 | 0 |
| `tasks.md` | .kiro/specs/agent-reputation | note | 229 | 0 |
| `design.md` | .kiro/specs/ai-enabled-sandbox | note | 435 | 0 |
| `requirements.md` | .kiro/specs/ai-enabled-sandbox | note | 107 | 0 |
| `tasks.md` | .kiro/specs/ai-enabled-sandbox | note | 119 | 0 |
| `design.md` | .kiro/specs/api-fallback-empty-states | note | 95 | 0 |
| `manual-verification.md` | .kiro/specs/api-fallback-empty-states | note | 169 | 0 |
| `requirements.md` | .kiro/specs/api-fallback-empty-states | note | 58 | 0 |
| `tasks.md` | .kiro/specs/api-fallback-empty-states | note | 51 | 0 |
| `design.md` | .kiro/specs/audit-chain | note | 485 | 0 |
| `requirements.md` | .kiro/specs/audit-chain | note | 152 | 0 |
| `tasks.md` | .kiro/specs/audit-chain | note | 142 | 0 |
| `design.md` | .kiro/specs/autonomous-swarm | note | 516 | 0 |
| `requirements.md` | .kiro/specs/autonomous-swarm | note | 101 | 0 |
| `tasks.md` | .kiro/specs/autonomous-swarm | note | 160 | 0 |
| `design.md` | .kiro/specs/autopilot-cockpit-information-architecture | note | 805 | 0 |
| `requirements.md` | .kiro/specs/autopilot-cockpit-information-architecture | note | 54 | 0 |
| `tasks.md` | .kiro/specs/autopilot-cockpit-information-architecture | note | 79 | 0 |
| `design.md` | .kiro/specs/autopilot-cockpit-three-column-layout | note | 58 | 0 |
| `requirements.md` | .kiro/specs/autopilot-cockpit-three-column-layout | note | 45 | 0 |
| `tasks.md` | .kiro/specs/autopilot-cockpit-three-column-layout | note | 27 | 0 |
| `design.md` | .kiro/specs/autopilot-destination-card-and-goal-lock | note | 63 | 0 |
| `requirements.md` | .kiro/specs/autopilot-destination-card-and-goal-lock | note | 51 | 0 |
| `tasks.md` | .kiro/specs/autopilot-destination-card-and-goal-lock | note | 46 | 0 |
| `design.md` | .kiro/specs/autopilot-drive-state-timeline-and-replan | note | 50 | 0 |
| `requirements.md` | .kiro/specs/autopilot-drive-state-timeline-and-replan | note | 40 | 0 |
| `tasks.md` | .kiro/specs/autopilot-drive-state-timeline-and-replan | note | 23 | 0 |
| `design.md` | .kiro/specs/autopilot-empty-state-and-onboarding | note | 41 | 0 |
| `requirements.md` | .kiro/specs/autopilot-empty-state-and-onboarding | note | 40 | 0 |
| `tasks.md` | .kiro/specs/autopilot-empty-state-and-onboarding | note | 19 | 0 |
| `design.md` | .kiro/specs/autopilot-evidence-driving-recorder | note | 54 | 0 |
| `requirements.md` | .kiro/specs/autopilot-evidence-driving-recorder | note | 40 | 0 |
| `tasks.md` | .kiro/specs/autopilot-evidence-driving-recorder | note | 25 | 0 |
| `design.md` | .kiro/specs/autopilot-evidence-replay-and-trust-chain | note | 1234 | 0 |
| `requirements.md` | .kiro/specs/autopilot-evidence-replay-and-trust-chain | note | 225 | 0 |
| `tasks.md` | .kiro/specs/autopilot-evidence-replay-and-trust-chain | note | 78 | 0 |
| `design.md` | .kiro/specs/autopilot-explainability-and-telemetry | note | 1144 | 0 |
| `requirements.md` | .kiro/specs/autopilot-explainability-and-telemetry | note | 326 | 0 |
| `tasks.md` | .kiro/specs/autopilot-explainability-and-telemetry | note | 165 | 0 |
| `design.md` | .kiro/specs/autopilot-fleet-live-visualization | note | 43 | 0 |
| `requirements.md` | .kiro/specs/autopilot-fleet-live-visualization | note | 40 | 0 |
| `tasks.md` | .kiro/specs/autopilot-fleet-live-visualization | note | 22 | 0 |
| `design.md` | .kiro/specs/autopilot-frontend-state-model-and-store | note | 54 | 0 |
| `requirements.md` | .kiro/specs/autopilot-frontend-state-model-and-store | note | 41 | 0 |
| `tasks.md` | .kiro/specs/autopilot-frontend-state-model-and-store | note | 15 | 0 |
| `design.md` | .kiro/specs/autopilot-launch-destination-input | note | 75 | 0 |
| `requirements.md` | .kiro/specs/autopilot-launch-destination-input | note | 77 | 0 |
| `tasks.md` | .kiro/specs/autopilot-launch-destination-input | note | 34 | 0 |
| `design.md` | .kiro/specs/autopilot-mobile-and-responsive-cockpit | note | 42 | 0 |
| `requirements.md` | .kiro/specs/autopilot-mobile-and-responsive-cockpit | note | 40 | 0 |
| `tasks.md` | .kiro/specs/autopilot-mobile-and-responsive-cockpit | note | 21 | 0 |
| `design.md` | .kiro/specs/autopilot-recovery-and-human-takeover-governance | note | 2368 | 0 |
| `requirements.md` | .kiro/specs/autopilot-recovery-and-human-takeover-governance | note | 458 | 0 |
| `tasks.md` | .kiro/specs/autopilot-recovery-and-human-takeover-governance | note | 449 | 0 |
| `design.md` | .kiro/specs/autopilot-route-planning-overlay | note | 78 | 0 |
| `requirements.md` | .kiro/specs/autopilot-route-planning-overlay | note | 68 | 0 |
| `tasks.md` | .kiro/specs/autopilot-route-planning-overlay | note | 19 | 0 |
| `design.md` | .kiro/specs/autopilot-runtime-orchestration | note | 1223 | 0 |
| `requirements.md` | .kiro/specs/autopilot-runtime-orchestration | note | 208 | 0 |
| `tasks.md` | .kiro/specs/autopilot-runtime-orchestration | note | 69 | 0 |
| `design.md` | .kiro/specs/autopilot-takeover-control-panel | note | 53 | 0 |
| `requirements.md` | .kiro/specs/autopilot-takeover-control-panel | note | 40 | 0 |
| `tasks.md` | .kiro/specs/autopilot-takeover-control-panel | note | 15 | 0 |
| `design.md` | .kiro/specs/autopilot-visual-language-and-motion-system | note | 40 | 0 |
| `requirements.md` | .kiro/specs/autopilot-visual-language-and-motion-system | note | 40 | 0 |
| `tasks.md` | .kiro/specs/autopilot-visual-language-and-motion-system | note | 20 | 0 |
| `design.md` | .kiro/specs/browser-runtime | note | 115 | 0 |
| `requirements.md` | .kiro/specs/browser-runtime | note | 54 | 0 |
| `tasks.md` | .kiro/specs/browser-runtime | note | 40 | 0 |
| `design.md` | .kiro/specs/collaboration-replay | note | 1037 | 0 |
| `requirements.md` | .kiro/specs/collaboration-replay | note | 276 | 0 |
| `tasks.md` | .kiro/specs/collaboration-replay | note | 347 | 0 |
| `design.md` | .kiro/specs/cost-governance-strategy | note | 1009 | 0 |
| `requirements.md` | .kiro/specs/cost-governance-strategy | note | 206 | 0 |
| `tasks.md` | .kiro/specs/cost-governance-strategy | note | 96 | 0 |
| `design.md` | .kiro/specs/cost-observability | note | 519 | 0 |
| `requirements.md` | .kiro/specs/cost-observability | note | 169 | 0 |
| `tasks.md` | .kiro/specs/cost-observability | note | 181 | 0 |
| `design.md` | .kiro/specs/cross-framework-export | note | 321 | 0 |
| `requirements.md` | .kiro/specs/cross-framework-export | note | 114 | 0 |

*...and 1761 more files*
