-- CreateEnum
CREATE TYPE "ScoutStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "scout_scans" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "status" "ScoutStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scout_attack_surfaces" (
    "id" TEXT NOT NULL,
    "scoutScanId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "parameters" JSONB,
    "authentication" BOOLEAN NOT NULL DEFAULT false,
    "technology" JSONB,
    "risk" TEXT NOT NULL DEFAULT 'LOW',
    "source" TEXT NOT NULL DEFAULT 'crawler',
    "reachable" BOOLEAN NOT NULL DEFAULT true,
    "statusCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_attack_surfaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scout_technologies" (
    "id" TEXT NOT NULL,
    "scoutScanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'unknown',
    "version" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_technologies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scout_services" (
    "id" TEXT NOT NULL,
    "scoutScanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'tcp',
    "port" INTEGER,
    "version" TEXT,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scout_ports" (
    "id" TEXT NOT NULL,
    "scoutScanId" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'tcp',
    "state" TEXT NOT NULL DEFAULT 'open',
    "service" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_ports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scout_scans_scanId_idx" ON "scout_scans"("scanId");

-- CreateIndex
CREATE INDEX "scout_scans_status_idx" ON "scout_scans"("status");

-- CreateIndex
CREATE INDEX "scout_attack_surfaces_scoutScanId_idx" ON "scout_attack_surfaces"("scoutScanId");

-- CreateIndex
CREATE INDEX "scout_technologies_scoutScanId_idx" ON "scout_technologies"("scoutScanId");

-- CreateIndex
CREATE INDEX "scout_services_scoutScanId_idx" ON "scout_services"("scoutScanId");

-- CreateIndex
CREATE INDEX "scout_ports_scoutScanId_idx" ON "scout_ports"("scoutScanId");

-- AddForeignKey
ALTER TABLE "scout_scans" ADD CONSTRAINT "scout_scans_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scout_attack_surfaces" ADD CONSTRAINT "scout_attack_surfaces_scoutScanId_fkey" FOREIGN KEY ("scoutScanId") REFERENCES "scout_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scout_technologies" ADD CONSTRAINT "scout_technologies_scoutScanId_fkey" FOREIGN KEY ("scoutScanId") REFERENCES "scout_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scout_services" ADD CONSTRAINT "scout_services_scoutScanId_fkey" FOREIGN KEY ("scoutScanId") REFERENCES "scout_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scout_ports" ADD CONSTRAINT "scout_ports_scoutScanId_fkey" FOREIGN KEY ("scoutScanId") REFERENCES "scout_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
