import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ResendMailerService } from '../common/resend-mailer.service';
import { PasswordRecoveryProcessor } from './password-recovery.processor';
import { BullInfrastructureModule } from '../queue/bull-infrastructure.module';

@Module({
  imports: [
    PassportModule,
    BullInfrastructureModule,
    BullModule.registerQueue({
      name: 'auth-password-recovery',
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    ResendMailerService,
    PasswordRecoveryProcessor,
  ],
  exports: [AuthService],
})
export class AuthModule {}
