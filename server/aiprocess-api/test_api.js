require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();

async function run() {
  try {
    const userId = "cluzrjfko0000u8x8d51s5i0a"; // just some string, it will return [] if invalid
    
    // @ts-ignore
    const positions = await prisma.portfolioPosition.findMany({
      select: { nameCn: true, nameEn: true, tickerBbg: true }
    });
    console.log(`Success! Portfolio works and found ${positions.length} items.`);

  } catch (err) {
    console.error("FATAL ERROR IN PORTFOLIO QUERY:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();
