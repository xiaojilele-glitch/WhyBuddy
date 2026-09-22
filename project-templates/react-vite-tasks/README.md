# 任务清单

React 界面、Node HTTP API 与真实 SQLite 文件组成一个完整应用。首次访问创建管理员；管理员可以新增、编辑任务和创建只读成员。只读权限由 API 检查，刷新从数据库读取。

```sh
npm ci --ignore-scripts
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
npm run build
npm start -- --host 0.0.0.0 --port 5173 --static-dir dist --data-dir /absolute/application-data
npm test
```

开发与生产服务共用 `server.mjs`。开发模式在同一进程挂载 Vite；生产模式提供指定目录的构建产物。`WHYBUDDY_APP_DATA_DIR` 或 `--data-dir` 指定业务数据目录，默认源码目录的同级 `.whybuddy-application`。源码不包含数据库与账号数据。

HTTPS 预览由可信代理重新设置 `X-Forwarded-Proto: https`，应用据此使用 HttpOnly、Secure、SameSite=None 和 Partitioned 登录 Cookie，支持嵌入工作台后持续调用 API。代理必须先移除访问者提供的转发头。Cookie 按顶层站点分区，独立打开应用时需要重新登录；本地 HTTP 开发使用 SameSite=Lax。

`tasks.sqlite` 使用 SQLite schema 1，存储任务、独立应用账号的加盐密码摘要以及会话 token 摘要。每次成功修改都先用临时文件和原子重命名持久化，再返回 HTTP 成功。只允许一个进程持有该目录；正常停止清理锁，崩溃恢复检查旧 PID。数据库损坏或版本未知时拒绝启动，不自动清空。

同一数据目录的服务重启保留任务和账号。源码重建时，宿主先停止旧应用，再把可信存储中的数据库备份恢复到新实例的数据目录，然后启动对应源码版本。停止失败或备份失败必须保留待恢复状态。备份点之后、尚未被宿主持久化的变更不能宣称已可从沙盒销毁中恢复。验证实例必须使用独立空数据目录，不触碰用户预览的数据。

该固定模板验证新增、编辑、筛选、刷新与应用角色。浏览器通过只代表这些已声明行为；生产发布还需配置域名、备份周期、容量与账号治理。
