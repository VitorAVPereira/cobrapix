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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvolutionHealthIndicator = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let EvolutionHealthIndicator = class EvolutionHealthIndicator {
    url;
    constructor(config) {
        this.url = config.get('EVOLUTION_API_URL', 'http://localhost:8080');
    }
    async check() {
        const startTime = Date.now();
        try {
            const response = await fetch(`${this.url}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });
            const latency = Date.now() - startTime;
            if (response.ok) {
                return {
                    service: 'Evolution API',
                    status: 'healthy',
                    message: 'Evolution API está respondendo',
                    latency,
                };
            }
            return {
                service: 'Evolution API',
                status: 'unhealthy',
                message: `Evolution API retornou status ${response.status}`,
                latency,
            };
        }
        catch (error) {
            const latency = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
            return {
                service: 'Evolution API',
                status: 'unhealthy',
                message: `Falha ao conectar com Evolution API: ${errorMessage}`,
                latency,
                details: { error: errorMessage },
            };
        }
    }
};
exports.EvolutionHealthIndicator = EvolutionHealthIndicator;
exports.EvolutionHealthIndicator = EvolutionHealthIndicator = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], EvolutionHealthIndicator);
//# sourceMappingURL=evolution.indicator.js.map