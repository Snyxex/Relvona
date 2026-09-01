FROM node:22-alpine AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Used by the one-shot migration service; runtime image remains production-only.
FROM build AS migrator

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
EXPOSE 8080
CMD ["node", "dist/index.js"]
