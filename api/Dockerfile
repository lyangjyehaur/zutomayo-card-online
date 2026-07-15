FROM node:22.22.2-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22.22.2-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
WORKDIR /app
ARG APP_VERSION
ARG APP_BUILD_ID
ARG GAME_RULES_VERSION
RUN apk upgrade --no-cache \
    && npm install --global --prefix /opt/npm npm@12.0.1 \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && ln -s /opt/npm/bin/npm /usr/local/bin/npm \
    && ln -s /opt/npm/bin/npx /usr/local/bin/npx \
    && npm cache clean --force
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY ./*.cjs ./
ENV API_PORT=3001
ENV NODE_ENV=production
ENV APP_VERSION=$APP_VERSION
ENV APP_BUILD_ID=$APP_BUILD_ID
ENV GAME_RULES_VERSION=$GAME_RULES_VERSION
EXPOSE 3001
# node:22-alpine 已內建非 root 的 node 使用者
USER node
CMD ["node", "server.cjs"]
