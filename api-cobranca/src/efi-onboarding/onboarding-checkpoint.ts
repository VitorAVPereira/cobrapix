import { Prisma } from '@prisma/client';

export function readCheckpoint(
  value: Prisma.JsonValue | undefined,
): Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}
