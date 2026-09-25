import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('fronteira da ativação financeira', () => {
  it('nenhum arquivo depende da abertura de contas Efí', () => {
    const dir = __dirname;
    const offenders = readdirSync(dir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .filter((file) =>
        /from '[^']*(efi-onboarding|efi-opening)[^']*'|gn\.registration/.test(
          readFileSync(join(dir, file), 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
