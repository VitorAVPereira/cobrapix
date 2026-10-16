-- Collaborator payment messages to the approver may be held by the template policy too.
-- Widening the accepted origins keeps every existing row valid.
ALTER TABLE "WhatsappTemplatePendingSend" DROP CONSTRAINT "WhatsappTemplatePendingSend_origin_check";
ALTER TABLE "WhatsappTemplatePendingSend" ADD CONSTRAINT "WhatsappTemplatePendingSend_origin_check" CHECK ("origin" IN ('COLLECTION', 'ADMIN_REPLY', 'ACTIVATION', 'DISBURSEMENT'));
