# Override to build from a registry mirror, e.g.
#   NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim docker compose build
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries, so no install scripts are needed.
RUN npm ci --no-audit --no-fund --ignore-scripts

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
# ffmpeg converts uploaded videos to MP4 that every browser plays, makes
# posters, and extracts audio for transcripts. Build with
# --build-arg INSTALL_FFMPEG=false for a smaller image that serves uploads as-is.
ARG INSTALL_FFMPEG=true
RUN if [ "$INSTALL_FFMPEG" = "true" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends ffmpeg \
      && rm -rf /var/lib/apt/lists/*; \
    fi
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data
# The standalone output already contains server.js, the traced node_modules
# (including better-sqlite3's native binding), static assets, public/ and the
# SQL migrations (see scripts/postbuild.mjs).
COPY --from=build --chown=node:node /app/.next/standalone ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
