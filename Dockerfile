FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM node:22-alpine AS server

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/cards.json ./
COPY --from=builder /app/src ./src

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--import", "tsx", "src/server.ts"]
