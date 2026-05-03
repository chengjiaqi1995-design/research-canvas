import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is required');
}
const token = jwt.sign(
    { sub: "12345", email: "test@example.com", name: "Test User" },
    JWT_SECRET,
    { expiresIn: '7d' }
);
console.log(token);
