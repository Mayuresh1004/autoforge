-- Critic Agent (Phase 8)
-- 1) extend the patch status enum with review states (never APPLIED here).
ALTER TYPE "PatchStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "PatchStatus" ADD VALUE IF NOT EXISTS 'APPROVED';

-- 2) critic run results (one row per Engineer attempt; attempts preserved).
CREATE TYPE "CriticStatus" AS ENUM ('APPROVED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "critic_runs" (
    "id" TEXT NOT NULL,
    "patchId" TEXT NOT NULL,
    "vulnerabilityId" TEXT NOT NULL,
    "scanId" TEXT,
    "executionId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "CriticStatus" NOT NULL,
    "failureReason" TEXT,
    "checks" JSONB,
    "exploitResult" JSONB,
    "feedback" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "critic_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "critic_runs_patchId_idx" ON "critic_runs"("patchId");
CREATE INDEX "critic_runs_vulnerabilityId_idx" ON "critic_runs"("vulnerabilityId");
CREATE INDEX "critic_runs_executionId_idx" ON "critic_runs"("executionId");

-- AddForeignKey
ALTER TABLE "critic_runs" ADD CONSTRAINT "critic_runs_patchId_fkey" FOREIGN KEY ("patchId") REFERENCES "patches"("id") ON DELETE CASCADE ON UPDATE CASCADE;