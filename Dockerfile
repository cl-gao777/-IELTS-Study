FROM node:22-bookworm AS dependencies

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=ists-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS builder

COPY . .

RUN pnpm build

FROM node:22-bookworm AS runner

ENV NODE_ENV=production
ENV PORT=40486
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL=file:/app/data/ists.db
ENV UPLOAD_DIR=/app/data/uploads

WORKDIR /app

RUN mkdir -p /app/data/uploads && chown -R node:node /app

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 40486

CMD ["node", "server.js"]
