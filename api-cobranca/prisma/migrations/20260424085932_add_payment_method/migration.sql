/*
  Warnings:

  - You are about to drop the column `allowedBillingMethods` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `efiBoletoFee` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `efiBolixFee` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `efiPixFee` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `platformBoletoFee` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `platformBolixFee` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `platformPixFee` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `allowedBillingMethods` on the `Debtor` table. All the data in the column will be lost.
  - You are about to drop the column `efiBoletoFee` on the `Debtor` table. All the data in the column will be lost.
  - You are about to drop the column `efiBolixFee` on the `Debtor` table. All the data in the column will be lost.
  - You are about to drop the column `efiPixFee` on the `Debtor` table. All the data in the column will be lost.
  - You are about to drop the column `platformBoletoFee` on the `Debtor` table. All the data in the column will be lost.
  - You are about to drop the column `platformBolixFee` on the `Debtor` table. All the data in the column will be lost.
  - You are about to drop the column `platformPixFee` on the `Debtor` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Company" DROP COLUMN "allowedBillingMethods",
DROP COLUMN "efiBoletoFee",
DROP COLUMN "efiBolixFee",
DROP COLUMN "efiPixFee",
DROP COLUMN "platformBoletoFee",
DROP COLUMN "platformBolixFee",
DROP COLUMN "platformPixFee",
ADD COLUMN     "preferredBillingMethod" "BillingMethod" NOT NULL DEFAULT 'PIX';

-- AlterTable
ALTER TABLE "Debtor" DROP COLUMN "allowedBillingMethods",
DROP COLUMN "efiBoletoFee",
DROP COLUMN "efiBolixFee",
DROP COLUMN "efiPixFee",
DROP COLUMN "platformBoletoFee",
DROP COLUMN "platformBolixFee",
DROP COLUMN "platformPixFee",
ADD COLUMN     "preferredBillingMethod" "BillingMethod";
