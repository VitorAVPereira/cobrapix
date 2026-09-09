import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import { LoginDto } from './dto/login.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GetUser } from './decorators/get-user.decorator';
import { AllowPasswordChangeRequired } from './decorators/allow-password-change-required.decorator';
import type { AuthenticatedUser, MessageResponse } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(ThrottleGuard, LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const { access_token, user } = await this.authService.login(loginDto);

    // Set cookie para compatibilidade com NextAuth
    res.cookie('next-auth.session-token', access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    });

    return {
      user,
      access_token,
    };
  }

  @UseGuards(ThrottleGuard)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<MessageResponse> {
    return this.authService.forgotPassword(dto);
  }

  @UseGuards(ThrottleGuard)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageResponse> {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChangeRequired()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageResponse> {
    return this.authService.changePassword(user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChangeRequired()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response): { message: string } {
    res.clearCookie('next-auth.session-token');
    return { message: 'Logout realizado com sucesso' };
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChangeRequired()
  @Post('session')
  @HttpCode(HttpStatus.OK)
  getSession(@GetUser() user: AuthenticatedUser): unknown {
    return {
      user: {
        id: user.userId,
        email: user.email,
        name: user.name,
        companyId: user.companyId,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        tokenVersion: user.tokenVersion,
      },
    };
  }
}
