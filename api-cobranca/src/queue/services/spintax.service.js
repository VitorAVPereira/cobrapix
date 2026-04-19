"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SpintaxService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpintaxService = void 0;
const common_1 = require("@nestjs/common");
let SpintaxService = SpintaxService_1 = class SpintaxService {
    logger = new common_1.Logger(SpintaxService_1.name);
    process(spintaxText) {
        if (!spintaxText || !spintaxText.includes('{')) {
            return spintaxText;
        }
        return this.expand(spintaxText);
    }
    expand(text) {
        const regex = /\{([^{}]+)\}/g;
        let result = text;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const matchContent = match[1];
            if (!matchContent)
                continue;
            const options = matchContent.split('|');
            const randomOption = options[Math.floor(Math.random() * options.length)];
            if (randomOption) {
                result = result.replace(match[0], randomOption);
            }
        }
        return result;
    }
    buildCollectionMessage(params) {
        const { debtorName, originalAmount, dueDate, companyName } = params;
        const valorFormatado = new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(originalAmount);
        const dataFormatada = new Intl.DateTimeFormat('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'America/Sao_Paulo',
        }).format(dueDate);
        const greetings = [
            `Prezado(a) ${debtorName}`,
            `Caro(a) ${debtorName}`,
            `Olá ${debtorName}`,
            `Olá, ${debtorName}`,
        ];
        const reasons = [
            `Informamos que consta em nosso sistema uma fatura em seu nome no valor de ${valorFormatado}, com vencimento em ${dataFormatada}.`,
            `Verificamos que você possui uma fatura pendente no valor de ${valorFormatado}, com vencimento em ${dataFormatada}.`,
            `Comunicamos que há uma fatura em seu nome no valor de ${valorFormatado}, com data de vencimento ${dataFormatada}.`,
        ];
        const requests = [
            `Solicitamos a gentileza de regularizar o pagamento o mais breve possível.`,
            `Pedimos que realize o pagamento assim que possível.`,
            `Por favor, efetue o pagamento em até a data do vencimento.`,
            `Contamos com sua atenção para esta questão.`,
        ];
        const closings = [
            `Em caso de dúvidas, entre em contato conosco.`,
            `Estamos à disposição para esclarecer qualquer dúvida.`,
            `Para mais informações, favor nos contatar.`,
        ];
        const signatures = [
            `Atenciosamente,`,
            `Att,`,
            `Cordialmente,`,
        ];
        const spintax = [
            `{${greetings.join('|')}}`,
            ``,
            `{${reasons.join('|')}}`,
            ``,
            `{${requests.join('|')}}`,
            ``,
            `{${closings.join('|')}}`,
            ``,
            `{${signatures.join('|')}}`,
            `${companyName}`,
        ].join('\n');
        return this.process(spintax);
    }
};
exports.SpintaxService = SpintaxService;
exports.SpintaxService = SpintaxService = SpintaxService_1 = __decorate([
    (0, common_1.Injectable)()
], SpintaxService);
//# sourceMappingURL=spintax.service.js.map