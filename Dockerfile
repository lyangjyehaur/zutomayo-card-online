# syntax=docker/dockerfile:1.7

FROM node:22.22.2-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS builder
WORKDIR /app
# APP_BUILD_ID 建議在 CI/部署時設為 git commit hash，確保每次部署有獨立 Sentry release。
ARG APP_VERSION
ARG APP_BUILD_ID
ARG GAME_RULES_VERSION
ARG VITE_UMAMI_WEBSITE_ID=
ARG VITE_UMAMI_SCRIPT_URL=
ARG VITE_UMAMI_HOST_URL=
ARG VITE_UMAMI_TELEMETRY_SCRIPT_URL=
ARG VITE_UMAMI_SECONDARY_WEBSITE_ID=
ARG VITE_UMAMI_SECONDARY_HOST_URL=
ARG VITE_IMGPROXY_BASE_URL=
ARG VITE_PLATFORM_URL=
ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
# Source map 上傳用（僅 builder stage 需要，不會進入 runtime image）。
# 未設定時 vite build 仍會產生 source map（hidden），但不會上傳到 GlitchTip。
ARG SENTRY_URL=
ARG SENTRY_ORG=
ARG SENTRY_PROJECT=
ENV APP_VERSION=$APP_VERSION
ENV APP_BUILD_ID=$APP_BUILD_ID
ENV GAME_RULES_VERSION=$GAME_RULES_VERSION
ENV VITE_APP_VERSION=$APP_VERSION
ENV VITE_APP_BUILD_ID=$APP_BUILD_ID
ENV VITE_GAME_RULES_VERSION=$GAME_RULES_VERSION
ENV VITE_UMAMI_WEBSITE_ID=$VITE_UMAMI_WEBSITE_ID
ENV VITE_UMAMI_SCRIPT_URL=$VITE_UMAMI_SCRIPT_URL
ENV VITE_UMAMI_HOST_URL=$VITE_UMAMI_HOST_URL
ENV VITE_UMAMI_TELEMETRY_SCRIPT_URL=$VITE_UMAMI_TELEMETRY_SCRIPT_URL
ENV VITE_UMAMI_SECONDARY_WEBSITE_ID=$VITE_UMAMI_SECONDARY_WEBSITE_ID
ENV VITE_UMAMI_SECONDARY_HOST_URL=$VITE_UMAMI_SECONDARY_HOST_URL
ENV VITE_IMGPROXY_BASE_URL=$VITE_IMGPROXY_BASE_URL
ENV VITE_PLATFORM_URL=$VITE_PLATFORM_URL
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_SENTRY_TRACES_SAMPLE_RATE=$VITE_SENTRY_TRACES_SAMPLE_RATE
ENV SENTRY_URL=$SENTRY_URL
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN --mount=type=secret,id=sentry_auth_token,required=false \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" npm run build \
    && find dist -name "*.map" -type f -delete

FROM node:22.22.2-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
WORKDIR /app
ARG APP_VERSION
ARG APP_BUILD_ID
ARG GAME_RULES_VERSION
ARG SENTRY_DSN=
# node:22-alpine 已內建非 root 的 node 使用者
RUN apk upgrade --no-cache \
    && npm install --global --prefix /opt/npm npm@12.0.1 \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && ln -s /opt/npm/bin/npm /usr/local/bin/npm \
    && ln -s /opt/npm/bin/npx /usr/local/bin/npx \
    && npm cache clean --force
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/api/deckService.cjs ./api/deckService.cjs
COPY --from=builder /app/api/schemaGate.cjs ./api/schemaGate.cjs
COPY --from=builder /app/api/relationshipEvents.cjs ./api/relationshipEvents.cjs
COPY --from=builder /app/api/accountMutationLock.cjs ./api/accountMutationLock.cjs
COPY --from=builder /app/api/relationshipOutbox.cjs ./api/relationshipOutbox.cjs
COPY --from=builder /app/api/runtimeSecurityConfig.cjs ./api/runtimeSecurityConfig.cjs
COPY --from=builder /app/api/seasonResultService.cjs ./api/seasonResultService.cjs
ENV PORT=3000
ENV PLATFORM_PORT=3002
ENV APP_VERSION=$APP_VERSION
ENV APP_BUILD_ID=$APP_BUILD_ID
ENV GAME_RULES_VERSION=$GAME_RULES_VERSION
ENV SENTRY_DSN=$SENTRY_DSN
EXPOSE 3000 3002
USER node
CMD ["npm", "run", "server"]
