FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Build frontend
RUN npx vite build

# Compile game module to CJS for boardgame.io server
RUN npx tsc \
  --outDir dist-server \
  --module commonjs \
  --moduleResolution node \
  --esModuleInterop \
  --skipLibCheck \
  --resolveJsonModule \
  --target es2020 \
  src/game/Game.ts \
  src/game/types.ts \
  src/game/GameLogic.ts \
  src/game/cards/loader.ts \
  src/game/cards/deckBuilder.ts \
  src/game/cards/presetDecks.ts \
  src/game/effects/parser.ts \
  src/game/effects/executor.ts \
  src/game/effects/types.ts \
  src/game/effects/index.ts

FROM node:22-alpine

WORKDIR /app

# Install koa-static for serving frontend
RUN npm init -y > /dev/null 2>&1 && npm install boardgame.io koa-static

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/src/server-boardgame.cjs ./server.cjs
COPY --from=builder /app/cards.json ./

RUN mkdir -p /data

ENV PORT=3000
ENV DB_PATH=/data/zutomayo.db
EXPOSE 3000

CMD ["node", "server.cjs"]
