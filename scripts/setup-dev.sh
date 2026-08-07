#!/usr/bin/env bash
# Development setup script for AMASS
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== AMASS Development Setup ==="

# Copy environment file
if [ ! -f "${ROOT_DIR}/.env" ]; then
  cp "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env"
  echo "Created .env from .env.example"
else
  echo ".env already exists"
fi

# Install Node dependencies
echo "Installing Node.js dependencies..."
cd "${ROOT_DIR}"
npm install

# Start infrastructure services
echo "Starting infrastructure services (PostgreSQL, Redis, Qdrant)..."
docker compose -f docker/docker-compose.yml up -d postgres redis qdrant

# Wait for services
echo "Waiting for services to be ready..."
bash "${SCRIPT_DIR}/wait-for-it.sh" localhost:5432
bash "${SCRIPT_DIR}/wait-for-it.sh" localhost:6379
bash "${SCRIPT_DIR}/wait-for-it.sh" localhost:6333

# Initialize Qdrant
bash "${SCRIPT_DIR}/init-qdrant.sh"

# Run database migrations
bash "${SCRIPT_DIR}/db-migrate.sh"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Start development:"
echo "  npm run dev              # All services via Turbo"
echo "  npm run docker:up        # Full Docker stack"
echo ""
echo "Individual services:"
echo "  cd backend && npm run dev"
echo "  cd frontend && npm run dev"
echo "  cd agents && uvicorn app.main:create_app --factory --reload"
