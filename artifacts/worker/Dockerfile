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
COPY artifacts/worker ./artifacts/worker
COPY lib/simulation-engine ./lib/simulation-engine
RUN pnpm install --offline --frozen-lockfile --filter @workspace/worker...
RUN pnpm --filter @workspace/worker build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /workspace/artifacts/worker/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
