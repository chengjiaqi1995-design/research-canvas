require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const axios = require('axios');

async function run() {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst();
    if (!user) return console.log('No user');
    
    const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1d' });
    
    const res = await axios.post('http://localhost:8080/api/transcriptions/normalize-companies', {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("Status:", res.status);
    console.log("Data:", JSON.stringify(res.data, null, 2));
  } catch (err) {
    if (err.response) {
      console.error("HTTP ERROR", err.response.status, err.response.data);
    } else {
      console.error("NETWORK ERROR", err.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}
run();
