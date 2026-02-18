# Stage 1: Build client
FROM node:20-alpine AS build

WORKDIR /app

# Copy workspace root package files
COPY package.json package-lock.json tsconfig.base.json ./
COPY client/package.json client/
COPY server/package.json server/

# Install all dependencies (including devDependencies for Vite build)
RUN npm ci

# Copy source code
COPY client/ client/
COPY server/ server/

# Build client (Vite SPA → client/dist/) and server (tsc → server/dist/)
RUN npm run build -w client && npm run build -w server

# Stage 2: Production image
FROM node:20-alpine

WORKDIR /app

# Copy workspace root package files
COPY package.json package-lock.json ./
COPY server/package.json server/

# Install production dependencies only (server workspace)
RUN npm ci --omit=dev --workspace=server

# Copy compiled server from build stage
COPY --from=build /app/server/dist server/dist/

# Copy built client assets from build stage
COPY --from=build /app/client/dist client/dist/

EXPOSE 8080
ENV PORT=8080

CMD ["npm", "start"]
