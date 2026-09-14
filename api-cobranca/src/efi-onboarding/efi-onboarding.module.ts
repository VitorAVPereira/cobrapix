import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ResendMailerService } from '../common/resend-mailer.service';
import { EfiOpeningClient, EfiOpeningTransport } from './efi-opening.client';
import {
  EfiOnboardingController,
  EfiOpeningWebhookController,
} from './efi-onboarding.controller';
import { EfiOnboardingService } from './efi-onboarding.service';
import { EfiMtlsGuard } from './efi-mtls.guard';
import { OnboardingEvents } from './onboarding-events';
import { OnboardingJobs } from './onboarding-jobs';
import { OnboardingWorkflow } from './onboarding-workflow';
import { OnboardingMaintenance } from './onboarding-maintenance';
import { OnboardingNotifications } from './onboarding-notifications';
import { CentralOnboardingNotifications } from './central-onboarding-notifications';
import { OnboardingProvisioner } from './onboarding-provisioner';
import { OnboardingWorker } from './onboarding-worker';
import { OnboardingRetention } from './onboarding-retention';
import { OnboardingAdminController } from './onboarding-admin.controller';
import { OnboardingAdminService } from './onboarding-admin.service';
import { OnboardingLifecycle } from './onboarding-lifecycle';

@Module({
  imports: [
    PrismaModule,
    PaymentModule,
    WhatsappModule,
    BullModule.registerQueue({ name: 'efi-onboarding' }),
  ],
  controllers: [
    EfiOnboardingController,
    EfiOpeningWebhookController,
    OnboardingAdminController,
  ],
  providers: [
    EfiOpeningClient,
    EfiOpeningTransport,
    EfiOnboardingService,
    EfiMtlsGuard,
    OnboardingEvents,
    OnboardingJobs,
    OnboardingWorkflow,
    OnboardingMaintenance,
    OnboardingProvisioner,
    OnboardingWorker,
    OnboardingRetention,
    OnboardingAdminService,
    OnboardingLifecycle,
    ResendMailerService,
    {
      provide: OnboardingNotifications,
      useClass: CentralOnboardingNotifications,
    },
  ],
})
export class EfiOnboardingModule {}
