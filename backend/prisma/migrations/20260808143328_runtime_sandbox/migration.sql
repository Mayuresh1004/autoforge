-- CreateEnum
CREATE TYPE "RuntimeSandboxStatus" AS ENUM ('CREATING', 'BUILDING', 'STARTING', 'HEALTH_CHECKING', 'READY', 'FAILED', 'DESTROYING', 'DESTROYED', 'EXPIRED');

-- CreateTable
CREATE TABLE "runtime_sandboxes" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "status" "RuntimeSandboxStatus" NOT NULL DEFAULT 'CREATING',
    "name" TEXT,
    "repositoryUrl" TEXT,
    "repositoryPath" TEXT,
    "sandboxId" TEXT,
    "imageId" TEXT,
    "imageName" TEXT,
    "networkId" TEXT,
    "targetUrl" TEXT,
    "internalHost" TEXT,
    "internalPort" INTEGER,
    "exposedPort" INTEGER,
    "workspacePath" TEXT,
    "failureStage" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "destroyedAt" TIMESTAMP(3),

    CONSTRAINT "runtime_sandboxes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runtime_sandboxes_scanId_idx" ON "runtime_sandboxes"("scanId");

-- CreateIndex
CREATE INDEX "runtime_sandboxes_status_idx" ON "runtime_sandboxes"("status");

-- CreateIndex
CREATE INDEX "runtime_sandboxes_expiresAt_idx" ON "runtime_sandboxes"("expiresAt");

-- AddForeignKey
ALTER TABLE "runtime_sandboxes" ADD CONSTRAINT "runtime_sandboxes_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
