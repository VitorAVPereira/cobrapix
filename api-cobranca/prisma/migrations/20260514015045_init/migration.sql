/*
  Warnings:

  - The values [EVOLUTION] on the enum `WhatsappProvider` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "WhatsappProvider_new" AS ENUM ('META_CLOUD');
ALTER TABLE "public"."Company" ALTER COLUMN "whatsappProvider" DROP DEFAULT;
ALTER TABLE "Company" ALTER COLUMN "whatsappProvider" TYPE "WhatsappProvider_new" USING ("whatsappProvider"::text::"WhatsappProvider_new");
ALTER TYPE "WhatsappProvider" RENAME TO "WhatsappProvider_old";
ALTER TYPE "WhatsappProvider_new" RENAME TO "WhatsappProvider";
DROP TYPE "public"."WhatsappProvider_old";
ALTER TABLE "Company" ALTER COLUMN "whatsappProvider" SET DEFAULT 'META_CLOUD';
COMMIT;
