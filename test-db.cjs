const { PrismaClient } = require('./server/aiprocess-api/node_modules/@prisma/client');
if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
}
const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL
        }
    }
});
async function main() {
    try {
        const users = await prisma.user.findMany();
        console.log("Users:", users);
    } catch (e) {
        console.error("DB Error:", e);
    } finally {
        await prisma.$disconnect();
    }
}
main();
