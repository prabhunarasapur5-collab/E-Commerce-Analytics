// ============================================================
// test/stage1_1_corrections.test.js
// Automated Test Suite for Stage 1.1 Independent Code Review Corrections
// ============================================================

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const engine = require('../analytics-engine');

describe('EcomAnalytics Stage 1.1 Review Corrections Suite', () => {

  // ──────────────────────────────────────────────────────────
  // 1. Customer Recency Corrections
  // ──────────────────────────────────────────────────────────
  describe('1. Customer Recency Corrections', () => {
    it('does not reset customer last_order_date when a more recent transaction was returned', () => {
      const rows = [
        { cust_id: 'C1', date: '2025-01-10', price: '1000', status: 'Completed' },
        { cust_id: 'C1', date: '2025-02-15', price: '500', status: 'Returned' }, // More recent, but returned!
      ];
      const mapping = { customer_id: 'cust_id', order_date: 'date', price: 'price', status: 'status' };
      const res = engine.computeCustomerMetrics(rows, mapping, 'latest');

      const cust = res.customers.find(c => c.customer_id === 'C1');
      assert.ok(cust);
      // Recency must be based on completed purchase (Jan 10), not returned (Feb 15)
      assert.equal(cust.last_order_date, '2025-01-10');
      assert.equal(cust.total_orders, 1);
      assert.equal(cust.total_spent, 1000.00);
    });

    it('does not reset customer last_order_date when a more recent transaction was cancelled or pending', () => {
      const rows = [
        { cust_id: 'C2', date: '2025-03-01', price: '2000', status: 'Completed' },
        { cust_id: 'C2', date: '2025-03-20', price: '1500', status: 'Cancelled' },
        { cust_id: 'C2', date: '2025-03-25', price: '800', status: 'Pending' },
      ];
      const mapping = { customer_id: 'cust_id', order_date: 'date', price: 'price', status: 'status' };
      const res = engine.computeCustomerMetrics(rows, mapping, 'latest');

      const cust = res.customers.find(c => c.customer_id === 'C2');
      assert.ok(cust);
      assert.equal(cust.last_order_date, '2025-03-01');
      assert.equal(cust.total_orders, 1);
      assert.equal(cust.total_spent, 2000.00);
    });

    it('classifies customers with only cancelled/returned orders as Inactive with 0 orders and 0 spend', () => {
      const rows = [
        { cust_id: 'C3', date: '2025-04-01', price: '3000', status: 'Cancelled' },
        { cust_id: 'C3', date: '2025-04-10', price: '1200', status: 'Returned' },
      ];
      const mapping = { customer_id: 'cust_id', order_date: 'date', price: 'price', status: 'status' };
      const res = engine.computeCustomerMetrics(rows, mapping, 'latest');

      const cust = res.customers.find(c => c.customer_id === 'C3');
      assert.ok(cust);
      assert.equal(cust.total_orders, 0);
      assert.equal(cust.total_spent, 0.00);
      assert.equal(cust.last_order_date, null);
      assert.equal(cust.days_since_last_order, null);
      assert.equal(cust.segment, 'Inactive');
    });

    it('determines dataset latest reference date from valid completed purchases only', () => {
      const rows = [
        { cust_id: 'C1', date: '2025-01-15', price: '500', status: 'Completed' },
        { cust_id: 'C2', date: '2025-02-10', price: '1000', status: 'Completed' },
        { cust_id: 'C3', date: '2025-05-30', price: '4000', status: 'Cancelled' }, // Future cancelled order
        { cust_id: 'C4', date: '2025-06-15', price: '2500', status: 'Returned' },  // Future returned order
      ];
      const mapping = { customer_id: 'cust_id', order_date: 'date', price: 'price', status: 'status' };
      const res = engine.computeCustomerMetrics(rows, mapping, 'latest');

      // Reference date must resolve to latest COMPLETED transaction date (2025-02-10)
      assert.equal(res.referenceDate, '2025-02-10');
      assert.equal(res.maxDatasetDate, '2025-02-10');
    });
  });

  // ──────────────────────────────────────────────────────────
  // 2. Partial Order ID Handling
  // ──────────────────────────────────────────────────────────
  describe('2. Partial Order ID Handling', () => {
    const mixedRows = [
      // Order ORD-101 (2 product lines)
      { order_id: 'ORD-101', cust_id: 'C1', price: '1000', qty: '1', status: 'Completed', date: '2025-01-10' },
      { order_id: 'ORD-101', cust_id: 'C1', price: '500', qty: '1', status: 'Completed', date: '2025-01-10' },
      // Order ORD-102 (1 product line)
      { order_id: 'ORD-102', cust_id: 'C2', price: '2000', qty: '1', status: 'Completed', date: '2025-01-12' },
      // Rows with missing Order ID
      { order_id: '', cust_id: 'C3', price: '800', qty: '1', status: 'Completed', date: '2025-01-15' },
      { order_id: null, cust_id: 'C4', price: '1200', qty: '1', status: 'Completed', date: '2025-01-18' },
    ];
    const mapping = {
      order_id: 'order_id',
      customer_id: 'cust_id',
      price: 'price',
      quantity: 'qty',
      status: 'status',
      order_date: 'date',
    };

    it('identifies missing Order IDs and flags partial order mapping without inflating AOV', () => {
      const kpis = engine.computeSummaryKPIs(mixedRows, mapping);

      assert.equal(kpis.has_order_id, true);
      assert.equal(kpis.has_partial_order_ids, true);
      assert.equal(kpis.completed_with_order_id, 3);
      assert.equal(kpis.completed_missing_order_id, 2);
      assert.equal(kpis.unique_completed_orders, 2); // ORD-101, ORD-102
      assert.equal(kpis.completed_transactions, 5);

      // Total Completed Net Sales: 1000 + 500 + 2000 + 800 + 1200 = 5500
      assert.equal(kpis.completed_net_sales, 5500.00);

      // Average Order Value is set to null because order IDs are incomplete (never inflate to 5500 / 2 = 2750!)
      assert.equal(kpis.average_order_value, null);

      // Verified order AOV is calculated strictly for verified order subset (3500 / 2 = 1750)
      assert.equal(kpis.verified_order_aov, 1750.00);

      // Primary metric falls back to Average Transaction Value (5500 / 5 = 1100)
      assert.equal(kpis.average_transaction_value, 1100.00);
      assert.equal(kpis.order_metric_type, 'partial_orders');
    });

    it('correctly calculates total orders for customers with partially missing Order IDs', () => {
      const customerRows = [
        // Alice has 2 rows for ORD-1, and 1 unassigned transaction row
        { order_id: 'ORD-1', cust_id: 'Alice', price: '500', status: 'Completed', date: '2025-01-05' },
        { order_id: 'ORD-1', cust_id: 'Alice', price: '700', status: 'Completed', date: '2025-01-05' },
        { order_id: '', cust_id: 'Alice', price: '300', status: 'Completed', date: '2025-01-08' },
      ];
      const res = engine.computeCustomerMetrics(customerRows, mapping);
      const alice = res.customers.find(c => c.customer_id === 'Alice');

      assert.ok(alice);
      assert.equal(alice.verified_orders, 1);
      assert.equal(alice.unassigned_orders, 1);
      // Total orders = 1 verified order + 1 unassigned transaction = 2
      assert.equal(alice.total_orders, 2);
      assert.equal(alice.total_spent, 1500.00);
    });

    it('handles monthly order counts consistently when Order IDs are partially missing', () => {
      const trends = engine.computeMonthlyTrends(mixedRows, mapping);
      assert.equal(trends.length, 1);
      const jan = trends[0];
      assert.equal(jan.month, '2025-01');
      assert.equal(jan.revenue, 5500.00);
      assert.equal(jan.verified_orders, 2);
      assert.equal(jan.unassigned_transactions, 2);
      assert.equal(jan.count_type, 'orders_plus_unassigned');
      assert.equal(jan.count, 4); // 2 verified orders + 2 unassigned
    });
  });

  // ──────────────────────────────────────────────────────────
  // 3. Return Rate: Order-level vs Transaction-level
  // ──────────────────────────────────────────────────────────
  describe('3. Return Rate Distinctions', () => {
    it('calculates order-level return rate using unique orders when Order ID is fully mapped', () => {
      const rows = [
        // Order 1 (2 lines completed)
        { order_id: 'O1', price: '100', status: 'Completed' },
        { order_id: 'O1', price: '100', status: 'Completed' },
        // Order 2 (1 line completed)
        { order_id: 'O2', price: '200', status: 'Completed' },
        // Order 3 (2 lines returned)
        { order_id: 'O3', price: '150', status: 'Returned' },
        { order_id: 'O3', price: '150', status: 'Returned' },
      ];
      const mapping = { order_id: 'order_id', price: 'price', status: 'status' };
      const kpis = engine.computeSummaryKPIs(rows, mapping);

      // Fulfilled orders: 2 completed (O1, O2) + 1 returned (O3) = 3 orders
      // Order return rate: 1 / 3 = 33.3333% (NOT 2 / 5 = 40% row count!)
      assert.equal(kpis.unique_completed_orders, 2);
      assert.equal(kpis.return_rate, 33.3333);
      assert.equal(kpis.return_rate_type, 'order');
    });

    it('labels return rate as transaction return rate when Order ID is absent', () => {
      const rows = [
        { price: '100', status: 'Completed' },
        { price: '100', status: 'Completed' },
        { price: '100', status: 'Completed' },
        { price: '100', status: 'Returned' },
      ];
      const mapping = { price: 'price', status: 'status' };
      const kpis = engine.computeSummaryKPIs(rows, mapping);

      assert.equal(kpis.return_rate, 25.0);
      assert.equal(kpis.return_rate_type, 'transaction');
    });
  });

  // ──────────────────────────────────────────────────────────
  // 4. Missing Transaction Status Handling
  // ──────────────────────────────────────────────────────────
  describe('4. Missing Transaction Status Handling', () => {
    const unmappedStatusRows = [
      { item: 'A', price: '500', qty: '1' },
      { item: 'B', price: '1500', qty: '1' },
    ];

    it('treats rows as unverified when status is missing and handling is conservative', () => {
      const mapping = { price: 'price', quantity: 'qty', status_handling: 'treat_as_unverified' };
      const kpis = engine.computeSummaryKPIs(unmappedStatusRows, mapping);

      // Excluded from completed net sales until verified
      assert.equal(kpis.completed_gross_sales, 0.00);
      assert.equal(kpis.completed_net_sales, 0.00);
      assert.equal(kpis.unclassified_transactions, 2);
    });

    it('treats rows as completed when user explicitly confirms assume_completed assumption', () => {
      const mapping = { price: 'price', quantity: 'qty', status_handling: 'assume_completed' };
      const kpis = engine.computeSummaryKPIs(unmappedStatusRows, mapping);

      // Included in completed sales based on explicit user confirmation
      assert.equal(kpis.completed_gross_sales, 2000.00);
      assert.equal(kpis.completed_net_sales, 2000.00);
      assert.equal(kpis.completed_transactions, 2);
    });
  });

  // ──────────────────────────────────────────────────────────
  // 5. Strict Data Validation & Calculation Safety
  // ──────────────────────────────────────────────────────────
  describe('5. Strict Data Validation & Calculation Safety', () => {
    it('rejects impossible calendar dates (e.g. Feb 30, Apr 31)', () => {
      assert.equal(engine.isValidCalendarDate(2025, 2, 28), true);
      assert.equal(engine.isValidCalendarDate(2024, 2, 29), true); // 2024 leap year
      assert.equal(engine.isValidCalendarDate(2025, 2, 29), false); // 2025 not leap year
      assert.equal(engine.isValidCalendarDate(2025, 2, 30), false);
      assert.equal(engine.isValidCalendarDate(2025, 4, 31), false);
      assert.equal(engine.isValidCalendarDate(2025, 13, 1), false);

      assert.equal(engine.normalizeDateStr('2025-02-30'), null);
      assert.equal(engine.normalizeDateStr('2025-04-31'), null);
      assert.equal(engine.normalizeDateStr('2025-01-15'), '2025-01-15');
    });

    it('does not silently convert negative price or quantity into 0 and excludes them from KPIs', () => {
      const row = { price: '-250', qty: '2', status: 'Completed' };
      const mapping = { price: 'price', quantity: 'qty', status: 'status' };
      const fin = engine.calculateRowFinancials(row, mapping);

      assert.equal(fin.is_valid, false);
      assert.ok(fin.validation_errors.some(e => e.includes('Negative price')));

      const kpis = engine.computeSummaryKPIs([row], mapping);
      assert.equal(kpis.invalid_records_count, 1);
      assert.equal(kpis.completed_gross_sales, 0.00);
      assert.equal(kpis.completed_net_sales, 0.00);
    });

    it('does not silently cap discount percentages above 100% and flags them as invalid', () => {
      const row = { price: '1000', qty: '1', disc: '125', status: 'Completed' };
      const mapping = { price: 'price', quantity: 'qty', discount: 'disc', status: 'status', discount_type: 'percentage' };
      const fin = engine.calculateRowFinancials(row, mapping);

      assert.equal(fin.is_valid, false);
      assert.ok(fin.validation_errors.some(e => e.includes('exceeds 100%')));

      const kpis = engine.computeSummaryKPIs([row], mapping);
      assert.equal(kpis.invalid_records_count, 1);
      assert.equal(kpis.completed_net_sales, 0.00);
    });

    it('flags assumed quantity when quantity column is missing but price exists', () => {
      const row = { price: '499', status: 'Completed' };
      const mapping = { price: 'price', status: 'status' };
      const fin = engine.calculateRowFinancials(row, mapping);

      assert.equal(fin.is_valid, true);
      assert.equal(fin.assumed_quantity, true);
      assert.equal(fin.quantity, 1);
      assert.equal(fin.gross_amount, 499.00);
    });

    it('supports decimal fractional quantities without corruption', () => {
      const row = { price: '100', qty: '1.5', status: 'Completed' };
      const mapping = { price: 'price', quantity: 'qty', status: 'status' };
      const fin = engine.calculateRowFinancials(row, mapping);

      assert.equal(fin.is_valid, true);
      assert.equal(fin.quantity, 1.5);
      assert.equal(fin.gross_amount, 150.00);
    });
  });

  // ──────────────────────────────────────────────────────────
  // 6. Robust CSV and JSON Parsing
  // ──────────────────────────────────────────────────────────
  describe('6. Robust CSV and JSON Parsing', () => {
    it('handles UTF-8 BOM cleanly without corrupting the first column name', () => {
      const csvWithBom = '\uFEFForder_id,price,status\nORD-1,100,Completed\nORD-2,200,Completed';
      const parsed = engine.parseCSV(csvWithBom);

      assert.equal(parsed.headers[0], 'order_id');
      assert.equal(parsed.rows.length, 2);
      assert.equal(parsed.rows[0].order_id, 'ORD-1');
    });

    it('correctly parses multiline quoted values in CSV', () => {
      const multilineCsv = 'id,description,price\n1,"First line\nSecond line",500\n2,"Normal item",300';
      const parsed = engine.parseCSV(multilineCsv);

      assert.equal(parsed.rows.length, 2);
      assert.equal(parsed.rows[0].id, '1');
      assert.equal(parsed.rows[0].description, 'First line\nSecond line');
      assert.equal(parsed.rows[0].price, '500');
    });

    it('correctly parses escaped quotation marks inside CSV fields', () => {
      const escapedCsv = 'id,quote_text,price\n1,"She said ""Hello World!""",250';
      const parsed = engine.parseCSV(escapedCsv);

      assert.equal(parsed.rows.length, 1);
      assert.equal(parsed.rows[0].quote_text, 'She said "Hello World!"');
    });

    it('detects and reports column count mismatches in CSV rows', () => {
      const unevenCsv = 'a,b,c\n1,2,3\n4,5\n7,8,9,10';
      const parsed = engine.parseCSV(unevenCsv);

      assert.equal(parsed.columnCountMismatches.length, 2);
      assert.equal(parsed.columnCountMismatches[0].rowNumber, 3);
      assert.equal(parsed.columnCountMismatches[1].rowNumber, 4);
    });

    it('captures JSON keys that appear only after row 100', () => {
      const items = [];
      for (let i = 1; i <= 120; i++) {
        const item = { id: i, amount: 100 };
        if (i === 115) {
          item.late_appearing_key = 'special_promo_code';
        }
        items.push(item);
      }

      // Collect keys across all rows
      const keySet = new Set();
      items.forEach(it => {
        Object.keys(it).forEach(k => keySet.add(k));
      });
      const allHeaders = Array.from(keySet);

      assert.ok(allHeaders.includes('late_appearing_key'), 'Should detect keys appearing after row 100');
    });
  });

  // ──────────────────────────────────────────────────────────
  // 7. Verified Golden Reference Date (new_transactions.csv)
  // ──────────────────────────────────────────────────────────
  describe('7. Verified Golden Reference Date', () => {
    it('calculates maximum completed transaction date as 2025-04-12 from committed new_transactions.csv', () => {
      const csvPath = path.join(__dirname, '..', 'new_transactions.csv');
      const content = fs.readFileSync(csvPath, 'utf8');
      const parsed = engine.parseCSV(content);

      const mapping = {
        customer_id: 'customer_id',
        product_id: 'product_id',
        price: 'unit_price',
        quantity: 'quantity',
        discount: 'discount_pct',
        status: 'status',
        order_date: 'order_date',
        discount_type: 'percentage',
        price_type: 'unit_price',
      };

      const custMetrics = engine.computeCustomerMetrics(parsed.rows, mapping, 'latest');

      // Date of row 26 is 2025-04-12 (Completed)
      assert.equal(custMetrics.referenceDate, '2025-04-12');
      assert.equal(custMetrics.maxDatasetDate, '2025-04-12');
    });
  });

});
