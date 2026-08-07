import type { TechnologySignal } from '../signal';

/**
 * Database detection from client libraries and orchestrator config.
 */
export const DATABASE_SIGNALS: readonly TechnologySignal[] = [
  {
    name: 'PostgreSQL',
    category: 'database',
    confidence: 0.95,
    pkgDependencies: ['pg', 'pg-promise', 'pgvector', '@neondatabase/serverless', 'postgres'],
    pyDependencies: ['psycopg2', 'psycopg', 'asyncpg'],
    manifestContains: [{ path: 'docker-compose.yml', needle: 'postgres' }],
  },
  {
    name: 'MySQL',
    category: 'database',
    confidence: 0.9,
    pkgDependencies: ['mysql', 'mysql2'],
    pyDependencies: ['pymysql', 'mysql-connector-python'],
    manifestContains: [{ path: 'docker-compose.yml', needle: 'mysql' }],
  },
  {
    name: 'MongoDB',
    category: 'database',
    confidence: 0.95,
    pkgDependencies: ['mongodb', 'mongoose'],
    pyDependencies: ['pymongo'],
    manifestContains: [{ path: 'docker-compose.yml', needle: 'mongo' }],
  },
  {
    name: 'SQLite',
    category: 'database',
    confidence: 0.85,
    pkgDependencies: ['better-sqlite3', 'sqlite3'],
    pyDependencies: ['sqlite3', 'aiosqlite'],
    extensions: ['sqlite', 'sqlite3', 'db'],
  },
  {
    name: 'Redis',
    category: 'database',
    confidence: 0.95,
    pkgDependencies: ['ioredis', 'redis'],
    pyDependencies: ['redis'],
    manifestContains: [{ path: 'docker-compose.yml', needle: 'redis' }],
  },
  {
    name: 'Vector Database',
    category: 'database',
    confidence: 0.9,
    pkgDependencies: ['@qdrant/js-client-rest', 'qdrant-js'],
    pyDependencies: ['qdrant-client', 'chromadb', 'weaviate-client', 'pinecone', 'pgvector', 'milvus'],
    manifestContains: [{ path: 'docker-compose.yml', needle: 'qdrant' }],
  },
  {
    name: 'Elasticsearch',
    category: 'database',
    confidence: 0.9,
    pkgDependencies: ['@elastic/elasticsearch', 'elasticsearch'],
    pyDependencies: ['elasticsearch'],
    manifestContains: [{ path: 'docker-compose.yml', needle: 'elasticsearch' }],
  },
  {
    name: 'DynamoDB',
    category: 'database',
    confidence: 0.8,
    pkgDependencies: ['@aws-sdk/client-dynamodb'],
    pyDependencies: ['boto3'],
  },
  {
    name: 'Neo4j',
    category: 'database',
    confidence: 0.85,
    pkgDependencies: ['neo4j-driver'],
    pyDependencies: ['neo4j'],
  },
];