import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_REQUIRED_KEY = 'allowPasswordChangeRequired';

export const AllowPasswordChangeRequired = (): MethodDecorator =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, true);
