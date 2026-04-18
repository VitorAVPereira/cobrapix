import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function getAuthenticatedCompany() {
  const session = await auth();

  if (!session?.user?.companyId) {
    return null;
  }

  return prisma.company.findUnique({
    where: { id: session.user.companyId },
  });
}
