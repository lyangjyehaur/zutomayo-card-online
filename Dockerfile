FROM node:22-alpine AS builder
WORKDIR /app
ARG APP_VERSION=0.1.0
ARG APP_BUILD_ID=0.1.0
ARG GAME_RULES_VERSION=0.1.0
ENV APP_VERSION=$APP_VERSION
ENV APP_BUILD_ID=$APP_BUILD_ID
ENV GAME_RULES_VERSION=$GAME_RULES_VERSION
ENV VITE_APP_VERSION=$APP_VERSION
ENV VITE_APP_BUILD_ID=$APP_BUILD_ID
ENV VITE_GAME_RULES_VERSION=$GAME_RULES_VERSION
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ARG APP_VERSION=0.1.0
ARG APP_BUILD_ID=0.1.0
ARG GAME_RULES_VERSION=0.1.0
# node:22-alpine 已內建非 root 的 node 使用者
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/data ./data
COPY --from=builder /app/scripts ./scripts
ENV PORT=3000
ENV APP_VERSION=$APP_VERSION
ENV APP_BUILD_ID=$APP_BUILD_ID
ENV GAME_RULES_VERSION=$GAME_RULES_VERSION
EXPOSE 3000
USER node
CMD ["npm", "run", "server"]
