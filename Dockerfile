FROM node:22.23.4-bookworm-slim

WORKDIR /app

# Install dependencies first (better layer caching); reproducible install from
# the lockfile, production dependencies only.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Run as the unprivileged node user shipped with the base image
USER node

# Expose port (default 3000)
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start command
CMD ["npm", "start"]
