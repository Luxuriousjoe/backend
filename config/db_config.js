const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

const sslConfig = process.env.DB_SSL === 'true' ? {
  rejectUnauthorized: false,
} : false;

const pool = mysql.createPool({
  host:               process.env.DB_HOST,
  port:               parseInt(process.env.DB_PORT) || 3306,
  database:           process.env.DB_NAME,
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  ssl:                sslConfig,
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  charset:            'utf8mb4',
});

module.exports = pool;
