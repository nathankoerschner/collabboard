# Stage 1: Build client and server
FROM node:20-alpine AS build

WORKDIR /app

# Copy workspace root package files
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/

# Install all dependencies (including devDependencies for Vite build and tsc)
RUN npm ci

# Copy source code
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY client/ client/
COPY server/ server/

# Build client (Vite SPA → client/dist/)
RUN npm run build -w client

# Build server (tsc → server/dist/)
RUN npm run build -w server

# Stage 2: Production image
FROM node:20-alpine

WORKDIR /app

# Copy workspace root package files
COPY package.json package-lock.json ./
COPY server/package.json server/

# Install production dependencies only (server workspace)
RUN npm ci --omit=dev --workspace=server

# Copy compiled server output
COPY --from=build /app/server/dist server/dist/

# Copy SQL migrations (read at runtime)
COPY server/src/migrations server/src/migrations/

# Copy built client assets from build stage
COPY --from=build /app/client/dist client/dist/

EXPOSE 8080
ENV PORT=8080

CMD ["node", "server/dist/server/src/index.js"]
