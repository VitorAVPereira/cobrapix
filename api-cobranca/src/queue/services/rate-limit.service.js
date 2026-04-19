"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var RateLimitService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ioredis_1 = __importDefault(require("ioredis"));
let RateLimitService = RateLimitService_1 = class RateLimitService {
    configService;
    logger = new common_1.Logger(RateLimitService_1.name);
    redis;
    defaultConfig = {
        maxMessages: 20,
        windowMs: 60 * 60 * 1000,
    };
    constructor(configService) {
        this.configService = configService;
        const redisHost = this.configService.get('REDIS_HOST') || 'localhost';
        const redisPort = this.configService.get('REDIS_PORT') || 6379;
        const redisPassword = this.configService.get('REDIS_PASSWORD');
        this.redis = new ioredis_1.default({
            host: redisHost,
            port: redisPort,
            password: redisPassword,
            lazyConnect: true,
        });
        this.redis.on('error', (err) => {
            this.logger.error('Redis connection error:', err);
        });
        this.redis.on('connect', () => {
            this.logger.log('Connected to Redis for rate limiting');
        });
    }
    async checkRateLimit(phoneNumber, config) {
        const rateConfig = { ...this.defaultConfig, ...config };
        const key = `ratelimit:${phoneNumber}`;
        const windowSeconds = Math.floor(rateConfig.windowMs / 1000);
        try {
            const current = await this.redis.get(key);
            if (!current) {
                await this.redis.setex(key, windowSeconds, '1');
                return {
                    allowed: true,
                    remaining: rateConfig.maxMessages - 1,
                    resetAt: Date.now() + rateConfig.windowMs,
                };
            }
            const count = parseInt(current, 10);
            if (count >= rateConfig.maxMessages) {
                const ttl = await this.redis.ttl(key);
                return {
                    allowed: false,
                    remaining: 0,
                    resetAt: Date.now() + (ttl * 1000),
                };
            }
            await this.redis.incr(key);
            return {
                allowed: true,
                remaining: rateConfig.maxMessages - count - 1,
                resetAt: Date.now() + (await this.redis.ttl(key)) * 1000,
            };
        }
        catch (error) {
            this.logger.error('Error checking rate limit:', error);
            return {
                allowed: true,
                remaining: rateConfig.maxMessages,
                resetAt: Date.now() + rateConfig.windowMs,
            };
        }
    }
    async getTimeUntilNextMessage(phoneNumber) {
        const key = `ratelimit:${phoneNumber}`;
        try {
            const ttl = await this.redis.ttl(key);
            return ttl > 0 ? ttl * 1000 : 0;
        }
        catch {
            return 0;
        }
    }
    async onModuleDestroy() {
        await this.redis.quit();
    }
};
exports.RateLimitService = RateLimitService;
exports.RateLimitService = RateLimitService = RateLimitService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], RateLimitService);
//# sourceMappingURL=rate-limit.service.js.map