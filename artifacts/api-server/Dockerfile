# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE
ARG PNPM_VERSION=11.19.0

FROM ${NODE_IMAGE} AS toolchain
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
RUN node -e "const [major,minor]=process.versions.node.split('.').map(Number);if(major!==22||minor<13)process.exit(1)"
WORKDIR /workspace

FROM toolchain AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --frozen-lockfile

FROM dependencies AS build
COPY tsconfig.json tsconfig.base.json ./
COPY artifacts/api-server ./artifacts/api-server
COPY lib/api-zod ./lib/api-zod
COPY lib/db ./lib/db
COPY lib/simulation-engine ./lib/simulation-engine
RUN pnpm install --offline --frozen-lockfile --filter @workspace/api-server...
RUN pnpm --filter @workspace/api-server build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /workspace/artifacts/api-server/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/api/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
