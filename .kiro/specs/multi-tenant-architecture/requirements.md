# 需求文档

## 简介

多租户架构为 WhyBuddy 商业化平台提供完整的租户隔离方案。每个租户（团队/公司）拥有独立的 Agent 池、知识库、执行环境和资源配额，同时可共享公共的 Agent Marketplace。系统通过租户上下文传递、数据隔离、资源隔离和访问控制实现多租户支持，为平台从单用户演示走向多租户商业化运营奠定基础。

## 术语表

- **Tenant（租户）**: 平台中的一个独立组织单元（团队或公司），拥有独立的资源空间和配额
- **TenantContext（租户上下文）**: 包含 tenantId、userId、permissions、quotaUsage、features 的请求级上下文对象
- **Tier（订阅等级）**: 租户的订阅级别，包括 free、pro、enterprise 三个等级
- **Quota（配额）**: 租户可使用的资源上限，包括 Agent 数量、知识库大小、API 调用次数等
- **Agent_Pool（Agent 池）**: 租户拥有的 Agent 集合，与其他租户完全隔离
- **Knowledge_Base（知识库）**: 租户拥有的文档和向量数据集合
- **Marketplace（市场）**: 公共 Agent 市场，所有租户可浏览和导入预构建的 Agent
- **RBAC（基于角色的访问控制）**: 通过角色（owner、admin、member、viewer）控制用户权限的机制
- **Audit_Log（审计日志）**: 记录租户内所有重要操作的不可变日志

## 需求

### 需求 1：租户创建和初始化

**用户故事：** 作为系统管理员，我需要创建新租户并初始化其基础资源，这样新的团队/公司可以开始使用平台。

#### 验收标准

1. THE Tenant_Service SHALL provide a createTenant() interface that accepts name, tier, and features parameters and returns a tenantId and initialization status
2. WHEN a new tenant is created, THE Tenant_Service SHALL initialize an isolated database schema or logically isolated tables for the tenant
3. WHEN a new tenant is created, THE Tenant_Service SHALL create a default workspace, Agent pool, and knowledge base storage for the tenant
4. WHEN a new tenant is created with tier "free", THE Tenant_Service SHALL set initial quotas to 5 Agents and 10GB knowledge base; WHEN tier is "pro", THE Tenant_Service SHALL set quotas to 50 Agents and 100GB; WHEN tier is "enterprise", THE Tenant_Service SHALL set quotas to unlimited
5. WHEN tenant creation succeeds, THE Tenant_Service SHALL return the tenantId and initialization status in the response

### 需求 2：租户上下文的传递和验证

**用户故事：** 作为系统，我需要在每个请求中传递和验证租户上下文，确保用户只能访问自己租户的资源。

#### 验收标准

1. THE API_Gateway SHALL require all API requests to include a tenant identifier via X-Tenant-ID header or tenantId claim in JWT token
2. WHEN a request is received, THE Context_Extractor SHALL extract tenant information from the request using extractTenantContext()
3. WHEN extracting tenant context, THE Context_Extractor SHALL validate that the user belongs to the specified tenant and has permission to perform the requested operation
4. IF tenant context validation fails, THEN THE API_Gateway SHALL return 403 Forbidden and record an audit log entry
5. WHEN tenant context is validated, THE Context_Injector SHALL automatically inject the tenant context into all subsequent database queries and business logic

### 需求 3：租户的 Agent 池隔离

**用户故事：** 作为租户，我需要拥有独立的 Agent 池，其中的 Agent 只能被我的团队访问和使用。

#### 验收标准

1. THE Agent_Repository SHALL store a tenantId field on every Agent record to identify its owning tenant
2. WHEN an Agent is created, THE Agent_Repository SHALL automatically associate the Agent with the current tenant from the tenant context
3. WHEN querying Agents, THE Agent_Repository SHALL automatically filter results to only include Agents belonging to the current tenant
4. IF a user attempts to access an Agent belonging to a different tenant, THEN THE Agent_Repository SHALL return 404 Not Found
5. WHEN an Agent is created or deleted, THE Quota_Tracker SHALL update the tenant quotaUsage.agentCount accordingly

