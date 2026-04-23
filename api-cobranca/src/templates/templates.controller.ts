import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@GetUser() user: { companyId: string }, @Body() dto: CreateTemplateDto) {
    return this.templatesService.create(user.companyId, dto);
  }

  @Get()
  async findAll(@GetUser() user: { companyId: string }) {
    return this.templatesService.findAll(user.companyId);
  }

  @Get(':id')
  async findOne(@GetUser() user: { companyId: string }, @Param('id') id: string) {
    return this.templatesService.findOne(user.companyId, id);
  }

  @Put(':id')
  async update(
    @GetUser() user: { companyId: string },
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templatesService.update(user.companyId, id, dto);
  }
}