-- CreateTable
CREATE TABLE "FounderProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "skills" TEXT[],
    "hasIdea" BOOLEAN NOT NULL DEFAULT false,
    "ideaPitch" TEXT,
    "availableToCofound" BOOLEAN NOT NULL DEFAULT false,
    "externalLink" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FounderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileUnlock" (
    "id" TEXT NOT NULL,
    "unlockerUserId" TEXT NOT NULL,
    "targetProfileId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FounderProfile_userId_key" ON "FounderProfile"("userId");

-- CreateIndex
CREATE INDEX "FounderProfile_status_idx" ON "FounderProfile"("status");

-- CreateIndex
CREATE INDEX "FounderProfile_sector_idx" ON "FounderProfile"("sector");

-- CreateIndex
CREATE INDEX "FounderProfile_city_idx" ON "FounderProfile"("city");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileUnlock_orderId_key" ON "ProfileUnlock"("orderId");

-- CreateIndex
CREATE INDEX "ProfileUnlock_targetProfileId_idx" ON "ProfileUnlock"("targetProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileUnlock_unlockerUserId_targetProfileId_key" ON "ProfileUnlock"("unlockerUserId", "targetProfileId");

-- AddForeignKey
ALTER TABLE "FounderProfile" ADD CONSTRAINT "FounderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileUnlock" ADD CONSTRAINT "ProfileUnlock_unlockerUserId_fkey" FOREIGN KEY ("unlockerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileUnlock" ADD CONSTRAINT "ProfileUnlock_targetProfileId_fkey" FOREIGN KEY ("targetProfileId") REFERENCES "FounderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileUnlock" ADD CONSTRAINT "ProfileUnlock_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
