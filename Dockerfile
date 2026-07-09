# ---- Stage 1: build ----
FROM node:20-slim AS build
WORKDIR /app

# Install build deps separately so layer caches well
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy sources and produce the production bundle
COPY . .
RUN npm run build

# Strip dev deps so they don't bloat the runtime stage
RUN npm prune --omit=dev

# ffprobe-static ships ffprobe binaries for ALL platforms in its npm tarball
# (darwin ~133MB + win32 ~104MB + linux ~100MB). Only linux runs in this
# container — delete the macOS/Windows binaries (~237MB) so they never ship.
RUN rm -rf node_modules/ffprobe-static/bin/darwin node_modules/ffprobe-static/bin/win32


# ---- Stage 2: runtime ----
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000 \
    NPM_CONFIG_LOGLEVEL=warn

# Non-root user (uid 10001 — fixed so volume mounts are predictable)
RUN groupadd --system --gid 10001 visionclaw \
 && useradd  --system --uid 10001 --gid visionclaw --home /app --shell /usr/sbin/nologin visionclaw \
 && mkdir -p /app/uploads /app/dist \
 && chown -R visionclaw:visionclaw /app

# Copy only what the runtime needs
COPY --from=build --chown=visionclaw:visionclaw /app/dist ./dist
COPY --from=build --chown=visionclaw:visionclaw /app/node_modules ./node_modules
COPY --from=build --chown=visionclaw:visionclaw /app/package.json ./package.json
COPY --from=build --chown=visionclaw:visionclaw /app/shared ./shared
COPY --from=build --chown=visionclaw:visionclaw /app/scripts ./scripts
COPY --from=build --chown=visionclaw:visionclaw /app/drizzle.config.ts ./drizzle.config.ts
# Runtime data assets — explicit allowlist (NOT a broad data/ copy).
# Broad copy would embed PII (data/owner-email-digest*.json, data/task-workspaces/** customer artifacts)
# and sensitive config (data/browser-config.json) into the runtime image. List each file explicitly.
COPY --from=build --chown=visionclaw:visionclaw /app/data/qr-code-agenticcorporation.png   ./data/qr-code-agenticcorporation.png
COPY --from=build --chown=visionclaw:visionclaw /app/data/visionclaw-logo.png              ./data/visionclaw-logo.png
COPY --from=build --chown=visionclaw:visionclaw /app/data/ARCHITECTURE.md                  ./data/ARCHITECTURE.md
COPY --from=build --chown=visionclaw:visionclaw /app/data/Felix-Presentation-Instructions.txt ./data/Felix-Presentation-Instructions.txt
COPY --from=build --chown=visionclaw:visionclaw /app/data/VisionClaw-Comprehensive-Features.txt ./data/VisionClaw-Comprehensive-Features.txt
COPY --from=build --chown=visionclaw:visionclaw /app/data/monid/catalog-curated.json       ./data/monid/catalog-curated.json
COPY --from=build --chown=visionclaw:visionclaw /app/data/output-skills                    ./data/output-skills
# Writable runtime dirs (system-state.json, task-workspaces/) are created on first write by app code.
RUN mkdir -p /app/data/task-workspaces && chown -R visionclaw:visionclaw /app/data

USER visionclaw

EXPOSE 5000

# Healthcheck hits the public health endpoint exposed by server/index.ts
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+ (process.env.PORT||5000) +'/healthz', r => process.exit(r.statusCode<500?0:1)).on('error', () => process.exit(1))"

CMD ["npm", "start"]
