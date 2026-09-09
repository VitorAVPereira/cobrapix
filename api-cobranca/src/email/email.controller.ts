import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { EmailService } from './email.service';
import { EmailQueueService } from './email.queue';

interface AuthenticatedUser {
  companyId: string;
}

@Controller('')
export class EmailController {
  constructor(
    private readonly emailService: EmailService,
    private readonly emailQueue: EmailQueueService,
  ) {}

  @Get('email/stats')
  @UseGuards(JwtAuthGuard)
  async getStats(
    @GetUser() user: AuthenticatedUser,
    @Query('period') period?: string,
  ) {
    const normalized =
      period === 'today' || period === '7d' || period === '30d'
        ? period
        : '30d';
    const stats = await this.emailService.getStats(user.companyId, normalized);
    return { period: normalized, ...stats };
  }

  @Post('email/send-test')
  @UseGuards(JwtAuthGuard)
  async sendTest(
    @GetUser() user: AuthenticatedUser,
    @Body() body: { email: string },
  ) {
    if (!body.email) {
      throw new HttpException('Email ausente', HttpStatus.BAD_REQUEST);
    }

    const html = this.emailService.buildCollectionEmailHtml({
      debtorName: 'Cliente Teste',
      companyName: 'Empresa Teste',
      amount: 'R$ 150,50',
      dueDate: '30/12/2026',
      paymentMethod: 'PIX',
      paymentLink: 'https://cobrapix.com/pagar',
      pixCopyPaste: '00020101021226860014br.gov.bcb.pix2564qrcodepix.example',
    });

    await this.emailQueue.addJob({
      companyId: user.companyId,
      invoiceId: 'test-email',
      debtorId: 'test-debtor',
      debtorName: 'Cliente Teste',
      email: body.email,
      subject: '[CobraPix] Teste de envio de e-mail',
      html,
    });

    return { success: true };
  }
}
