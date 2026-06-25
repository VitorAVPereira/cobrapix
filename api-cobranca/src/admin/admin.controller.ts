import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import {
  AdminAnalyticsService,
  AdminClientAnalyticsResponse,
} from './admin-analytics.service';
import { AdminAnalyticsQueryDto } from './dto/admin-analytics-query.dto';
import {
  CreateAdminClientDto,
  ResetClientPasswordDto,
  UpdateAdminClientDto,
} from './dto/admin-client.dto';
import { AdminClientResponse, AdminService } from './admin.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';

@Controller('admin/clients')
@UseGuards(JwtAuthGuard, PlatformAdminGuard, ThrottleGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminAnalyticsService: AdminAnalyticsService,
  ) {}

  @Get()
  async listClients(): Promise<AdminClientResponse[]> {
    return this.adminService.listClients();
  }

  @Get('analytics')
  async getAnalytics(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<AdminClientAnalyticsResponse> {
    return this.adminAnalyticsService.getAnalytics(query);
  }

  @Get(':id')
  async getClient(@Param('id') id: string): Promise<AdminClientResponse> {
    return this.adminService.getClient(id);
  }

  @Post()
  async createClient(
    @Body() dto: CreateAdminClientDto,
  ): Promise<AdminClientResponse> {
    return this.adminService.createClient(dto);
  }

  @Put(':id')
  async updateClient(
    @Param('id') id: string,
    @Body() dto: UpdateAdminClientDto,
  ): Promise<AdminClientResponse> {
    return this.adminService.updateClient(id, dto);
  }

  @Post(':id/reset-password')
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetClientPasswordDto,
  ): Promise<{ userId: string; temporaryPassword: string }> {
    return this.adminService.resetPassword(id, dto);
  }
}
