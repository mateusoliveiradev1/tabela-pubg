FROM node:24-alpine AS base
ARG APP
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

FROM base AS builder
ARG APP
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter "@pubg-camp/${APP}..." build

FROM node:24-alpine AS runner
ARG APP
ENV NODE_ENV=production
ENV APP_NAME=$APP
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && addgroup --system --gid 1001 app && adduser --system --uid 1001 --ingroup app app
WORKDIR /workspace
COPY --from=builder --chown=app:app /workspace/node_modules ./node_modules
COPY --from=builder --chown=app:app /workspace/apps ./apps
COPY --from=builder --chown=app:app /workspace/packages ./packages
COPY --from=builder --chown=app:app /workspace/scripts ./scripts
COPY --from=builder --chown=app:app /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml ./
USER app
CMD ["/bin/sh", "-c", "node apps/$APP_NAME/dist/main.js"]
