# The open-slide decks (../my-deck), passed in as the "decks" build context by docker-compose:
#   docker build --build-context decks=../my-deck ./frontend
FROM node:22-alpine AS decks-build
WORKDIR /decks
COPY --from=decks package.json package-lock.json ./
RUN npm ci
COPY --from=decks . .
RUN npx open-slide build --out-dir /out

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Served by Next.js at /decks (see the rewrites in next.config.ts).
COPY --from=decks-build /out ./public/decks
# BACKEND_URL is baked into the /api rewrite at build time.
ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=$BACKEND_URL
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# npm is only needed to build. The base image's npm bundles its own old dependencies (brace-expansion,
# picomatch, pacote...) that image scans flag, so the runtime starts Next directly and drops npm.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app ./
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]
