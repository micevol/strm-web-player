# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Install production dependencies only
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# ---- Runtime stage ----
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

RUN mkdir -p /app/server /app/public /data

# Copy app source
COPY --from=build /app/server/node_modules /app/server/node_modules
COPY server /app/server
COPY public /app/public

# Runtime volume for persistent user accounts
VOLUME /data

ENV STRM_DIR=/data/strm \
    PORT=3000 \
    USER_DB_PATH=/data/users.json

EXPOSE 3000

WORKDIR /app/server
CMD ["node", "src/index.js"]