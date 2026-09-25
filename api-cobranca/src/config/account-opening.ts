import { HttpException, HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

// Server capability for the Efí account-opening API (gn.registration.*).
// Enabled unless explicitly disabled, preserving the current deployments.
// Manual financial activation never depends on it.
export function isEfiOpeningEnabled(config: ConfigService): boolean {
  return config.get<string>('EFI_OPENING_ENABLED') !== 'false';
}

export function assertEfiOpeningEnabled(config: ConfigService): void {
  if (!isEfiOpeningEnabled(config))
    throw new HttpException(
      {
        code: 'EFI_OPENING_DISABLED',
        message:
          'A abertura de contas Efí está desativada neste servidor. Use a ativação financeira administrativa.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
}
