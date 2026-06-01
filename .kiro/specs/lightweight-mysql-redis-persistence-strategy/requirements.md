# 需求文档：Lightweight MySQL Redis Persistence Strategy

## 目标

为 WhyBuddy 的 ToC 账号、个人项目隔离和管理员后台建立轻量但可靠的持久化底座。当前测试环境已经具备 MySQL 和 Redis，本 spec 将其纳入项目实施主线：MySQL 作为用户、会话、项目和权限边界的唯一事实源；Redis 作为可选加速、限流和短期状态组件，不作为系统启动或权限判断的硬依赖。

## 背景

当前仓库仍以 `data/database.json` 和前端 localStorage 承接大量 demo/runtime 状态。这个模式适合单机演示，但不适合承接真实 ToC 用户登录、项目归属和管理员后台访问控制。`rbac-system-pc/backend` 的测试服务器配置可作为连接 MySQL/Redis 的工程参考，但该项目的租户、部门、岗位、用户组和完整 RBAC 体系不应迁移到 WhyBuddy 的 ToC MVP。

2026-04-30 已在测试 MySQL 实例上创建独立数据库 `cube_pets_office`，并验证 Redis 可达。创建过程未删除或修改 `rbac-system-pc` 既有数据库。

## 需求

### 需求 1：独立 MySQL 数据库

系统 SHALL 使用独立 MySQL database/schema 承接 WhyBuddy 的真实业务数据，数据库名为 `cube_pets_office`。系统 SHALL NOT 复用或修改 `rbac_multitenant` 等既有 `rbac-system-pc` 数据库。

### 需求 2：MySQL 作为权限事实源

系统 SHALL 将 `users`、`sessions`、`email_login_tokens`、`projects` 以及后续项目资源归属写入 MySQL。所有用户身份、登录态、项目归属和管理员角色判断 SHALL 以 MySQL 为最终事实源。

### 需求 3：JSON/localStorage 降级为过渡层

系统 SHALL 明确 `data/database.json` 和前端 localStorage 仅可作为 legacy/demo/runtime 过渡存储。它们 SHALL NOT 作为真实用户权限、项目所有权或管理员访问控制的判断依据。

### 需求 4：Redis 可选增强

系统 MAY 使用 Redis 承接登录限流、邮箱验证码短期缓存、session 热缓存、短期 admin 操作状态和后续队列。Redis 不可用时，核心登录、会话校验和项目隔离 SHALL 仍可通过 MySQL 正常工作。

### 需求 5：会话可撤销

系统 SHALL 使用可撤销会话模型。会话 token 明文仅存在于 httpOnly cookie 中，服务端 SHALL 只保存 token hash，并通过 `sessions.revoked_at`、`sessions.expires_at` 和用户状态控制退出、封禁和强制下线。

### 需求 6：邮箱登录令牌落库

系统 SHALL 将邮箱登录令牌或验证码以 hash 形式写入 MySQL，并记录 `expires_at`、`consumed_at`、请求 IP 和 user agent。Redis 可用于短期缓存，但不得替代 MySQL 记录。

### 需求 7：项目归属约束

系统 SHALL 在 MySQL 中为项目建立 `owner_user_id`。普通用户访问项目和项目资源时 SHALL 通过 `currentUser.id -> projects.owner_user_id` 做服务端过滤。未授权访问他人项目时，普通用户接口 SHOULD 返回 404 以避免泄露项目存在性。

### 需求 8：管理员访问隔离

系统 SHALL 将管理员全局访问放在 `/api/admin/*` 下，并通过 `users.role in ("admin", "super_admin")` 控制。普通 `/api/projects/*` 接口 SHALL 保持“只看自己的项目”语义，不因管理员能力而复杂化。

### 需求 9：配置与密钥安全

系统 SHALL 提供 `.env.example` 或等价配置文档，只保留变量名和占位符， SHALL NOT 将测试服务器真实密码、API key、JWT secret 或 Redis 密码写入仓库。日志 SHALL 避免打印连接密码、token、邮箱验证码和 session token 明文。

### 需求 10：迁移可重复执行

系统 SHALL 提供可重复执行的 MySQL migration 机制。migration SHALL 支持记录已执行版本，重复运行不应破坏既有表或数据。

### 需求 11：健康检查

系统 SHALL 提供 MySQL 和 Redis 健康检查。MySQL 不可用时，受保护 API SHALL 明确失败并返回服务不可用；Redis 不可用时，系统 SHALL 降级为 MySQL-only 模式并记录告警。

### 需求 12：非目标

本 spec 不实现完整用户登录页面、不实现项目 CRUD、不实现管理员后台 UI、不实现多租户、不实现部门岗位、不实现动态菜单权限、不实现复杂数据权限规则、不迁移 `rbac-system-pc` 的既有业务表。
