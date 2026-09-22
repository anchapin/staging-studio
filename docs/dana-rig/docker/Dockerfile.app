FROM node:22-slim

# git (temp patch apply/revert), curl (healthchecks), build tools for native deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends git curl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm i -g tsx --no-audit --no-fund

WORKDIR /repo

# Pre-create node_modules and .next directories so named volumes inherit writable permissions
# for non-root container users.
RUN mkdir -p /repo/node_modules /repo/.next && chmod 777 /repo/node_modules /repo/.next

# Put entrypoint in /entrypoint-app.sh so mounting the host rig to /rig does not shadow it.
COPY entrypoint-app.sh /entrypoint-app.sh
RUN chmod 755 /entrypoint-app.sh

ENTRYPOINT ["/entrypoint-app.sh"]
