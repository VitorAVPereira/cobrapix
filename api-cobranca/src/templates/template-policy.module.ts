import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TemplatePolicyService } from './template-policy.service';

/** Pure policy over a caller's transaction; importable by dispatcher and producers without cycles. */
@Module({
  imports: [ConfigModule],
  providers: [TemplatePolicyService],
  exports: [TemplatePolicyService],
})
export class TemplatePolicyModule {}
