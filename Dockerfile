# ── Build stage: install deps and compile CSS ────────────────────────────────
FROM node:22-alpine AS build

RUN apk update && apk upgrade --no-cache

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:css

# ── Production stage ─────────────────────────────────────────────────────────
FROM node:22-alpine AS production

RUN apk update && apk upgrade --no-cache

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Copy built assets and app source from build stage
COPY --from=build /app/public ./public
COPY --from=build /app/views ./views
COPY --from=build /app/routes ./routes
COPY --from=build /app/middleware ./middleware
COPY --from=build /app/app.js ./app.js
COPY --from=build /app/db.js ./db.js
COPY --from=build /app/config.js ./config.js
COPY --from=build /app/logger.js ./logger.js
COPY --from=build /app/mailer.js ./mailer.js

# Run as non-root user
USER node

EXPOSE 3000

CMD ["node", "app.js"]
