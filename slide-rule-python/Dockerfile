# SlideRule Python 推演后端（FastAPI :9700）— 生产镜像
#
# 构建上下文是仓库根目录（docker compose 已配好）：
#   docker build -f slide-rule-python/Dockerfile -t sliderule-python:local .
#
# 会话数据默认落 /app/data/sliderule-sessions.json —— compose 用命名卷
# 持久化该目录，容器重建不丢会话。

# The worker uploads this outbound-only agent to E2B. Build from the same source
# as the isolated gateway; a local dist directory is not part of Docker context.
FROM node:22-alpine AS project-preview-build
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY server/project-preview ./server/project-preview
COPY shared/project-preview-selection.mjs ./shared/project-preview-selection.mjs
COPY scripts/build-project-preview.mjs ./scripts/build-project-preview.mjs
RUN node scripts/build-project-preview.mjs

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 可选企业根证书（内网 MITM 代理环境）：把 PEM 证书放进 docker/certs/
# 再构建即可；目录为空时下面两步是空操作，不影响正常环境。
COPY docker/certs/ /usr/local/share/ca-certificates/sliderule/
RUN sh -c 'cat /usr/local/share/ca-certificates/sliderule/*.crt >> /etc/ssl/certs/ca-certificates.crt 2>/dev/null || true'
ENV PIP_CERT=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

# 依赖层先行，源码改动不重装依赖
COPY slide-rule-python/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY slide-rule-python/ ./
COPY project-templates/ /project-templates/
COPY server/project-verification/browser-runner.mjs /server/project-verification/browser-runner.mjs
COPY --from=project-preview-build /build/dist/project-preview /dist/project-preview

EXPOSE 9700

# 监听地址可配（UVICORN_HOST），默认 :: = IPv4+IPv6 双栈：
#   - Railway 服务间私网是 IPv6-only（*.railway.internal），需要 :: 才连得进；
#   - compose 的 IPv4 桥接网 :: 也兼容（Linux 默认 v6only=0，收 IPv4-mapped）。
# 但有些平台（如 Render）私网/健康检查走 IPv4，且容器可能 v6only=1，:: 会收不到
# IPv4 连接 → 健康检查超时。这类平台把 UVICORN_HOST 设成 0.0.0.0 即可。
# 端口听平台注入的 $PORT，没有回落 9700（compose 设了 PORT=9700）。
# sh -c + exec 保证 uvicorn 是 PID 1、正常收 SIGTERM 优雅退出。
#
# --timeout-graceful-shutdown：收到 SIGTERM 后最多等在途请求这么久，然后强退
# （2026-08-02 事故后加）。默认是**无限等**——而一趟推演要 6~20 分钟，于是
# 容器停不下来：实测本地 dev:stop 停不掉、端口一直被占，只能手动 kill 端口
# 占用进程。部署时这表现为滚动更新卡住。30s 够让正常请求收尾，又不会被一趟
# 长推演拖住。
CMD ["sh", "-c", "exec python -m uvicorn app:app --host ${UVICORN_HOST:-::} --port ${PORT:-9700} --timeout-graceful-shutdown ${UVICORN_GRACEFUL_TIMEOUT:-30}"]
