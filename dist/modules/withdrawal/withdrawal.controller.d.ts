import { WithdrawalService } from './withdrawal.service';
import { WithdrawalRequestDto } from './dto/withdrawal.dto';
export declare class WithdrawalController {
    private withdrawalService;
    constructor(withdrawalService: WithdrawalService);
    request(dto: WithdrawalRequestDto): Promise<{
        withdrawal_id: string;
        status: string;
    }>;
    status(id: string): Promise<import("../../entities").Withdrawal>;
}
