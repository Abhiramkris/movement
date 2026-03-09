const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

(async () => {
    try {
        const connection = await db.getConnection();
        console.log('MySQL pool connected');
        connection.release();
    } catch (err) {
        console.error('MySQL connection error:', {
            code: err.code,
            errno: err.errno,
            message: err.message
        });
    }
})();

module.exports = db;
