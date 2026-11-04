import { SetMetadata } from '@nestjs/common';
import { CompanyProduct } from '@prisma/client';

export const COMPANY_PRODUCTS_KEY = 'companyProducts';

// Routes without this decorator belong to billing companies only.
export const CompanyProducts = (
  ...products: CompanyProduct[]
): ClassDecorator & MethodDecorator =>
  SetMetadata(COMPANY_PRODUCTS_KEY, products);
