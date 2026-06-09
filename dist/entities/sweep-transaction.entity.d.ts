export declare class SweepTransaction {
    id: string;
    txHash: string;
    fundingTxHash: string;
    fromAddress: string;
    toAddress: string;
    amount: string;
    gasFee: string;
    derivationIndex: number;
    status: string;
    errorMessage: string;
    createdAt: Date;
    updatedAt: Date;
}
