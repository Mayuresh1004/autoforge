-- CreateTable
CREATE TABLE "attack_plans" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coveredSurfaces" INTEGER NOT NULL DEFAULT 0,
    "coveredFindings" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,

    CONSTRAINT "attack_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planned_attack_targets" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "candidateVulnerabilities" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "recommendedTool" TEXT NOT NULL DEFAULT 'none',
    "reason" TEXT NOT NULL,
    "requiresAuthentication" BOOLEAN NOT NULL DEFAULT false,
    "estimatedRisk" TEXT NOT NULL DEFAULT 'LOW',
    "breakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planned_attack_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attack_plans_scanId_idx" ON "attack_plans"("scanId");

-- CreateIndex
CREATE INDEX "attack_plans_createdAt_idx" ON "attack_plans"("createdAt");

-- CreateIndex
CREATE INDEX "planned_attack_targets_planId_idx" ON "planned_attack_targets"("planId");

-- CreateIndex
CREATE INDEX "planned_attack_targets_scanId_idx" ON "planned_attack_targets"("scanId");

-- AddForeignKey
ALTER TABLE "attack_plans" ADD CONSTRAINT "attack_plans_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_attack_targets" ADD CONSTRAINT "planned_attack_targets_planId_fkey" FOREIGN KEY ("planId") REFERENCES "attack_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
