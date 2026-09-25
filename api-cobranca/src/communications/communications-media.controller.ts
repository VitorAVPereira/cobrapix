import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommunicationMediaService } from './communication-media.service';

/** Attachment bytes for the owning company or the platform team; never a provider URL. */
@Controller('communications/messages')
@UseGuards(JwtAuthGuard)
export class CommunicationsMediaController {
  constructor(private readonly media: CommunicationMediaService) {}

  @Get(':messageId/attachments/:attachmentId')
  async download(
    @GetUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.media.openForViewer(
      { companyId: user.companyId, role: user.role },
      messageId,
      attachmentId,
    );
    response
      .status(200)
      .set({
        'Content-Type': file.contentType,
        'Content-Length': String(file.bytes.length),
        'Content-Disposition': `${file.disposition}; filename="${file.fileName}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
      })
      .end(file.bytes);
  }
}
