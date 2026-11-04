import {
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  CheckoutApiKeysService,
  type CheckoutApiCaller,
} from './checkout-api-keys.service';
import { orderPayload } from './checkout-webhooks.service';
import { ApiOrdersQueryDto } from './dto/checkout-finance.dto';

type ApiRequest = Request & { checkoutApi?: CheckoutApiCaller };

/** "Authorization: Bearer <key>" of a seller; the company comes only from the key. */
@Injectable()
export class CheckoutApiKeyGuard implements CanActivate {
  constructor(private readonly keys: CheckoutApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '');
    const caller = match?.[1] ? await this.keys.authenticate(match[1]) : null;
    if (!caller)
      throw new UnauthorizedException({
        code: 'CHECKOUT_API_KEY_INVALID',
        message: 'Chave da API ausente, inválida ou revogada.',
      });
    request.checkoutApi = caller;
    return true;
  }
}

const ApiCompany = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest<ApiRequest>().checkoutApi!.companyId,
);

const orderInclude = { offer: { select: { id: true, kind: true } } } as const;

/**
 * Read-only API for the seller's own system, e.g. to catch up after a lost
 * webhook. The same order body as the notices. Another company's id is 404.
 */
@Controller('checkout/api/v1')
@UseGuards(ThrottleGuard, CheckoutApiKeyGuard)
export class CheckoutApiController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('orders')
  async orders(
    @ApiCompany() companyId: string,
    @Query() query: ApiOrdersQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: Prisma.CheckoutOrderWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      // The product sold as the main item or as a bump.
      ...(query.productId
        ? {
            OR: [
              { productId: query.productId },
              { items: { array_contains: [{ productId: query.productId }] } },
            ],
          }
        : {}),
      ...(query.updatedFrom || query.updatedTo
        ? {
            updatedAt: {
              ...(query.updatedFrom
                ? { gte: new Date(query.updatedFrom) }
                : {}),
              ...(query.updatedTo ? { lt: new Date(query.updatedTo) } : {}),
            },
          }
        : {}),
    };
    const [total, orders] = await Promise.all([
      this.prisma.checkoutOrder.count({ where }),
      this.prisma.checkoutOrder.findMany({
        where,
        include: orderInclude,
        // Oldest change first, so a system can page forward from its last sync.
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: orders.map((order) => this.order(order)),
    };
  }

  @Get('orders/:id')
  async orderById(
    @ApiCompany() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const order = await this.prisma.checkoutOrder.findFirst({
      where: { id, companyId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    return this.order(order);
  }

  @Get('products')
  async products(@ApiCompany() companyId: string) {
    const products = await this.prisma.checkoutProduct.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
    return { items: products.map((product) => this.product(product)) };
  }

  @Get('products/:id')
  async productById(
    @ApiCompany() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const product = await this.prisma.checkoutProduct.findFirst({
      where: { id, companyId },
    });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    return this.product(product);
  }

  private order(order: Parameters<typeof orderPayload>[0]) {
    return {
      ...orderPayload(order),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private product(product: Prisma.CheckoutProductGetPayload<object>) {
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      priceCents: product.priceCents,
      compareAtPriceCents: product.compareAtPriceCents,
      accessPeriodMonths: product.accessPeriodMonths,
      deliveryMode: product.deliveryMode,
      active: product.active,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }
}
