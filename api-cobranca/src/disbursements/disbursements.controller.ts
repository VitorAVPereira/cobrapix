import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DisbursementSettingsService } from './disbursement-settings.service';
import { DisbursementRecipientsService } from './disbursement-recipients.service';
import {
  DisbursementRecipientDto,
  DisbursementRecipientsQueryDto,
  ImportDisbursementRecipientsDto,
  UpdateDisbursementRecipientDto,
} from './dto/disbursement-recipient.dto';
import { DisbursementBatchesService } from './disbursement-batches.service';
import { DisbursementApprovalService } from './disbursement-approval.service';
import { DisbursementSenderService } from './disbursement-sender.service';
import { DisbursementSchedulerService } from './disbursement-scheduler.service';
import {
  CreateDisbursementBatchDto,
  DisbursementBatchesQueryDto,
  EndDisbursementScheduleDto,
  RequestDisbursementApprovalDto,
  ScheduleDisbursementBatchDto,
  UpdateDisbursementBatchDto,
} from './dto/disbursement-batch.dto';

/** The company always comes from the session; another company's IDs answer 404. */
@Controller('disbursements')
@UseGuards(JwtAuthGuard)
export class DisbursementsController {
  constructor(
    private readonly settings: DisbursementSettingsService,
    private readonly recipients: DisbursementRecipientsService,
    private readonly batches: DisbursementBatchesService,
    private readonly approvals: DisbursementApprovalService,
    private readonly sender: DisbursementSenderService,
    private readonly scheduler: DisbursementSchedulerService,
  ) {}

  @Get('status') status(@GetUser() user: AuthenticatedUser) {
    return this.settings.companyStatus(user.companyId);
  }

  @Get('recipients') listRecipients(
    @GetUser() user: AuthenticatedUser,
    @Query() query: DisbursementRecipientsQueryDto,
  ) {
    return this.recipients.list(user.companyId, query);
  }

  @Post('recipients') createRecipient(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: DisbursementRecipientDto,
  ) {
    return this.recipients.create(user.companyId, dto);
  }

  @Put('recipients/:id') updateRecipient(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDisbursementRecipientDto,
  ) {
    return this.recipients.update(user.companyId, id, dto);
  }

  @Post('recipients/import') importRecipients(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: ImportDisbursementRecipientsDto,
  ) {
    return this.recipients.import(user.companyId, dto.rows);
  }

  @Get('batches') listBatches(
    @GetUser() user: AuthenticatedUser,
    @Query() query: DisbursementBatchesQueryDto,
  ) {
    return this.batches.list(user.companyId, query);
  }

  @Get('batches/:id') getBatch(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.batches.get(user.companyId, id);
  }

  // A payment for today asks for approval right away; a later date waits for 08:00.
  @Post('batches') async createBatch(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreateDisbursementBatchDto,
  ) {
    const batch = await this.batches.create(user.companyId, user.userId, dto);
    await this.scheduler.requestIfToday(user.companyId, batch.id);
    return this.batches.get(user.companyId, batch.id);
  }

  @Put('batches/:id') async updateBatch(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDisbursementBatchDto,
  ) {
    await this.batches.update(user.companyId, id, dto);
    await this.scheduler.requestIfToday(user.companyId, id);
    return this.batches.get(user.companyId, id);
  }

  @Post('batches/:id/schedule') async scheduleBatch(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleDisbursementBatchDto,
  ) {
    await this.batches.schedule(user.companyId, id, dto);
    await this.scheduler.requestIfToday(user.companyId, id);
    return this.batches.get(user.companyId, id);
  }

  @Post('schedules/:id/end') endSchedule(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndDisbursementScheduleDto,
  ) {
    return this.batches.endSchedule(user.companyId, id, dto.expectedVersion);
  }

  @Post('batches/:id/cancel') cancelBatch(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.batches.cancel(user.companyId, id);
  }

  @Post('batches/:id/retry-failed') retryFailed(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.batches.retryFailed(user.companyId, user.userId, id);
  }

  @Post('batches/:id/request-approval') requestApproval(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestDisbursementApprovalDto,
  ) {
    return this.approvals.request(
      user.companyId,
      user.userId,
      id,
      dto.expectedVersion,
    );
  }

  @Get('items/:id/receipt') async receipt(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const pdf = await this.sender.receipt(user.companyId, id);
    response
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `attachment; filename="comprovante-${id}.pdf"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(pdf);
  }
}
