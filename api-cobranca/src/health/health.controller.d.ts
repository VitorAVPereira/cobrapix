import type { Response } from 'express';
import { HealthService } from './health.service';
export declare class HealthController {
    private readonly service;
    private readonly logger;
    constructor(service: HealthService);
    get(res: Response): Promise<Response>;
}