### 需求 4：租户的知识库隔离

**用户故事：** 作为租户，我需要拥有独立的知识库，其中的文档和向量只能被我的团队访问。

#### 验收标准

1. THE Knowledge_Base_Repository SHALL store a tenantId field on every knowledge base record
2. WHEN a document is uploaded, THE Knowledge_Base_Repository SHALL automatically associate the document with the current tenant
3. WHEN performing vector search, THE Knowledge_Base_Repository SHALL automatically filter results to only include documents belonging to the current tenant
4. WHEN a document is uploaded or deleted, THE Quota_Tracker SHALL update the tenant quotaUsage.knowledgeBaseSize accordingly
5. WHEN a tenant is deleted, THE Tenant_Service SHALL delete or archive all knowledge base data belonging to that tenant

### 需求 5：租户的执行环境隔离

**用户故事：** 作为租户，我需要拥有独立的工作流执行环境，其中的工作流执行记录和结果只能被我的团队访问。

#### 验收标准

1. THE Workflow_Repository SHALL store a tenantId field on every workflow, execution record, and execution log
2. WHEN a workflow is created, THE Workflow_Repository SHALL automatically associate the workflow with the current tenant
3. WHEN querying execution records, THE Workflow_Repository SHALL automatically filter results to only include records belonging to the current tenant
4. THE Execution_Environment SHALL isolate temporary files and caches for each tenant in separate storage paths
5. WHEN an API call is made, THE Quota_Tracker SHALL independently count API calls per tenant and update quotaUsage.apiCallsThisMonth

### 需求 6：租户的资源配额管理

**用户故事：** 作为系统，我需要对每个租户的资源使用进行限制和监控，防止单个租户过度消耗资源。

#### 验收标准

1. THE Quota_Service SHALL provide a checkQuota(tenantId, resourceType, amount) interface to verify resource availability before consumption
2. WHEN creating an Agent, uploading a document, or executing a workflow, THE System SHALL call checkQuota() to verify the tenant has sufficient quota
3. IF a tenant exceeds their quota, THEN THE Quota_Service SHALL return 429 Too Many Requests with a message suggesting an upgrade
4. THE Quota_Service SHALL periodically recalculate tenant quota usage and update the quotaUsage fields
5. THE Quota_Service SHALL provide a GET /api/tenants/:id/quota endpoint to query tenant quota usage information

### 需求 7：租户的访问控制和权限管理

**用户故事：** 作为租户管理员，我需要管理团队成员的权限，控制他们可以访问和操作的资源。

#### 验收标准

1. THE RBAC_Service SHALL support role-based access control with roles: owner, admin, member, and viewer
2. THE RBAC_Service SHALL assign each user exactly one role within a tenant, where each role has a defined set of permissions
3. THE RBAC_Service SHALL provide an assignRole(userId, tenantId, role) interface for role assignment
4. WHEN an API request is received, THE RBAC_Service SHALL check the user role permissions at each endpoint and return 403 Forbidden for unauthorized operations
5. WHEN a role assignment changes, THE Audit_Logger SHALL record the change in the audit log

### 需求 8：公共 Agent Marketplace

**用户故事：** 作为租户，我需要能够从公共 Marketplace 中浏览和导入预构建的 Agent，这样可以快速扩展能力。

#### 验收标准

1. THE Marketplace_Service SHALL maintain a public Agent Marketplace containing community-contributed and official Agents
2. THE Marketplace_Service SHALL mark Marketplace Agents with visibility "public" and not associate them with any specific tenant
3. THE Marketplace_Service SHALL provide a GET /api/marketplace/agents endpoint for tenants to browse Marketplace Agents
4. THE Marketplace_Service SHALL provide a POST /api/agents/import endpoint for tenants to import a Marketplace Agent into their own Agent pool
5. WHEN a Marketplace Agent is imported, THE Agent_Repository SHALL create a copy associated with the importing tenant as a private Agent

### 需求 9：租户的 Agent 共享和发布

**用户故事：** 作为租户，我可以将自己创建的 Agent 发布到 Marketplace，供其他租户使用。

