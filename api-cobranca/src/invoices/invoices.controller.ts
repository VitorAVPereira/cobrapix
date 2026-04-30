import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { DebtorSettingsResponse, InvoicesService } from './invoices.service';
import {
  BillingType,
  CreateDebtorInvoiceDto,
  CreateInvoiceDto,
  UpdateDebtorSettingsDto,
  UpdateRecurringInvoiceDto,
} from './dto/invoice.dto';

interface AuthenticatedUser {
  companyId: string;
}

interface ImportRowInput {
  name?: unknown;
  phone_number?: unknown;
  email?: unknown;
  original_amount?: unknown;
  due_date?: unknown;
  billing_type?: unknown;
}

interface ValidImportRow {
  name: string;
  phone_number: string;
  email?: string;
  original_amount: number;
  due_date: string;
  billing_type: BillingType;
}

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  async findAll(@GetUser() user: AuthenticatedUser): Promise<unknown> {
    return this.invoicesService.findAll(user.companyId);
  }

  @Post()
  async createInvoice(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreateInvoiceDto,
  ): Promise<unknown> {
    if (dto.debtorId && !this.isUuid(dto.debtorId)) {
      throw new HttpException('Devedor invalido.', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.invoicesService.createInvoice(user.companyId, {
        debtorId: dto.debtorId,
        name: dto.name,
        phone_number: dto.phone_number,
        email: dto.email,
        original_amount: dto.original_amount,
        due_date: dto.due_date,
        billing_type: dto.billing_type,
        recurring: dto.recurring,
        due_day: dto.due_day,
      });
    } catch (error) {
      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel criar a fatura.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('recurring')
  async listRecurringInvoices(
    @GetUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.invoicesService.listRecurringInvoices(user.companyId);
  }

  @Put('recurring/:recurringInvoiceId')
  async updateRecurringInvoice(
    @GetUser() user: AuthenticatedUser,
    @Param('recurringInvoiceId') recurringInvoiceId: string,
    @Body() dto: UpdateRecurringInvoiceDto,
  ): Promise<unknown> {
    if (!this.isUuid(recurringInvoiceId)) {
      throw new HttpException('Recorrencia invalida.', HttpStatus.BAD_REQUEST);
    }

    const recurrence = await this.invoicesService.updateRecurringInvoice(
      user.companyId,
      recurringInvoiceId,
      {
        amount: dto.amount,
        billingType: dto.billingType,
        dueDay: dto.dueDay,
      },
    );

    if (!recurrence) {
      throw new HttpException(
        'Recorrencia nao encontrada.',
        HttpStatus.NOT_FOUND,
      );
    }

    return recurrence;
  }

  @Post('recurring/:recurringInvoiceId/pause')
  async pauseRecurringInvoice(
    @GetUser() user: AuthenticatedUser,
    @Param('recurringInvoiceId') recurringInvoiceId: string,
  ): Promise<unknown> {
    if (!this.isUuid(recurringInvoiceId)) {
      throw new HttpException('Recorrencia invalida.', HttpStatus.BAD_REQUEST);
    }

    const recurrence = await this.invoicesService.updateRecurringStatus(
      user.companyId,
      recurringInvoiceId,
      'PAUSED',
    );

    if (!recurrence) {
      throw new HttpException(
        'Recorrencia nao encontrada.',
        HttpStatus.NOT_FOUND,
      );
    }

    return recurrence;
  }

  @Post('recurring/:recurringInvoiceId/activate')
  async activateRecurringInvoice(
    @GetUser() user: AuthenticatedUser,
    @Param('recurringInvoiceId') recurringInvoiceId: string,
  ): Promise<unknown> {
    if (!this.isUuid(recurringInvoiceId)) {
      throw new HttpException('Recorrencia invalida.', HttpStatus.BAD_REQUEST);
    }

    const recurrence = await this.invoicesService.updateRecurringStatus(
      user.companyId,
      recurringInvoiceId,
      'ACTIVE',
    );

    if (!recurrence) {
      throw new HttpException(
        'Recorrencia nao encontrada.',
        HttpStatus.NOT_FOUND,
      );
    }

    return recurrence;
  }

  @Post('debtors/:debtorId/invoices')
  async createDebtorInvoice(
    @GetUser() user: AuthenticatedUser,
    @Param('debtorId') debtorId: string,
    @Body() dto: CreateDebtorInvoiceDto,
  ): Promise<unknown> {
    if (!this.isUuid(debtorId)) {
      throw new HttpException('Devedor invalido.', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.invoicesService.createDebtorInvoice(
        user.companyId,
        debtorId,
        {
          original_amount: dto.original_amount,
          due_date: dto.due_date,
          billing_type: dto.billing_type,
          recurring: dto.recurring,
          due_day: dto.due_day,
        },
      );
    } catch (error) {
      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel criar a fatura.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('debtors/:debtorId/settings')
  async getDebtorSettings(
    @GetUser() user: AuthenticatedUser,
    @Param('debtorId') debtorId: string,
  ): Promise<DebtorSettingsResponse> {
    if (!this.isUuid(debtorId)) {
      throw new HttpException('Devedor invalido.', HttpStatus.BAD_REQUEST);
    }

    const settings = await this.invoicesService.getDebtorSettings(
      user.companyId,
      debtorId,
    );

    if (!settings) {
      throw new HttpException('Devedor nao encontrado.', HttpStatus.NOT_FOUND);
    }

    return settings;
  }

  @Put('debtors/:debtorId/settings')
  async updateDebtorSettings(
    @GetUser() user: AuthenticatedUser,
    @Param('debtorId') debtorId: string,
    @Body() dto: UpdateDebtorSettingsDto,
  ): Promise<DebtorSettingsResponse> {
    if (!this.isUuid(debtorId)) {
      throw new HttpException('Devedor invalido.', HttpStatus.BAD_REQUEST);
    }

    const settings = await this.invoicesService.updateDebtorSettings(
      user.companyId,
      debtorId,
      {
        useGlobalBillingSettings: dto.useGlobalBillingSettings,
        preferredBillingMethod: dto.preferredBillingMethod,
        collectionReminderDays: dto.collectionReminderDays,
        autoDiscountEnabled: dto.autoDiscountEnabled,
        autoDiscountDaysAfterDue: dto.autoDiscountDaysAfterDue,
        autoDiscountPercentage: dto.autoDiscountPercentage,
      },
    );

    if (!settings) {
      throw new HttpException('Devedor nao encontrado.', HttpStatus.NOT_FOUND);
    }

    return settings;
  }

  @Post('import')
  async importCsv(
    @GetUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<{ success: boolean; count: number }> {
    if (!Array.isArray(body) || body.length === 0) {
      throw new HttpException('Nenhum dado recebido.', HttpStatus.BAD_REQUEST);
    }

    if (body.length > 5000) {
      throw new HttpException(
        'Limite maximo de 5000 linhas por importacao.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const errors: string[] = [];
    const validRows: ValidImportRow[] = [];

    for (let i = 0; i < body.length; i++) {
      const row = body[i] as ImportRowInput;
      const err = this.validateRow(row, i);

      if (err) {
        errors.push(err);
        if (errors.length >= 10) break;
      } else {
        validRows.push({
          name: (row.name as string).trim(),
          phone_number: (row.phone_number as string).trim(),
          email:
            typeof row.email === 'string' && row.email.trim()
              ? row.email.trim()
              : undefined,
          original_amount: row.original_amount as number,
          due_date: (row.due_date as string).trim(),
          billing_type: row.billing_type as BillingType,
        });
      }
    }

    if (errors.length > 0) {
      throw new HttpException(
        { error: 'Erros de validacao.', details: errors },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.invoicesService.importCsv(user.companyId, validRows);
  }

  private validateRow(row: ImportRowInput, index: number): string | null {
    const i = index + 1;

    if (typeof row.name !== 'string' || row.name.trim().length < 2) {
      return `Linha ${i}: Nome invalido ou ausente.`;
    }

    if (
      typeof row.phone_number !== 'string' ||
      !/^\d{10,13}$/.test(row.phone_number)
    ) {
      return `Linha ${i}: WhatsApp invalido (esperado 10-13 digitos numericos).`;
    }

    if (typeof row.email !== 'string' || row.email.trim() === '') {
      return `Linha ${i}: E-mail ausente.`;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      return `Linha ${i}: E-mail invalido.`;
    }

    if (
      typeof row.original_amount !== 'number' ||
      row.original_amount <= 0 ||
      row.original_amount > 999999.99
    ) {
      return `Linha ${i}: Valor deve ser um numero entre 0.01 e 999999.99.`;
    }

    if (typeof row.due_date !== 'string' || row.due_date.trim() === '') {
      return `Linha ${i}: Data de vencimento ausente.`;
    }

    if (!this.isBillingType(row.billing_type)) {
      return `Linha ${i}: Forma de pagamento deve ser PIX, BOLETO ou BOLIX.`;
    }

    return null;
  }

  private isBillingType(value: unknown): value is BillingType {
    return value === 'PIX' || value === 'BOLETO' || value === 'BOLIX';
  }

  private isUuid(value: string): value is string {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
