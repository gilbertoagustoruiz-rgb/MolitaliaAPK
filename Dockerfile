FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN PORT=8080 BASE_PATH=/ pnpm run build:render

FROM node:24-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production PORT=8080 BASE_PATH=/
RUN corepack enable
COPY --from=build /app /app
EXPOSE 8080
CMD ["pnpm", "run", "start:render"]
