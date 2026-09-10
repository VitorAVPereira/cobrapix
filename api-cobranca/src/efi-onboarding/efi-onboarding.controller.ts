import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EfiOnboardingService } from './efi-onboarding.service';
import { OnboardingDraftDto } from './onboarding.dto';
import { EfiMtlsGuard } from './efi-mtls.guard';
import { OnboardingEvents } from './onboarding-events';

@Controller('onboarding/efi')
@UseGuards(JwtAuthGuard)
export class EfiOnboardingController {
  constructor(private readonly service: EfiOnboardingService) {}
  @Get()
  get(@GetUser() user: AuthenticatedUser): Promise<unknown> {
    return this.service.get(user);
  }
  @Put('draft')
  draft(
    @GetUser() user: AuthenticatedUser,
    @Body() body: OnboardingDraftDto,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.service.saveDraft(
      user,
      body,
      request.ip ?? request.socket.remoteAddress ?? '',
    );
  }
  @Post('submit')
  submit(@GetUser() user: AuthenticatedUser): Promise<unknown> {
    return this.service.submit(user);
  }
  @Post('retry')
  retry(@GetUser() user: AuthenticatedUser): Promise<unknown> {
    // Retry requires a corrected DRAFT with fresh consent, exactly like the first submission.
    return this.service.submit(user);
  }
}

@Controller('webhooks/efi/account-opening')
@UseGuards(EfiMtlsGuard)
export class EfiOpeningWebhookController {
  constructor(private readonly events: OnboardingEvents) {}
  @Post()
  async handle(@Body() body: unknown): Promise<{ received: boolean }> {
    await this.events.handle(body);
    return { received: true };
  }
}
