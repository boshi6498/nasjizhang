FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && npm install --omit=dev && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chmod 644 /app/server.js && chown -R node:node /app
USER node
EXPOSE 3001
VOLUME ["/app/data"]
CMD ["node", "server.js"]