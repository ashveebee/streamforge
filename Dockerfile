# syntax=docker/dockerfile:1

# ---- build: compile the UI and server once, on the runner's native platform ----
FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Release builds pass VERSION; local builds fall back to package.json.
ARG VERSION=""
RUN STREAMFORGE_VERSION="${VERSION}" npm run build

# ---- deps: production dependencies for the target platform ----
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

# ---- runtime ----
FROM node:26-alpine
ARG VERSION=""
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data \
    STREAMFORGE_VERSION=${VERSION}
WORKDIR /app
# Settings saved from the UI live in a SQLite database here — mount a volume.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY package.json LICENSE.md ./
LABEL org.opencontainers.image.title="StreamForge" \
      org.opencontainers.image.description="A unified control centre for your Jellyfin media server ecosystem" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0" \
      org.opencontainers.image.version="${VERSION}"
USER node
VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
# Silences node:sqlite's ExperimentalWarning on Node versions that still emit it.
CMD ["node", "--disable-warning=ExperimentalWarning", "dist-server/index.js"]
