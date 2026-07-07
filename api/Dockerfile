FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine
WORKDIR /app
ARG APP_VERSION=0.1.0
ARG APP_BUILD_ID=0.1.0
ARG GAME_RULES_VERSION=0.1.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY ./*.cjs ./
ENV API_PORT=3001
ENV APP_VERSION=$APP_VERSION
ENV APP_BUILD_ID=$APP_BUILD_ID
ENV GAME_RULES_VERSION=$GAME_RULES_VERSION
EXPOSE 3001
# node:22-alpine 已內建非 root 的 node 使用者
USER node
CMD ["node", "server.cjs"]
