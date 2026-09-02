FROM node:22-alpine AS build
WORKDIR /app
ARG INFISICAL_CLI_VERSION=0.43.116
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
RUN npm ci
RUN npm install --global @infisical/cli@${INFISICAL_CLI_VERSION}
COPY . .
RUN chmod +x infisical-entrypoint.sh
RUN npm run build
ENTRYPOINT ["/app/infisical-entrypoint.sh"]

# Used by the one-shot migration service; runtime image remains production-only.
FROM build AS migrator

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PUPPETEER_SKIP_DOWNLOAD=true
ARG INFISICAL_CLI_VERSION=0.43.116
COPY package*.json ./
RUN npm ci --omit=dev
RUN npm install --global @infisical/cli@${INFISICAL_CLI_VERSION}
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/infisical-entrypoint.sh /usr/local/bin/infisical-entrypoint
ENTRYPOINT ["/usr/local/bin/infisical-entrypoint"]
EXPOSE 8080
CMD ["node", "dist/index.js"]
