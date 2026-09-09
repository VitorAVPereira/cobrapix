import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateEmailTemplateDto, UpdateEmailTemplateDto } from './dto';
import { EmailTemplatesService } from './email-templates.service';

interface AuthenticatedUser {
  companyId: string;
}

@Controller('email/templates')
@UseGuards(JwtAuthGuard)
export class EmailTemplatesController {
  constructor(private readonly emailTemplatesService: EmailTemplatesService) {}

  @Get()
  async findAll(@GetUser() user: AuthenticatedUser) {
    return this.emailTemplatesService.findAll(user.companyId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreateEmailTemplateDto,
  ) {
    return this.emailTemplatesService.create(user.companyId, dto);
  }

  @Patch(':id')
  async update(
    @GetUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmailTemplateDto,
  ) {
    return this.emailTemplatesService.update(user.companyId, id, dto);
  }

  @Post(':id/publish')
  async publish(@GetUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.emailTemplatesService.publish(user.companyId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@GetUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.emailTemplatesService.remove(user.companyId, id);
  }
}
