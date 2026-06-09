export declare class Withdrawal {
    id: string;
    userId: number;
    toAddress: string;
    amount: string;
    gasFee: string;
    txHash: string;
    status: string;
    errorMessage: string;
    createdAt: Date;
    completedAt: Date;
}
