-- AlterTable
ALTER TABLE "ContractMatch" ADD COLUMN     "vortalNoticeUid" TEXT;

-- CreateTable
CREATE TABLE "ProcessDocument" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "vortalDocId" TEXT,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "downloadUrl" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/pdf',
    "sizeBytes" INTEGER,
    "checksum" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeSession" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "newProcesses" INTEGER NOT NULL DEFAULT 0,
    "newDocuments" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT NOT NULL DEFAULT '',
    "captchaSolved" BOOLEAN,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ScrapeSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessDocument_contractId_idx" ON "ProcessDocument"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessDocument_contractId_documentType_vortalDocId_key" ON "ProcessDocument"("contractId", "documentType", "vortalDocId");

-- CreateIndex
CREATE INDEX "ContractMatch_vortalNoticeUid_idx" ON "ContractMatch"("vortalNoticeUid");

-- AddForeignKey
ALTER TABLE "ProcessDocument" ADD CONSTRAINT "ProcessDocument_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ContractMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
