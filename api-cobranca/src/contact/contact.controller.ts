import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import { ContactService } from './contact.service';
import { QuoteRequestDto } from './dto/quote-request.dto';

/** Public: the presentation page posts here without a session. */
@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @UseGuards(ThrottleGuard)
  @Post('quote-request')
  @HttpCode(HttpStatus.OK)
  requestQuote(@Body() dto: QuoteRequestDto): Promise<{ message: string }> {
    return this.contact.requestQuote(dto);
  }
}
