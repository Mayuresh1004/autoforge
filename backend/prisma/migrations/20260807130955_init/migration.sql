-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VulnerabilitySeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "VulnerabilityStatus" AS ENUM ('DETECTED', 'CONFIRMED', 'EXPLOITABLE', 'PATCHED', 'FALSE_POSITIVE', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "ExploitStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'NOT_EXPLOITABLE');

-- CreateEnum
CREATE TYPE "PatchStatus" AS ENUM ('GENERATED', 'VALIDATED', 'APPLIED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('SCOUT', 'SNIPER', 'ENGINEER', 'CRITIC');

-- CreateEnum
CREATE TYPE "AgentExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "RepositoryProvider" AS ENUM ('GITHUB', 'GITLAB', 'BITBUCKET', 'LOCAL');

-- CreateTable
CREATE TABLE "scans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "scannerStats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "provider" "RepositoryProvider" NOT NULL DEFAULT 'GITHUB',
    "branch" TEXT NOT NULL DEFAULT 'main',
    "language" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_repositories" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vulnerabilities" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "VulnerabilitySeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "VulnerabilityStatus" NOT NULL DEFAULT 'DETECTED',
    "filePath" TEXT,
    "lineNumber" INTEGER,
    "cweId" TEXT,
    "cveRecordId" TEXT,
    "scanner" TEXT,
    "vulnType" TEXT,
    "confidence" DOUBLE PRECISION,
    "message" TEXT,
    "cve" TEXT,
    "references" JSONB,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vulnerabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exploits" (
    "id" TEXT NOT NULL,
    "vulnerabilityId" TEXT NOT NULL,
    "status" "ExploitStatus" NOT NULL DEFAULT 'PENDING',
    "proofOfConcept" TEXT,
    "attackVector" TEXT,
    "impact" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exploits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patches" (
    "id" TEXT NOT NULL,
    "vulnerabilityId" TEXT NOT NULL,
    "status" "PatchStatus" NOT NULL DEFAULT 'GENERATED',
    "diffContent" TEXT,
    "filePath" TEXT,
    "explanation" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_executions" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "status" "AgentExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB,
    "output" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cve_records" (
    "id" TEXT NOT NULL,
    "cveId" TEXT NOT NULL,
    "description" TEXT,
    "severity" "VulnerabilitySeverity",
    "cvssScore" DOUBLE PRECISION,
    "cvssVector" TEXT,
    "publishedAt" TIMESTAMP(3),
    "modifiedAt" TIMESTAMP(3),
    "references" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cve_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scans_status_idx" ON "scans"("status");

-- CreateIndex
CREATE INDEX "scans_createdAt_idx" ON "scans"("createdAt");

-- CreateIndex
CREATE INDEX "repositories_provider_idx" ON "repositories"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_url_branch_key" ON "repositories"("url", "branch");

-- CreateIndex
CREATE UNIQUE INDEX "scan_repositories_scanId_repositoryId_key" ON "scan_repositories"("scanId", "repositoryId");

-- CreateIndex
CREATE INDEX "vulnerabilities_scanId_idx" ON "vulnerabilities"("scanId");

-- CreateIndex
CREATE INDEX "vulnerabilities_severity_idx" ON "vulnerabilities"("severity");

-- CreateIndex
CREATE INDEX "vulnerabilities_status_idx" ON "vulnerabilities"("status");

-- CreateIndex
CREATE INDEX "vulnerabilities_scanner_idx" ON "vulnerabilities"("scanner");

-- CreateIndex
CREATE INDEX "vulnerabilities_cveRecordId_idx" ON "vulnerabilities"("cveRecordId");

-- CreateIndex
CREATE INDEX "exploits_vulnerabilityId_idx" ON "exploits"("vulnerabilityId");

-- CreateIndex
CREATE INDEX "exploits_status_idx" ON "exploits"("status");

-- CreateIndex
CREATE INDEX "patches_vulnerabilityId_idx" ON "patches"("vulnerabilityId");

-- CreateIndex
CREATE INDEX "patches_status_idx" ON "patches"("status");

-- CreateIndex
CREATE INDEX "agent_executions_scanId_idx" ON "agent_executions"("scanId");

-- CreateIndex
CREATE INDEX "agent_executions_agentType_idx" ON "agent_executions"("agentType");

-- CreateIndex
CREATE INDEX "agent_executions_status_idx" ON "agent_executions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "cve_records_cveId_key" ON "cve_records"("cveId");

-- CreateIndex
CREATE INDEX "cve_records_cveId_idx" ON "cve_records"("cveId");

-- CreateIndex
CREATE INDEX "cve_records_severity_idx" ON "cve_records"("severity");

-- AddForeignKey
ALTER TABLE "scan_repositories" ADD CONSTRAINT "scan_repositories_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_repositories" ADD CONSTRAINT "scan_repositories_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vulnerabilities" ADD CONSTRAINT "vulnerabilities_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vulnerabilities" ADD CONSTRAINT "vulnerabilities_cveRecordId_fkey" FOREIGN KEY ("cveRecordId") REFERENCES "cve_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exploits" ADD CONSTRAINT "exploits_vulnerabilityId_fkey" FOREIGN KEY ("vulnerabilityId") REFERENCES "vulnerabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patches" ADD CONSTRAINT "patches_vulnerabilityId_fkey" FOREIGN KEY ("vulnerabilityId") REFERENCES "vulnerabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
