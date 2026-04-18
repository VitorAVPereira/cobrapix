import { Controller, Get, Post, Body, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  async findAll(@GetUser() user: any) {
    return this.invoicesService.findAll(user.companyId);
  }

  @Post('import')
  async importCsv(@GetUser() user: any, @Body() body: any[]) {
    if (!Array.isArray(body) || body.length === 0) {
      throw new HttpException('Nenhum dado recebido.', HttpStatus.BAD_REQUEST);
    }

    if (body.length > 5000) {
      throw new HttpException('Limite máximo de 5000 linhas por importação.', HttpStatus.BAD_REQUEST);
    }

    // Validação básica
    const errors: string[] = [];
    const validRows: any[] = [];

    for (let i = 0; i < body.length; i++) {
      const row = body[i];
      const err = this.validateRow(row, i);
      if (err) {
        errors.push(err);
        if (errors.length >= 10) break;
      } else {
        validRows.push({
          name: row.name?.trim(),
          phone_number: row.phone_number?.trim(),
          email: row.email?.trim() || undefined,
          original_amount: row.original_amount,
          due_date: row.due_date?.trim(),
        });
      }
    }

    if (errors.length > 0) {
      throw new HttpException(
        { error: 'Erros de validação.', details: errors },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.invoicesService.importCsv(user.companyId, validRows);
  }

  private validateRow(row: any, index: number): string | null {
    const i = index + 1;

    if (typeof row.name !== 'string' || row.name.trim().length < 2) {
      return `Linha ${i}: Nome inválido ou ausente.`;
    }
    if (typeof row.phone_number !== 'string' || !/^\d{10,13}$/.test(row.phone_number)) {
      return `Linha ${i}: WhatsApp inválido (esperado 10-13 dígitos numéricos).`;
    }
    if (row.email != null && row.email !== '' && typeof row.email === 'string') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
        return `Linha ${i}: E-mail inválido.`;
      }
    }
    if (typeof row.original_amount !== 'number' || row.original_amount <= 0 || row.original_amount > 999999.99) {
      return `Linha ${i}: Valor deve ser um número entre 0.01 e 999999.99.`;
    }
    if (typeof row.due_date !== 'string' || row.due_date.trim() === '') {
      return `Linha ${i}: Data de vencimento ausente.`;
    }
    return null;
  }
}
