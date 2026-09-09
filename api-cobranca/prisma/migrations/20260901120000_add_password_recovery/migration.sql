-- AlterTable
ALTER TABLE "User"
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Normalize login identifiers before the application starts enforcing
-- lowercase writes. Abort safely if legacy rows would collide.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "User"
        GROUP BY LOWER(BTRIM("email"))
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot normalize User.email: case-insensitive duplicates exist';
    END IF;
END $$;

UPDATE "User"
SET "email" = LOWER(BTRIM("email"));

-- Keep the invariant at database level even for writes outside the API.
CREATE UNIQUE INDEX "User_email_normalized_key"
ON "User"(LOWER(BTRIM("email")));

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_id_companyId_key" ON "User"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_companyId_tokenHash_key"
ON "PasswordResetToken"("companyId", "tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_companyId_userId_idx"
ON "PasswordResetToken"("companyId", "userId");

-- AddForeignKey
ALTER TABLE "PasswordResetToken"
ADD CONSTRAINT "PasswordResetToken_userId_companyId_fkey"
FOREIGN KEY ("userId", "companyId") REFERENCES "User"("id", "companyId")
ON DELETE CASCADE ON UPDATE CASCADE;
