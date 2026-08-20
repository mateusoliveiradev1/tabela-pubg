FROM node:24-alpine AS base
ARG APP
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

FROM base AS builder
ARG APP
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm --filter "@pubg-camp/${APP}..." build \
    && pnpm --filter "@pubg-camp/${APP}" deploy --prod --legacy /prod

FROM node:24-alpine AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 app && adduser --system --uid 1001 --ingroup app app
WORKDIR /app
COPY --from=builder --chown=app:app /prod ./
USER app
CMD ["node", "dist/main.js"]
