FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

ENV API_PORT=3001
EXPOSE 3001

CMD ["node", "server.cjs"]
