FROM node:22-alpine AS build
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY server/project-preview ./server/project-preview
COPY shared/project-preview-selection.mjs ./shared/project-preview-selection.mjs
COPY scripts/build-project-preview.mjs ./scripts/build-project-preview.mjs
RUN node scripts/build-project-preview.mjs

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /build/dist/project-preview/gateway.cjs ./gateway.cjs
COPY --from=build /build/dist/project-preview/ws-LICENSE.txt ./ws-LICENSE.txt
USER node
EXPOSE 3002
CMD ["node", "gateway.cjs"]
