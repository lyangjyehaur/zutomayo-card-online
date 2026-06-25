FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/cards.json ./cards.json
COPY --from=builder /app/data ./data
COPY --from=builder /app/admin ./admin
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "run", "server"]
