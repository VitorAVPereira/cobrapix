CREATE TYPE "MessageTemplateCopyCodeSource" AS ENUM ('AUTO', 'PIX_COPY_PASTE', 'BOLETO_LINE_DIGITABLE');

ALTER TABLE "MessageTemplate"
  ADD COLUMN "footerText" TEXT,
  ADD COLUMN "paymentButtonEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "paymentButtonLabel" TEXT NOT NULL DEFAULT 'Abrir pagamento',
  ADD COLUMN "copyCodeButtonEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "copyCodeSource" "MessageTemplateCopyCodeSource" NOT NULL DEFAULT 'AUTO';
