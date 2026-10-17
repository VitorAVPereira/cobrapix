import { Module } from '@nestjs/common';
import { ResendMailerService } from '../common/resend-mailer.service';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  controllers: [ContactController],
  providers: [ContactService, ResendMailerService],
})
export class ContactModule {}
