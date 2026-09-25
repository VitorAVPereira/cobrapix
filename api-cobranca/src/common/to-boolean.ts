import { Transform } from 'class-transformer';

// The global ValidationPipe uses enableImplicitConversion, and
// Boolean('false') is true. Read the raw value instead: JSON booleans and the
// strings 'true'/'false' (query strings, multipart) map exactly; anything else
// is kept so @IsBoolean() rejects it.
export function ToBoolean(): PropertyDecorator {
  return Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
      const raw = obj[key];
      return raw === 'true' || raw === true
        ? true
        : raw === 'false' || raw === false
          ? false
          : raw;
    },
  );
}
