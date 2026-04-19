export declare class SpintaxService {
    private readonly logger;
    process(spintaxText: string): string;
    private expand;
    buildCollectionMessage(params: {
        debtorName: string;
        originalAmount: number;
        dueDate: Date;
        companyName: string;
    }): string;
}
