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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageQueueService = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
let MessageQueueService = class MessageQueueService {
    whatsappQueue;
    constructor(whatsappQueue) {
        this.whatsappQueue = whatsappQueue;
    }
    async addSendMessageJob(job) {
        const minDelay = 1000;
        const maxDelay = 5000;
        const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        await this.whatsappQueue.add('send-message', job, {
            delay,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000,
            },
            removeOnComplete: {
                count: 1000,
                age: 24 * 3600,
            },
            removeOnFail: {
                count: 5000,
                age: 7 * 24 * 3600,
            },
        });
    }
    async addBulkSendMessageJobs(jobs) {
        const bulkJobs = jobs.map((job) => {
            const minDelay = 1000;
            const maxDelay = 5000;
            const baseDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
            return {
                name: 'send-message',
                data: job,
                opts: {
                    delay: baseDelay + (jobs.indexOf(job) * 2000),
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                },
            };
        });
        await this.whatsappQueue.addBulk(bulkJobs);
    }
    async getQueueStats() {
        const [waiting, active, completed, failed] = await Promise.all([
            this.whatsappQueue.getWaitingCount(),
            this.whatsappQueue.getActiveCount(),
            this.whatsappQueue.getCompletedCount(),
            this.whatsappQueue.getFailedCount(),
        ]);
        return { waiting, active, completed, failed };
    }
};
exports.MessageQueueService = MessageQueueService;
exports.MessageQueueService = MessageQueueService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, bullmq_1.InjectQueue)('whatsapp-messages')),
    __metadata("design:paramtypes", [bullmq_2.Queue])
], MessageQueueService);
//# sourceMappingURL=message.queue.js.map