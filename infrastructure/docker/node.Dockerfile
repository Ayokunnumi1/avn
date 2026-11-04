# API and worker image. Build: docker build -f infrastructure/docker/node.Dockerfile --build-arg APP=api .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
ARG APP=api
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @avn/database db:generate && pnpm --filter @avn/${APP} build
RUN pnpm --filter @avn/${APP} deploy --prod --legacy /out && cp -r apps/${APP}/dist /out/dist \
 && cp -r packages/database/prisma /out/prisma \
 && cd /out && npx --yes prisma@6.19.3 generate --schema=prisma/schema.prisma

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
RUN useradd --system --uid 10001 avn && mkdir -p /app/storage-data && chown -R avn /app/storage-data
USER avn
EXPOSE 4000
# API: run migrations on release (see infrastructure/deployment/README.md), then start.
CMD ["node", "dist/index.js"]
