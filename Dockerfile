# =============================================================================
# ZAM Context Governance API — Production Dockerfile
#
# Multi-stage build. Source code is compiled in the builder stage and excluded
# from the production image. The final image contains only compiled JavaScript
# and production npm packages — no TypeScript source, no test files, no schemas.
#
# Canonical: docs/31_PRODUCT_DISTRIBUTION_AND_PACKAGING.md §3 DQ-1 through DQ-8.
# =============================================================================


# -----------------------------------------------------------------------------
# Stage 1: builder
# Installs all dependencies (including devDependencies) and compiles TypeScript.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better layer caching — only re-runs when lock file changes)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build


# -----------------------------------------------------------------------------
# Stage 2: production
# Installs only production dependencies and copies the compiled dist/ from builder.
# The final image contains zero TypeScript source files.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy compiled output from builder stage (no TypeScript source included)
COPY --from=builder /app/dist ./dist/

# Create a non-root user and group for security hardening (docs/31 §3 DQ-8)
RUN addgroup -S zamgroup && adduser -S zamuser -G zamgroup

# Default environment variable configuration (docs/31 §3 DQ-6)
# ZAM_HOST must be 0.0.0.0 in Docker so the server is reachable from the host.
# ZAM_LOG_LEVEL defaults to 'info' so consumers can see startup logs.
# ZAM_PORT and ZAM_API_KEY are intentionally left unset here — provide at runtime.
ENV ZAM_HOST=0.0.0.0
ENV ZAM_LOG_LEVEL=info

# Run as non-root user
USER zamuser

# Document the default port (consumers map this to a host port, e.g. -p 3001:3000)
EXPOSE 3000

# Docker health check — uses wget (available in Alpine by default) to poll /health.
# /health bypasses API key authentication by design (docs/31 §3 DQ-7).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://localhost:3000/health | grep -q '"status":"ok"' || exit 1

# Start the ZAM HTTP service
CMD ["node", "dist/http-server.js"]
