-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nit" TEXT NOT NULL,
    "workingCapital" DOUBLE PRECISION NOT NULL,
    "liquidity" DOUBLE PRECISION NOT NULL,
    "unspscCodes" TEXT NOT NULL,
    "regions" TEXT NOT NULL,
    "emails" TEXT NOT NULL,
    "minBudget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxBudget" DOUBLE PRECISION NOT NULL DEFAULT 9999999999,
    "certifications" TEXT NOT NULL DEFAULT '[]',
    "description" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractMatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "secopId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "budget" DOUBLE PRECISION NOT NULL,
    "urlPliego" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_ANALYSIS',
    "phase" TEXT NOT NULL DEFAULT '',
    "contractStatus" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "categoryCode" TEXT NOT NULL DEFAULT '',
    "categoryName" TEXT NOT NULL DEFAULT '',
    "contactName" TEXT NOT NULL DEFAULT '',
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "estimatedDuration" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3),
    "closingDate" TIMESTAMP(3),
    "presentationDeadline" TIMESTAMP(3),
    "matchScore" INTEGER NOT NULL DEFAULT 0,
    "viabilityScore" INTEGER,
    "presentationRoute" TEXT,
    "reportLegal" TEXT,
    "reportFinancial" TEXT,
    "reportFinal" TEXT,
    "errorMessage" TEXT NOT NULL DEFAULT '',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'secop_ii',
    "awarded" BOOLEAN NOT NULL DEFAULT false,
    "awardedProveedor" TEXT NOT NULL DEFAULT '',
    "valorAdjudicado" DOUBLE PRECISION,
    "rawSodaData" TEXT NOT NULL DEFAULT '',
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "contractsFound" INTEGER NOT NULL DEFAULT 0,
    "companiesScanned" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT NOT NULL DEFAULT '',
    "triggeredBy" TEXT NOT NULL DEFAULT 'cron',

    CONSTRAINT "ScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestLog" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "lastIngestAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenPub" TIMESTAMP(3) NOT NULL,
    "recordsFetched" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "errors" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "IngestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Company_nit_key" ON "Company"("nit");

-- CreateIndex
CREATE INDEX "ContractMatch_status_idx" ON "ContractMatch"("status");

-- CreateIndex
CREATE INDEX "ContractMatch_createdAt_idx" ON "ContractMatch"("createdAt");

-- CreateIndex
CREATE INDEX "ContractMatch_companyId_idx" ON "ContractMatch"("companyId");

-- CreateIndex
CREATE INDEX "ContractMatch_closingDate_idx" ON "ContractMatch"("closingDate");

-- CreateIndex
CREATE INDEX "ContractMatch_matchScore_idx" ON "ContractMatch"("matchScore");

-- CreateIndex
CREATE UNIQUE INDEX "ContractMatch_companyId_secopId_key" ON "ContractMatch"("companyId", "secopId");

-- CreateIndex
CREATE UNIQUE INDEX "IngestLog_datasetId_key" ON "IngestLog"("datasetId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractMatch" ADD CONSTRAINT "ContractMatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

