# 1. Builder Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy shared module and install its dependencies
COPY shared /app/shared
WORKDIR /app/shared
RUN npm install

# Copy frontend and install dependencies
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci

# Create a symlink to the shared module in node_modules
RUN mkdir -p node_modules/@greenpay && \
    ln -sf /app/shared node_modules/@greenpay/i18n

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
WORKDIR /app/shared
RUN npm install --production

# Copy frontend and install production dependencies
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --only=production

# Create symlink in production
RUN mkdir -p node_modules/@greenpay && \
    ln -sf /app/shared node_modules/@greenpay/i18n

# Copy built assets
COPY --from=builder --chown=node:node /app/next.config.mjs ./
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public

USER node

EXPOSE 3000

CMD ["npx", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
