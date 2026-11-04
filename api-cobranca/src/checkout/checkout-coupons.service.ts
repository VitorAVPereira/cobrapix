import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { conflict, invalid, versionChanged } from './checkout-rules';
import {
  CheckoutCouponDto,
  UpdateCheckoutCouponDto,
} from './dto/checkout-coupon.dto';
import { SetCheckoutActiveDto } from './dto/checkout-product.dto';

const couponView = {
  include: { products: { select: { productId: true } } },
} satisfies Prisma.CheckoutCouponDefaultArgs;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class CheckoutCouponsService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.checkoutCoupon.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      ...couponView,
    });
  }

  async create(companyId: string, dto: CheckoutCouponDto) {
    const { data, productIds } = await this.couponData(companyId, dto);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const coupon = await tx.checkoutCoupon.create({
          data: { ...data, companyId },
          select: { id: true },
        });
        // The link carries companyId in both relations, so it is written flat.
        await tx.checkoutCouponProduct.createMany({
          data: productIds.map((productId) => ({
            couponId: coupon.id,
            productId,
            companyId,
          })),
        });
        return coupon;
      });
      return this.detail(companyId, created.id);
    } catch (error) {
      if (isUniqueViolation(error)) this.duplicateCode();
      throw error;
    }
  }

  async update(companyId: string, id: string, dto: UpdateCheckoutCouponDto) {
    const { expectedVersion, ...fields } = dto;
    const { data, productIds } = await this.couponData(companyId, fields);
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.checkoutCoupon.updateMany({
          where: { id, companyId, version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (updated.count !== 1) {
          await this.detail(companyId, id);
          versionChanged();
        }
        await tx.checkoutCouponProduct.deleteMany({ where: { couponId: id } });
        await tx.checkoutCouponProduct.createMany({
          data: productIds.map((productId) => ({
            couponId: id,
            productId,
            companyId,
          })),
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) this.duplicateCode();
      throw error;
    }
    return this.detail(companyId, id);
  }

  async setActive(companyId: string, id: string, dto: SetCheckoutActiveDto) {
    const updated = await this.prisma.checkoutCoupon.updateMany({
      where: { id, companyId, version: dto.expectedVersion },
      data: { active: dto.active, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      await this.detail(companyId, id);
      versionChanged();
    }
    return this.detail(companyId, id);
  }

  async detail(companyId: string, id: string) {
    const coupon = await this.prisma.checkoutCoupon.findFirst({
      where: { id, companyId },
      ...couponView,
    });
    if (!coupon) throw new NotFoundException('Cupom não encontrado.');
    return coupon;
  }

  private async couponData(companyId: string, dto: CheckoutCouponDto) {
    if (dto.type === 'PERCENT' && dto.value > 10_000)
      throw invalid('O desconto em porcentagem vai até 100%.');
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (startsAt && expiresAt && expiresAt <= startsAt)
      throw invalid('O fim da validade precisa ser depois do início.');
    const productIds = dto.appliesToAllProducts ? [] : dto.productIds;
    if (!dto.appliesToAllProducts && productIds.length === 0)
      throw invalid('Escolha os produtos em que o cupom vale.');
    if (productIds.length) {
      const owned = await this.prisma.checkoutProduct.count({
        where: { id: { in: productIds }, companyId },
      });
      if (owned !== productIds.length)
        throw new NotFoundException('Produto não encontrado.');
    }
    return {
      productIds,
      data: {
        code: dto.code.trim().toUpperCase(),
        type: dto.type,
        value: dto.value,
        appliesToAllProducts: dto.appliesToAllProducts,
        startsAt,
        expiresAt,
        maxUses: dto.maxUses ?? null,
        active: dto.active,
      },
    };
  }

  private duplicateCode(): never {
    conflict('CHECKOUT_COUPON_EXISTS', 'Já existe um cupom com este código.');
  }
}
