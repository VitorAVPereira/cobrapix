import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

interface ErrorResponse {
  code?: string;
  statusCode: number;
  message: string;
  path: string;
  timestamp: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message } = this.resolveError(exception);
    const code = this.extractErrorCode(exception);
    const route: unknown = request.route;
    const path =
      this.isRecord(route) && typeof route.path === 'string' ? route.path : '/';
    // Provider errors and request URLs may contain credentials or personal data.
    this.logger.error(
      `${request.method} ${path} → ${statusCode}${code ? ` ${code}` : ''}`,
    );

    const body: ErrorResponse = {
      statusCode,
      message,
      ...(code ? { code } : {}),
      path,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }

  private extractErrorCode(exception: unknown): string | undefined {
    if (!(exception instanceof HttpException)) return undefined;
    const response = exception.getResponse();
    if (!this.isRecord(response) || typeof response.code !== 'string')
      return undefined;
    return /^[A-Z][A-Z0-9_]{2,63}$/.test(response.code)
      ? response.code
      : undefined;
  }

  private resolveError(exception: unknown): {
    statusCode: number;
    message: string;
  } {
    if (exception instanceof HttpException) {
      return {
        statusCode: exception.getStatus(),
        message: this.extractHttpMessage(exception),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrismaError(exception);
    }

    if (exception instanceof Error) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Erro interno do servidor.',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Erro interno do servidor.',
    };
  }

  private resolvePrismaError(error: Prisma.PrismaClientKnownRequestError): {
    statusCode: number;
    message: string;
  } {
    switch (error.code) {
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'Registro duplicado.',
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Registro nao encontrado.',
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Referencia invalida.',
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Erro interno do servidor.',
        };
    }
  }

  private extractHttpMessage(exception: HttpException): string {
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return response;
    }

    if (this.isRecord(response) && typeof response.message === 'string') {
      return response.message;
    }

    if (
      this.isRecord(response) &&
      Array.isArray(response.message) &&
      response.message.length > 0
    ) {
      return String(response.message[0]);
    }

    return 'Erro na requisicao.';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
