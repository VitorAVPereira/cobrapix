"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueModule = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const config_1 = require("@nestjs/config");
const message_queue_1 = require("./message.queue");
const message_worker_1 = require("./workers/message.worker");
const spintax_service_1 = require("./services/spintax.service");
const rate_limit_service_1 = require("./services/rate-limit.service");
const prisma_module_1 = require("../prisma/prisma.module");
let QueueModule = class QueueModule {
};
exports.QueueModule = QueueModule;
exports.QueueModule = QueueModule = __decorate([
    (0, common_1.Module)({
        imports: [
            prisma_module_1.PrismaModule,
            bullmq_1.BullModule.forRootAsync({
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: (configService) => ({
                    connection: {
                        host: configService.get('REDIS_HOST') || 'localhost',
                        port: configService.get('REDIS_PORT') || 6379,
                        password: configService.get('REDIS_PASSWORD'),
                    },
                }),
            }),
            bullmq_1.BullModule.registerQueue({
                name: 'whatsapp-messages',
                defaultJobOptions: {
                    removeOnComplete: {
                        count: 1000,
                        age: 24 * 3600,
                    },
                    removeOnFail: {
                        count: 5000,
                        age: 7 * 24 * 3600,
                    },
                },
            }),
        ],
        providers: [
            message_queue_1.MessageQueueService,
            message_worker_1.MessageWorkerService,
            spintax_service_1.SpintaxService,
            rate_limit_service_1.RateLimitService,
        ],
        exports: [
            message_queue_1.MessageQueueService,
            spintax_service_1.SpintaxService,
            rate_limit_service_1.RateLimitService,
        ],
    })
], QueueModule);
//# sourceMappingURL=queue.module.js.map