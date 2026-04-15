# Build stage
FROM oven/bun:slim AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

COPY src ./src
RUN bun run build:ws:standalone

# Production stage
FROM debian:bookworm-slim AS production

WORKDIR /app

COPY --from=builder /app/dist/discord-ws ./discord-ws

ENV NODE_ENV=production

CMD ["./discord-ws", "--title=Honeypot-WS"]
