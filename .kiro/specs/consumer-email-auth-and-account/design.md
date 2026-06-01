# 设计文档：Consumer Email Auth And Account

## 设计概述

本 spec 建立 ToC 邮箱账号体系，作为 Project-first 个人工作台的身份底座。设计上参考 `web-main/backend` 的认证闭环、当前用户恢复接口、httpOnly cookie、`authenticate` 中间件和 `req.user` 注入；但 whybuddy 第一阶段采用 MySQL-backed opaque session，不把 JWT/header token 作为主要登录态，并去掉租户、部门、岗位、用户组和完整 RBAC。

## 认证模型

```ts
type UserRole = "user" | "admin" | "super_admin";
type UserStatus = "active" | "disabled";

interface User {
  id: string;
  email: string;
  passwordHash?: string;
  displayName?: string;
  avatarUrl?: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface CurrentUser {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
}

interface AuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  issuedAt: number;
  expiresAt: number;
  revokedAt?: string;
  lastSeenAt?: string;
}
```

## API 草案

```text
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me
POST   /api/auth/refresh   # optional: refresh lastSeen/expiry for DB session
POST   /api/auth/logout
```

`/api/auth/me` 是前端恢复登录态的唯一可信来源。响应中不返回 `passwordHash`、session token 明文或 token hash。

## 前端状态

建议新增 `auth-store` 或同等上下文，职责包括：

- `currentUser`
- `isAuthenticated`
- `isAdmin`
- `loading`
- `fetchMe()`
- `login(input)`
- `register(input)`
- `logout()`
- 统一处理 401/403/session expired 响应

Project-first 页面读取 `currentUser` 后再展示个人项目；未登录用户访问个人项目入口时进入登录页。前端可以缓存 `currentUser` 作为 UI 状态，但不能缓存或读取真实 session token。

## 中间件

```ts
function requireAuth(req, res, next) {
  // 从 httpOnly cookie 读取 opaque session token
  // 计算 token hash，优先查 Redis session cache，miss 时回查 MySQL sessions
  // 校验 session 未过期、未撤销，并确认 user.status === "active"
  // 注入 req.user
}

function optionalAuth(req, res, next) {
  // 有 session cookie 时尝试恢复 req.user，无 cookie 或 session 无效时继续公开流程
}
```

`requireAdmin` 由 `admin-console-and-global-role-gate` spec 承接。

## 服务分层

裁剪版登录架构要求登录逻辑集中在服务层，不写散到 route handler：

```text
auth routes -> AuthValidate -> AuthService -> UserRepository -> SessionService -> MySQL sessions -> optional Redis session cache -> httpOnly cookie
```

`AuthService` 负责注册、登录、统一错误、用户状态校验和登录时间/IP 更新；`SessionService` 负责创建 session token、保存 token hash、刷新 lastSeen、撤销 session 和清理 Redis cache。

## 与 web-main/backend 的取舍

可参考：

- 邮箱密码注册登录流程
- 当前用户恢复和认证中间件分层
- httpOnly cookie
- `GET /api/auth/profile` 的当前用户响应形态
- `authenticate` 中间件注入 `req.user`
- 登出时清理 cookie、撤销服务端 session，并可选失效 Redis session cache

不迁移：

- JWT/header token 作为主登录态
- `tenantCode`
- `tenant_id + email` 唯一索引
- 租户状态检查
- 租户切换
- 角色权限矩阵
- 部门、岗位、用户组

## 安全策略

- 邮箱全局唯一。
- 密码必须 hash 保存。
- 登录失败统一返回“邮箱或密码错误”。
- session token 明文只存在于 httpOnly cookie，服务端只保存 token hash。
- Redis miss 不代表登录失效，必须回查 MySQL；Redis 不可用时降级为 MySQL-only。
- 登录成功应更新 `lastLoginAt`、登录 IP 或等价审计字段。
- 生产环境 cookie 使用 `httpOnly`、`secure`、`sameSite=lax` 或更严格配置。
- 被禁用用户访问受保护接口返回 403。
- 管理员修改用户状态的需求由后置运营 spec 承接。

## 兼容策略

当前本地 project store 中的历史项目在用户第一次登录后，可通过迁移流程绑定到当前用户。迁移前应明确标记这些项目来自 demo/localStorage，避免和服务端真实项目重复。

## 非目标

本 spec 不实现项目隔离、不实现管理员后台、不实现团队成员协作、不实现第三方登录、不实现付费订阅。
