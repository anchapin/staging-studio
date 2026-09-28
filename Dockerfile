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

# Drop the dev dependencies now that the build is done, so the runner can
# carry a production node_modules instead of re-installing or, worse,
# resolving a floating `next` off the registry at container boot (#1157).
# The Prisma CLIENT is a prod dependency and its generated engine lives in
# node_modules/.prisma, so both survive this; the `prisma` CLI is a
# devDependency and does not (see the runner stage).
RUN npm prune --omit=dev

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
# `public/` is intentionally EMPTY in this repo (App Router keeps assets in
# src/app; nothing serves from public/ today) but the directory is
# committed, because Docker has no conditional COPY and its absence here
# failed the whole build with "no such file or directory" (#1157). It also
# means the next static asset dropped into public/ is picked up without
# touching this file. tests/dockerfile.test.ts fails if it disappears.
COPY --from=builder --chown=nextjs:nextjs /app/public/ ./public/
COPY --from=builder --chown=nextjs:nextjs /app/package.json ./package.json

# The server needs its dependencies: this stage had none, so `npx next
# start` found no local binary and downloaded an unpinned `next` from the
# registry at boot, serving a version unrelated to the one that built
# .next/ (#1157). Copying the pruned production tree is the fix; the CMD
# below then resolves ./node_modules/.bin/next directly.
COPY --from=builder --chown=nextjs:nextjs /app/node_modules ./node_modules

# Copy the Prisma schema for reference (generate/migrate tooling run
# against this file). Note the `prisma` CLI is a devDependency and is NOT
# in the image, so `npx prisma …` here would fetch an unpinned CLI — the
# app itself only needs the generated client, which is in node_modules.
COPY --from=builder --chown=nextjs:nextjs /app/prisma/ ./prisma/

# Expose the app port
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Run with dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
# The local binary, not `npx next`: npx with no local install downloads a
# floating latest release at container boot (#1157).
CMD ["./node_modules/.bin/next", "start"]
