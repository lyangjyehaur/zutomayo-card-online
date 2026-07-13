FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine
WORKDIR /app
ARG APP_VERSION
ARG APP_BUILD_ID
ARG GAME_RULES_VERSION
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY ./*.cjs ./
RUN mkdir -p /app/data/feedback-uploads && chown -R node:node /app/data
ENV API_PORT=3001
ENV NODE_ENV=production
ENV APP_VERSION=$APP_VERSION
ENV APP_BUILD_ID=$APP_BUILD_ID
ENV GAME_RULES_VERSION=$GAME_RULES_VERSION
EXPOSE 3001
# node:22-alpine 已內建非 root 的 node 使用者
USER node
CMD ["node", "server.cjs"]
