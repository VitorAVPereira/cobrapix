export declare class CreatePaymentDto {
    invoiceId: string;
}
export declare class PaymentCallbackDto {
    event: string;
    payment: string;
    status?: string;
    pixQrCode?: string;
    pixCopyPaste?: string;
    value?: number;
    dateCreated?: string;
    dueDate?: string;
    customer?: string;
    billingType?: string;
}
