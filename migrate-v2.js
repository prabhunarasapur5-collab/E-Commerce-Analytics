// migrate-v2.js
require('dotenv').config();
const mysql = require('mysql2/promise');

async function runMigration() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ecommerce_analytics',
  });

  console.log('Running v2 migration...');

  // 1. Clear old demo data
  try { await conn.query('DELETE FROM transactions'); } catch (e) {}
  try { await conn.query('DELETE FROM order_items'); } catch (e) {}
  try { await conn.query('DELETE FROM orders'); } catch (e) {}
  try { await conn.query('DELETE FROM products'); } catch (e) {}
  try { await conn.query('DELETE FROM customers'); } catch (e) {}
  try { await conn.query('DELETE FROM categories'); } catch (e) {}
  console.log('Cleared old demo rows (users table preserved).');

  // 2. Create datasets table
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

  // 3. Create dataset_rows table
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

  console.log('datasets and dataset_rows tables verified/created successfully.');
  await conn.end();
}

runMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
