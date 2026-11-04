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
 && cd /out && npx prisma generate --schema=prisma/schema.prisma

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
RUN useradd --system --uid 10001 avn && mkdir -p /app/storage-data && chown -R avn /app/storage-data
USER avn
EXPOSE 4000
# Migrations run as a pre-deploy step: npx prisma migrate deploy --schema=prisma/schema.prisma
# SEED_DEMO_DATA=true (API, non-production only) loads the fictional demo data once, on the live volume.
CMD ["sh", "-c", "if [ \"$SEED_DEMO_DATA\" = \"true\" ] && [ -f dist/seed.js ]; then node dist/seed.js || exit 1; fi; exec node dist/index.js"]
