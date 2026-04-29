FROM node:22-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# The API controls sibling Docker Compose projects through the host socket.
# docker.io provides the docker CLI; docker-compose is a fallback for hosts
# where the compose plugin is unavailable in the image package repository.
RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io docker-compose \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

EXPOSE 3000
CMD ["node", "dist/main.js"]
