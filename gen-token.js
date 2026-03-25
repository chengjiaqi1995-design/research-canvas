import jwt from 'jsonwebtoken';

const JWT_SECRET = '34794b4f4a07d9f602e1b0ee64077607ebd547fae450a6496fdaac8e23ee4943';
const token = jwt.sign(
    { sub: "12345", email: "test@example.com", name: "Test User" },
    JWT_SECRET,
    { expiresIn: '7d' }
);
console.log(token);
