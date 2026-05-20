import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';
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
  constructor(private readonly adminService: AdminService) {}

  @Get()
  async listClients(): Promise<AdminClientResponse[]> {
    return this.adminService.listClients();
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
