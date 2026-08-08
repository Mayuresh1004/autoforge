/*
  Warnings:

  - You are about to drop the column `attackVector` on the `exploits` table. All the data in the column will be lost.
  - You are about to drop the column `impact` on the `exploits` table. All the data in the column will be lost.
  - You are about to drop the column `proofOfConcept` on the `exploits` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "exploits" DROP COLUMN "attackVector",
DROP COLUMN "impact",
DROP COLUMN "proofOfConcept",
ALTER COLUMN "endpoint" DROP DEFAULT;
