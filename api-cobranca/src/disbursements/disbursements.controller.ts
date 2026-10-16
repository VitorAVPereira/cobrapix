import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import {
  CreateDisbursementBatchDto,
  DisbursementBatchesQueryDto,
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

  @Post('batches') createBatch(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreateDisbursementBatchDto,
  ) {
    return this.batches.create(user.companyId, user.userId, dto);
  }

  @Put('batches/:id') updateBatch(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDisbursementBatchDto,
  ) {
    return this.batches.update(user.companyId, id, dto);
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
}
