FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY backend/package.json ./
RUN npm install

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 amass
USER amass
COPY --from=builder --chown=amass:nodejs /app/dist ./dist
COPY --from=builder --chown=amass:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=amass:nodejs /app/package.json ./
COPY --from=builder --chown=amass:nodejs /app/prisma ./prisma
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1
CMD ["node", "dist/index.js"]
