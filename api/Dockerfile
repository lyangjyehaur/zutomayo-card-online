FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

RUN mkdir -p /data

ENV API_PORT=3001
ENV DB_PATH=/data/zutomayo.db
EXPOSE 3001

CMD ["node", "server.cjs"]
