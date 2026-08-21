# 1. Builder Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy shared module first (needed for build)
COPY shared /app/shared

# Copy frontend files
COPY frontend/package*.json ./
RUN npm ci

# Copy the rest of the frontend
COPY frontend/. .

# Build the app
RUN mkdir -p public
RUN npm run build

# 2. Production Runner Stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV production
ENV HOSTNAME 0.0.0.0
ENV PORT 3000

# Copy shared module
COPY shared /app/shared

# Copy package files and install only production dependencies
COPY frontend/package*.json ./
RUN npm ci --only=production

# Copy built assets and configuration from builder with non-root ownership
COPY --from=builder --chown=node:node /app/next.config.mjs ./
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public

USER node

EXPOSE 3000

CMD ["npx", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
