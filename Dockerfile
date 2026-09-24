# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy Prisma schema and generate client
COPY prisma/ ./prisma/
RUN npx prisma generate

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Runner
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install dumb-init for signal handling
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd --create-home --shell /bin/bash nextjs \
    && mkdir -p /app && chown nextjs:nextjs /app

USER nextjs

# Copy built artifacts from builder
COPY --from=builder --chown=nextjs:nextjs /app/.next/ ./.next/
COPY --from=builder --chown=nextjs:nextjs /app/public/ ./public/
COPY --from=builder --chown=nextjs:nextjs /app/package.json ./package.json

# Copy Prisma schema for migrations at runtime
COPY --from=builder --chown=nextjs:nextjs /app/prisma/ ./prisma/

# Expose the app port
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Run with dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["npx", "next", "start"]
