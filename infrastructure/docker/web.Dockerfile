# Next.js PWA image. Build: docker build -f infrastructure/docker/web.Dockerfile --build-arg APP=applicant-web .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG APP=applicant-web
# The /api proxy target is resolved by `next build`, so it must be a build arg.
ARG API_INTERNAL_URL=http://localhost:4000
ARG API_PUBLIC_URL=http://localhost:4000
ARG NEXT_PUBLIC_MARKETING_ENABLED=true
ARG NEXT_PUBLIC_BUSINESS_APP_URL
ARG NEXT_PUBLIC_VERIFIER_APP_URL
ENV API_INTERNAL_URL=$API_INTERNAL_URL API_PUBLIC_URL=$API_PUBLIC_URL NEXT_PUBLIC_MARKETING_ENABLED=$NEXT_PUBLIC_MARKETING_ENABLED NEXT_PUBLIC_BUSINESS_APP_URL=$NEXT_PUBLIC_BUSINESS_APP_URL NEXT_PUBLIC_VERIFIER_APP_URL=$NEXT_PUBLIC_VERIFIER_APP_URL
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @avn/${APP} build

FROM node:22-bookworm-slim AS runtime
ARG APP=applicant-web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /repo/apps/${APP}/.next/standalone ./
COPY --from=build /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build /repo/apps/${APP}/public ./apps/${APP}/public
RUN useradd --system --uid 10001 avn && echo "apps/${APP}/server.js" > /app/.entry
USER avn
EXPOSE 3000
CMD ["sh", "-c", "node $(cat /app/.entry)"]
