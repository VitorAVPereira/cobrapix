import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SpintaxService {
  private readonly logger = new Logger(SpintaxService.name);

  process(spintaxText: string): string {
    if (!spintaxText || !spintaxText.includes('{')) {
      return spintaxText;
    }

    return this.expand(spintaxText);
  }

  private expand(text: string): string {
    const regex = /\{([^{}]+)\}/g;

    let result = text;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const matchContent = match[1];
      if (!matchContent) continue;
      const options = matchContent.split('|');
      const randomOption = options[Math.floor(Math.random() * options.length)];
      if (randomOption) {
        result = result.replace(match[0], randomOption);
      }
    }

    return result;
  }

  buildCollectionMessage(params: {
    debtorName: string;
    originalAmount: number;
    dueDate: Date;
    companyName: string;
  }): string {
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

    const signatures = [`Atenciosamente,`, `Att,`, `Cordialmente,`];

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
}