#### 验收标准

1. THE Marketplace_Service SHALL provide a publishAgent(agentId, marketplaceMetadata) interface for publishing Agents
2. WHEN publishing an Agent, THE Marketplace_Service SHALL require description, tags, and version metadata
3. WHEN an Agent is published, THE Marketplace_Service SHALL mark the Agent with visibility "public" and record the original author information
4. WHEN another tenant imports a published Agent, THE Marketplace_Service SHALL track usage statistics and provide feedback to the original author
5. WHEN publishing an Agent, THE Marketplace_Service SHALL allow setting a license type (MIT, Apache, etc.) and usage terms

### 需求 10：租户的订阅和升级

**用户故事：** 作为租户，我需要能够升级订阅等级以获得更多资源和功能。

#### 验收标准

1. THE Subscription_Service SHALL provide an upgradeTenant(tenantId, newTier) interface for subscription upgrades
2. WHEN a tenant upgrades, THE Subscription_Service SHALL automatically update quotas and enabled features for the new tier
3. THE Subscription_Service SHALL support monthly and annual billing cycles with payment gateway integration (Stripe, etc.)
4. WHEN an upgrade succeeds, THE Subscription_Service SHALL send a confirmation email and record the subscription change in the log
5. THE Subscription_Service SHALL provide a GET /api/tenants/:id/subscription endpoint to query subscription information

### 需求 11：租户的数据导出和迁移

**用户故事：** 作为租户，我需要能够导出自己的数据（Agent、知识库、执行记录），以便备份或迁移。

#### 验收标准

1. THE Export_Service SHALL provide an exportTenantData(tenantId, dataTypes) interface for data export
2. THE Export_Service SHALL support exporting Agent definitions, knowledge base documents, and execution records
3. THE Export_Service SHALL support JSON and CSV export formats with optional compression
4. WHEN an export is requested, THE Export_Service SHALL execute the export asynchronously and send a download link via email upon completion
5. THE Export_Service SHALL provide an importTenantData(tenantId, dataFile) interface for data import

### 需求 12：租户的审计日志

**用户故事：** 作为租户管理员，我需要查看租户内的所有操作日志，用于安全审计和合规。

#### 验收标准

1. THE Audit_Logger SHALL record all significant operations within a tenant, including Agent creation/deletion, document uploads, and workflow executions
2. THE Audit_Logger SHALL include operator, operation type, timestamp, target object, and operation result in each audit log entry
3. THE Audit_Logger SHALL provide a GET /api/tenants/:id/audit-logs endpoint for querying audit logs
4. THE Audit_Logger SHALL support filtering by operation type, operator, and time range
5. THE Audit_Logger SHALL ensure audit logs are immutable and retained for a minimum of 1 year

### 需求 13：租户隔离验证

**用户故事：** 作为系统，我需要验证多租户隔离的正确性，确保租户之间的数据不会泄露。

#### 验收标准

1. THE Isolation_Validator SHALL provide testing tools that simulate concurrent operations from multiple tenants
2. THE Isolation_Validator SHALL verify that Tenant A cannot access Tenant B's Agents, knowledge base, or execution records
3. THE Isolation_Validator SHALL verify that Tenant A's quota limits do not affect Tenant B's operations
4. WHEN a tenant is deleted, THE Tenant_Service SHALL completely remove all data belonging to that tenant
5. THE Isolation_Validator SHALL execute isolation tests periodically and record results in a test report

### 需求 14：前端租户管理面板

**用户故事：** 作为租户管理员，我希望在前端看到租户的基本信息、订阅状态和资源使用情况。

#### 验收标准

1. THE Tenant_Dashboard SHALL display tenant name, subscription tier, and expiration date
2. THE Tenant_Dashboard SHALL display resource usage including Agent count, knowledge base size, and monthly API call count
3. THE Tenant_Dashboard SHALL display quota limits and usage percentages using progress bars
4. THE Tenant_Dashboard SHALL provide action buttons for upgrade, renewal, and data export operations
5. THE Tenant_Dashboard SHALL display team member list and role assignments
