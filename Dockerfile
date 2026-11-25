# syntax=docker/dockerfile:1
# Multi-architecture safe Linux (Debian glibc) container for SnapDeploy (Port 3000)
FROM node:22-bookworm-slim

WORKDIR /app

# Ensure devDependencies (vite, tailwindcss, vite-plugin-pwa) and optional native bindings
# (@rolldown/binding-*, @tailwindcss/oxide-*, lightningcss-*, @esbuild/*) install cleanly
ENV NODE_ENV=development
ENV npm_config_include=optional

# Copy dependency manifests first for layer caching
COPY package.json package-lock.json* .npmrc ./

# Install dependencies; verify rolldown binding loads (recovers from npm optionalDependencies bug)
RUN (npm ci --include=optional --no-audit --no-fund && node -e "import('rolldown')") \
  || (rm -rf node_modules package-lock.json && npm install --include=optional --no-audit --no-fund)

# Copy application source
COPY . .

# Build Vite frontend into dist/
RUN npm run build

# Switch to production runtime and start Express + TypeScript backend on port 3000
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
