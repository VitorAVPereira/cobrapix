-- CreateEnum
CREATE TYPE "BillingMethod" AS ENUM ('PIX', 'BOLETO', 'BOLIX');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "allowedBillingMethods" "BillingMethod"[] DEFAULT ARRAY['PIX']::"BillingMethod"[],
ADD COLUMN     "efiBoletoFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "efiBolixFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "efiPixFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "platformBoletoFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "platformBolixFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "platformPixFee" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Debtor" ADD COLUMN     "allowedBillingMethods" "BillingMethod"[] DEFAULT ARRAY[]::"BillingMethod"[],
ADD COLUMN     "efiBoletoFee" DECIMAL(10,2),
ADD COLUMN     "efiBolixFee" DECIMAL(10,2),
ADD COLUMN     "efiPixFee" DECIMAL(10,2),
ADD COLUMN     "platformBoletoFee" DECIMAL(10,2),
ADD COLUMN     "platformBolixFee" DECIMAL(10,2),
ADD COLUMN     "platformPixFee" DECIMAL(10,2);
