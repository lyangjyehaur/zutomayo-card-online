FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM node:22-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/server.cjs ./
RUN mkdir -p /data

ENV PORT=3000
ENV DB_PATH=/data/zutomayo.db
EXPOSE 3000

CMD ["node", "server.cjs"]
