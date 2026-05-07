FROM node:22-bookworm-slim AS deps

WORKDIR /code/primarie-composer
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:22-bookworm-slim AS build

WORKDIR /code/primarie-composer
COPY --from=deps /code/primarie-composer/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /code/primarie-composer
ENV NODE_ENV=production

# Host-level Docker and Git actions are executed by the FIFO bus worker.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    procps \
    openssh-client \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /code/primarie-composer/node_modules ./node_modules
COPY --from=build /code/primarie-composer/dist ./dist
COPY package.json ./

EXPOSE 3000
CMD ["node", "dist/main.js"]
