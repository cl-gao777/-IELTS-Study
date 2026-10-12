FROM node:24-bookworm AS dependencies

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS builder

# Explicit inputs keep private data, environment files, and work products out
# of the build image even when Docker is invoked from a personal installation.
COPY src ./src
COPY public ./public
COPY next.config.ts tsconfig.json postcss.config.mjs ./
RUN npm run build

FROM node:24-bookworm AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=file:/app/data/ists.db
ENV UPLOAD_DIR=/app/data/uploads
WORKDIR /app

# Keep the complete Linux dependency tree: Next's TypeScript config loader and
# PDF/native loaders need packages that a standalone trace can otherwise omit.
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/src/data ./src/data
COPY --from=builder --chown=node:node /app/next.config.ts ./
COPY --chown=node:node LICENSE ./
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data

USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
