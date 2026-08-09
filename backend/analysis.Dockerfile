FROM node:20-alpine AS base
WORKDIR /app

FROM base AS runner
# git is required to clone target repositories.
# util-linux provides unshare for namespace isolation.
# python3/pip are required for semgrep, bandit, and pip-audit.
RUN apk add --no-cache git util-linux python3 py3-pip
RUN pip install --no-cache-dir --break-system-packages --timeout 120 --retries 10 semgrep bandit pip-audit
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 amass && \
    chown -R amass:nodejs /app
ENV ANALYZER_WORKSPACE_DIR=/app/workspace
USER amass
