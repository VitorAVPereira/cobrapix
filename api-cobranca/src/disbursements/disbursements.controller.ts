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

/** The company always comes from the session; another company's IDs answer 404. */
@Controller('disbursements')
@UseGuards(JwtAuthGuard)
export class DisbursementsController {
  constructor(
    private readonly settings: DisbursementSettingsService,
    private readonly recipients: DisbursementRecipientsService,
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
}
