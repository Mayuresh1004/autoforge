#!/usr/bin/env bash
# Initialize Qdrant collection for AMASS embeddings
set -euo pipefail

QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
COLLECTION_NAME="${QDRANT_COLLECTION_NAME:-amass_embeddings}"
DIMENSION="${EMBEDDING_DIMENSION:-1536}"

echo "Initializing Qdrant collection: ${COLLECTION_NAME}"

# Wait for Qdrant to be ready
until curl -sf "${QDRANT_URL}/healthz" > /dev/null 2>&1; do
  echo "Waiting for Qdrant..."
  sleep 2
done

# Check if collection exists
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${QDRANT_URL}/collections/${COLLECTION_NAME}")

if [ "$HTTP_CODE" = "200" ]; then
  echo "Collection '${COLLECTION_NAME}' already exists"
else
  curl -sf -X PUT "${QDRANT_URL}/collections/${COLLECTION_NAME}" \
    -H "Content-Type: application/json" \
    -d "{
      \"vectors\": {
        \"size\": ${DIMENSION},
        \"distance\": \"Cosine\"
      }
    }"
  echo "Collection '${COLLECTION_NAME}' created (dimension: ${DIMENSION})"
fi

echo "Qdrant initialization complete"
