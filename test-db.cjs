const { PrismaClient } = require('./server/aiprocess-api/node_modules/@prisma/client');
const prisma = new PrismaClient({
    datasources: {
        db: {
            url: "postgresql://postgres:rc_production_db@35.240.238.92:5432/ainotebook"
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
