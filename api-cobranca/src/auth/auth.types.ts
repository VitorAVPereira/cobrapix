import { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  name?: string | null;
  companyId: string;
  role: UserRole;
}

export interface JwtPayload {
  email: string;
  sub: string;
  userId?: string;
  companyId: string;
  name?: string | null;
  role?: UserRole;
}
