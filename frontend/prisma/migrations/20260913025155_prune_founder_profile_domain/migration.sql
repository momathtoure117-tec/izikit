/*
  Warnings:

  - You are about to drop the `FounderProfile` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProfileUnlock` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "FounderProfile" DROP CONSTRAINT "FounderProfile_userId_fkey";

-- DropForeignKey
ALTER TABLE "ProfileUnlock" DROP CONSTRAINT "ProfileUnlock_orderId_fkey";

-- DropForeignKey
ALTER TABLE "ProfileUnlock" DROP CONSTRAINT "ProfileUnlock_targetProfileId_fkey";

-- DropForeignKey
ALTER TABLE "ProfileUnlock" DROP CONSTRAINT "ProfileUnlock_unlockerUserId_fkey";

-- DropTable
DROP TABLE "FounderProfile";

-- DropTable
DROP TABLE "ProfileUnlock";
