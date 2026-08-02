import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
async function main() {
  const hashedPassword = await bcrypt.hash('admin123', 12);
  await prisma.user.upsert({
    where: { email: 'admin@realzentic.com' },
    update: {},
    create: { email: 'admin@realzentic.com', name: 'Realzentic Administrator', hashedPassword, role: 'ADMIN' },
  });
  console.log('Admin user created: admin@realzentic.com / admin123');
}
main().catch(console.error).finally(() => prisma.$disconnect());
