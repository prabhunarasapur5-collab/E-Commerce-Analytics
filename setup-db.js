// ============================================================
// setup-db.js — Database & Tables Initializer (No Demo Data)
// Run: node setup-db.js
// ============================================================

require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
};

const DB_NAME = process.env.DB_NAME || 'ecommerce_analytics';

async function main() {
  console.log('\n===========================================');
  console.log('  E-Commerce Analytics — Database Setup  ');
  console.log('===========================================\n');

  let conn;
  try {
    console.log('Connecting to MySQL...');
    conn = await mysql.createConnection(DB_CONFIG);
    console.log('  Connected.\n');

    console.log(`Creating database "${DB_NAME}" if not exists...`);
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
    await conn.query(`USE \`${DB_NAME}\`;`);
    console.log('  Database ready.\n');

    console.log('Creating tables...');

    // 1. Users table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(150) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin','analyst') NOT NULL DEFAULT 'analyst',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Datasets table (Isolated per user)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS datasets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(50) NOT NULL,
        row_count INT NOT NULL DEFAULT 0,
        column_mapping JSON,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_user_active (user_id, is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Dataset rows table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS dataset_rows (
        id INT AUTO_INCREMENT PRIMARY KEY,
        dataset_id INT NOT NULL,
        user_id INT NOT NULL,
        \`row_number\` INT NOT NULL,
        raw_data JSON NOT NULL,
        customer_id VARCHAR(255) NULL,
        customer_name VARCHAR(255) NULL,
        product VARCHAR(255) NULL,
        category VARCHAR(255) NULL,
        price DECIMAL(12,2) NULL,
        quantity INT NULL,
        order_date DATE NULL,
        discount DECIMAL(12,2) NULL,
        location VARCHAR(255) NULL,
        payment_type VARCHAR(100) NULL,
        status VARCHAR(100) NULL,
        FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_dataset_id (dataset_id),
        INDEX idx_user_dataset (user_id, dataset_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('  Tables created successfully.\n');

    // Create default accounts if users table is empty
    const [userCount] = await conn.query('SELECT COUNT(*) as count FROM users');
    if (userCount[0].count === 0) {
      console.log('Creating initial admin account...');
      const adminHash = await bcrypt.hash('Admin@123', 10);
      await conn.query(
        'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
        ['admin', 'admin@ecomanalytics.io', adminHash, 'admin']
      );
      console.log('  Admin created: admin@ecomanalytics.io / Admin@123\n');
    }

    console.log('===========================================');
    console.log('  Database setup completed (Clean slate: 0 demo datasets).');
    console.log('===========================================\n');
  } catch (err) {
    console.error('Setup failed:', err.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

main();
