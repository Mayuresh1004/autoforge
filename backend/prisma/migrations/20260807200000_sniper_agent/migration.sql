-- Sniper Agent (M15): exploit verification.
-- Extends the Exploit model to the full verification lifecycle and adds
-- per-attempt + evidence tables. Tables are empty at this stage, so the
-- enum can be recreated freely.

-- 1. ExploitStatus: replace the boolean-ish set with the explicit states
--    (NOT_TESTED / TESTING / CONFIRMED / NOT_CONFIRMED / INCONCLUSIVE / FAILED).
ALTER TYPE "ExploitStatus" RENAME TO "ExploitStatus_old";
CREATE TYPE "ExploitStatus" AS ENUM ('NOT_TESTED', 'TESTING', 'CONFIRMED', 'NOT_CONFIRMED', 'INCONCLUSIVE', 'FAILED');
ALTER TABLE "exploits" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "exploits" ALTER COLUMN "status" TYPE "ExploitStatus" USING "status"::text::"ExploitStatus";
ALTER TABLE "exploits" ALTER COLUMN "status" SET DEFAULT 'NOT_TESTED';
DROP TYPE "ExploitStatus_old";

-- Extend exploits: scan + target identity, verification fields.
ALTER TABLE "exploits" ADD COLUMN "targetId" TEXT;
ALTER TABLE "exploits" ADD COLUMN "scanId" TEXT NOT NULL;
ALTER TABLE "exploits" ADD COLUMN "endpoint" TEXT NOT NULL DEFAULT '';
ALTER TABLE "exploits" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'GET';
ALTER TABLE "exploits" ADD COLUMN "vulnerabilityType" TEXT;
ALTER TABLE "exploits" ADD COLUMN "parameter" TEXT;
ALTER TABLE "exploits" ADD COLUMN "tool" TEXT;
ALTER TABLE "exploits" ADD COLUMN "confidence" DOUBLE PRECISION;
ALTER TABLE "exploits" ADD COLUMN "confidenceBreakdown" JSONB;
ALTER TABLE "exploits" ADD COLUMN "statusReason" TEXT;
ALTER TABLE "exploits" ADD COLUMN "toolSummary" TEXT;
ALTER TABLE "exploits" ADD COLUMN "errorMessage" TEXT;
ALTER TABLE "exploits" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "exploits" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "exploits" ADD COLUMN "durationMs" INTEGER;

-- vulnerabilityId becomes optional (a planned target may not map 1:1 to a
-- static finding) and its deletion behavior softens to SetNull.
ALTER TABLE "exploits" ALTER COLUMN "vulnerabilityId" DROP NOT NULL;
ALTER TABLE "exploits" DROP CONSTRAINT "exploits_vulnerabilityId_fkey";
ALTER TABLE "exploits" ADD CONSTRAINT "exploits_vulnerabilityId_fkey" FOREIGN KEY ("vulnerabilityId") REFERENCES "vulnerabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Scan ownership.
ALTER TABLE "exploits" ADD CONSTRAINT "exploits_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes for Sniper lookups. (`exploits_status_idx` already exists from init.)
CREATE INDEX "exploits_targetId_idx" ON "exploits"("targetId");
CREATE INDEX "exploits_scanId_idx" ON "exploits"("scanId");

-- CreateTable: verification_attempts
CREATE TABLE "verification_attempts" (
    "id" TEXT NOT NULL,
    "exploitId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "verifier" TEXT NOT NULL,
    "tool" TEXT,
    "status" "ExploitStatus" NOT NULL,
    "evidence" JSONB,
    "stdout" TEXT,
    "stderr" TEXT,
    "errorMessage" TEXT,
    "exitCode" INTEGER,
    "timedOut" BOOLEAN NOT NULL DEFAULT false,
    "retried" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: verification_attempts
CREATE INDEX "verification_attempts_exploitId_idx" ON "verification_attempts"("exploitId");
CREATE INDEX "verification_attempts_status_idx" ON "verification_attempts"("status");

-- AddForeignKey: verification_attempts -> exploits
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_exploitId_fkey" FOREIGN KEY ("exploitId") REFERENCES "exploits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: exploit_evidence
CREATE TABLE "exploit_evidence" (
    "id" TEXT NOT NULL,
    "exploitId" TEXT NOT NULL,
    "indicator" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "detail" TEXT,
    "confidenceFactor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exploit_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: exploit_evidence
CREATE INDEX "exploit_evidence_exploitId_idx" ON "exploit_evidence"("exploitId");

-- AddForeignKey: exploit_evidence -> exploits
ALTER TABLE "exploit_evidence" ADD CONSTRAINT "exploit_evidence_exploitId_fkey" FOREIGN KEY ("exploitId") REFERENCES "exploits"("id") ON DELETE CASCADE ON UPDATE CASCADE;