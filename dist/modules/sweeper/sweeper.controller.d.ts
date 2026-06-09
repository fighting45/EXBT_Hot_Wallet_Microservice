import { SweeperService } from './sweeper.service';
import { EstimateSweepDto, ExecuteSweepDto } from './dto/sweeper.dto';
export declare class SweeperController {
    private sweeperService;
    constructor(sweeperService: SweeperService);
    estimate(dto: EstimateSweepDto): Promise<{
        addresses_to_sweep: import("./sweeper.service").AddressWithBalance[];
        total_exbt: string;
        hot_wallet_balance: string;
        estimated_gas_total: string;
        sufficient_balance: boolean;
    }>;
    execute(dto: ExecuteSweepDto): Promise<import("./sweeper.service").SweepResult[]>;
    status(txHash: string): Promise<import("../../entities").SweepTransaction>;
}
