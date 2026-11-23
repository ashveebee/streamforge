# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY package.json ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
CMD ["node", "dist-server/index.js"]
