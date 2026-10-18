import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { DisbursementsAdminController } from './disbursements-admin.controller';
import { DisbursementSettingsDto } from './dto/disbursement-settings.dto';

describe('DisbursementsAdminController', () => {
  it('is restricted to the platform admin', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, DisbursementsAdminController),
    ).toEqual([JwtAuthGuard, PlatformAdminGuard]);
  });

  it.each([
    ['11988887777', false],
    ['+5511988887777', false],
    ['5511 98888-7777', false],
    ['551198888777', true],
    ['5511988887777', true],
  ])('approver phone %s valid: %s', async (approverPhone, valid) => {
    const errors = await validate(
      plainToInstance(DisbursementSettingsDto, {
        expectedVersion: 0,
        enabled: true,
        approverName: 'Maria Souza',
        approverPhone,
      }),
    );
    expect(errors.length === 0).toBe(valid);
  });
});
