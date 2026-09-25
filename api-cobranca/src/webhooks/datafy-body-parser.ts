import type { RawBodyRequest } from '@nestjs/common';
import { json } from 'express';
import type { RequestHandler } from 'express';
import type { IncomingMessage } from 'node:http';

/**
 * JSON parser for `/webhooks/datafy` only: 1 MiB limit and the exact bytes for the HMAC.
 * It must not be named `jsonParser`: Nest skips its own global JSON parser when a
 * middleware with that name is already registered, which would leave every other
 * route (login included) with an empty body.
 */
export function datafyBodyParser(): RequestHandler {
  const parser = json({
    limit: '1mb',
    verify: (request: IncomingMessage, _response, buffer: Buffer): void => {
      (request as RawBodyRequest<IncomingMessage>).rawBody =
        Buffer.from(buffer);
    },
  });
  return function datafyJsonParser(request, response, next): void {
    parser(request, response, next);
  };
}
