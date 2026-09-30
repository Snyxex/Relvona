FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
ARG INFISICAL_CLI_VERSION=0.43.116
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN apk add --no-cache git
COPY package*.json ./
RUN GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf \
    GIT_CONFIG_VALUE_0=ssh://git@github.com/ \
    npm ci
RUN npm install --global @infisical/cli@${INFISICAL_CLI_VERSION}
COPY . .
RUN chmod +x infisical-entrypoint.sh
RUN npm run build
ENTRYPOINT ["/app/infisical-entrypoint.sh"]

# Used by the one-shot migration service; runtime image remains production-only.
FROM build AS migrator

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app
ENV NODE_ENV=production PUPPETEER_SKIP_DOWNLOAD=true
ARG INFISICAL_CLI_VERSION=0.43.116
RUN apk add --no-cache git
COPY package*.json ./
RUN GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf \
    GIT_CONFIG_VALUE_0=ssh://git@github.com/ \
    npm ci --omit=dev
RUN npm install --global @infisical/cli@${INFISICAL_CLI_VERSION}
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/infisical-entrypoint.sh /usr/local/bin/infisical-entrypoint
USER node
ENTRYPOINT ["/usr/local/bin/infisical-entrypoint"]
EXPOSE 8080
CMD ["node", "dist/index.js"]
