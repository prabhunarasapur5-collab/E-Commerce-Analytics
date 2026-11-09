// ============================================================
// test/accuracy.test.js
// Automated test suite for Stage 1: Accuracy & Business Logic
// Uses Node.js built-in node:test and node:assert
// ============================================================

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const engine = require('../analytics-engine');

describe('EcomAnalytics Stage 1 Accuracy Suite', () => {

  // 1. Transaction Status Normalization
  describe('1. Transaction Status Normalization', () => {
    it('normalizes completed variants correctly', () => {
      const variants = ['Completed', 'completed', ' COMPLETE ', 'Success', 'successful', 'Delivered', 'paid', 'fulfilled'];
      variants.forEach(v => {
        assert.equal(engine.normalizeStatus(v), 'completed', `Expected ${v} to be completed`);
      });
    });

    it('normalizes returned variants correctly', () => {
      const variants = ['Returned', 'return', 'refund', 'refunded', 'RTO', 'exchange'];
      variants.forEach(v => {
        assert.equal(engine.normalizeStatus(v), 'returned', `Expected ${v} to be returned`);
      });
    });

    it('normalizes cancelled variants correctly', () => {
      const variants = ['Cancelled', 'canceled', 'cancel', 'VOID', 'failed', 'aborted', 'rejected'];
      variants.forEach(v => {
        assert.equal(engine.normalizeStatus(v), 'cancelled', `Expected ${v} to be cancelled`);
      });
    });

    it('normalizes pending variants correctly', () => {
      const variants = ['Pending', 'processing', 'in_progress', 'shipped', 'on_hold'];
      variants.forEach(v => {
        assert.equal(engine.normalizeStatus(v), 'pending', `Expected ${v} to be pending`);
      });
    });

    it('classifies unrecognized statuses as other without crashing', () => {
      const unknowns = ['disputed', 'mystery_status', null, undefined, '', '???'];
      unknowns.forEach(u => {
        assert.equal(engine.normalizeStatus(u), 'other', `Expected ${u} to be other`);
      });
    });
  });

  // 2. Gross & Completed Sales Calculations
  describe('2. Gross & Completed Sales Calculations', () => {
    const sampleRows = [
      { price: '1000', qty: '2', status: 'Completed', disc: '10' }, // Gross: 2000, Disc: 200, Net: 1800
      { price: '500', qty: '1', status: 'Cancelled', disc: '0' },   // Gross: 500 (Excluded from completed)
      { price: '800', qty: '1', status: 'Returned', disc: '5' },    // Gross: 800 (Excluded from completed)
      { price: '1200', qty: '1', status: 'Completed', disc: '0' },  // Gross: 1200, Disc: 0, Net: 1200
    ];
    const mapping = { price: 'price', quantity: 'qty', status: 'status', discount: 'disc', discount_type: 'percentage' };

    it('computes GTV across all records and Completed Gross separately', () => {
      const kpis = engine.computeSummaryKPIs(sampleRows, mapping);
      assert.equal(kpis.gross_transaction_value, 4500.00); // 2000 + 500 + 800 + 1200
      assert.equal(kpis.completed_gross_sales, 3200.00);    // 2000 + 1200
      assert.equal(kpis.completed_discount_amount, 200.00); // 200
      assert.equal(kpis.completed_net_sales, 3000.00);      // 3200 - 200
      assert.equal(kpis.returned_gross_value, 800.00);
      assert.equal(kpis.cancelled_gross_value, 500.00);
      assert.equal(kpis.completed_transactions, 2);
    });

    it('does not double count returns by deducting them from completed sales', () => {
      const kpis = engine.computeSummaryKPIs(sampleRows, mapping);
      // Completed net sales must be Completed Gross - Completed Discount, NOT subtracting returned gross again
      assert.equal(kpis.completed_net_sales, 3000.00);
    });
  });

  // 3. Discount Calculations (Percentage vs Fixed)
  describe('3. Discount Calculations (Percentage, Fixed Total, Fixed Unit)', () => {
    it('calculates percentage discounts accurately', () => {
      const row = { price: '200', qty: '5', discount: '15' }; // Gross = 1000, 15% = 150, Net = 850
      const fin = engine.calculateRowFinancials(row, {
        price: 'price', quantity: 'qty', discount: 'discount', discount_type: 'percentage'
      });
      assert.equal(fin.gross_amount, 1000.00);
      assert.equal(fin.discount_amount, 150.00);
      assert.equal(fin.net_amount, 850.00);
    });

    it('calculates fixed monetary discount per line item', () => {
      const row = { price: '200', qty: '5', discount: '150' }; // Gross = 1000, Fixed line discount = 150, Net = 850
      const fin = engine.calculateRowFinancials(row, {
        price: 'price', quantity: 'qty', discount: 'discount', discount_type: 'fixed_total'
      });
      assert.equal(fin.gross_amount, 1000.00);
      assert.equal(fin.discount_amount, 150.00);
      assert.equal(fin.net_amount, 850.00);
    });

    it('calculates fixed discount per unit', () => {
      const row = { price: '200', qty: '5', discount: '20' }; // Gross = 1000, 20/unit * 5 = 100, Net = 900
      const fin = engine.calculateRowFinancials(row, {
        price: 'price', quantity: 'qty', discount: 'discount', discount_type: 'fixed_unit'
      });
      assert.equal(fin.gross_amount, 1000.00);
      assert.equal(fin.discount_amount, 100.00);
      assert.equal(fin.net_amount, 900.00);
    });

    it('caps discount amount to not exceed gross value', () => {
      const row = { price: '50', qty: '1', discount: '200' };
      const fin = engine.calculateRowFinancials(row, {
        price: 'price', quantity: 'qty', discount: 'discount', discount_type: 'fixed_total'
      });
      assert.equal(fin.discount_amount, 50.00);
      assert.equal(fin.net_amount, 0.00);
    });
  });

  // 4. Price Interpretation: Unit Price vs Line Total
  describe('4. Price Interpretation (Unit Price vs Line Total)', () => {
    it('multiplies price by quantity when price_type is unit_price', () => {
      const row = { price: '500', qty: '3' };
      const fin = engine.calculateRowFinancials(row, {
        price: 'price', quantity: 'qty', price_type: 'unit_price'
      });
      assert.equal(fin.gross_amount, 1500.00);
    });

    it('does not multiply by quantity when price_type is line_total', () => {
      const row = { price: '1500', qty: '3' };
      const fin = engine.calculateRowFinancials(row, {
        price: 'price', quantity: 'qty', price_type: 'line_total'
      });
      assert.equal(fin.gross_amount, 1500.00);
    });
  });

  // 5. Order Count and AOV with Multi-line Orders
  describe('5. Order Count and AOV with Multi-line Orders', () => {
    const multiLineOrderRows = [
      // Order 101: 2 items, completed, total net = 1800 + 400 = 2200
      { order_id: 'ORD-101', price: '1000', qty: '2', disc: '10', status: 'Completed' }, // net 1800
      { order_id: 'ORD-101', price: '400', qty: '1', disc: '0', status: 'Completed' },  // net 400
      // Order 102: 1 item, completed, net = 800
      { order_id: 'ORD-102', price: '800', qty: '1', disc: '0', status: 'Completed' },  // net 800
      // Order 103: cancelled order
      { order_id: 'ORD-103', price: '500', qty: '1', disc: '0', status: 'Cancelled' },
    ];
    const mapping = { order_id: 'order_id', price: 'price', quantity: 'qty', discount: 'disc', status: 'status' };

    it('counts unique completed order IDs instead of rows', () => {
      const kpis = engine.computeSummaryKPIs(multiLineOrderRows, mapping);
      assert.equal(kpis.completed_transactions, 3);
      assert.equal(kpis.unique_completed_orders, 2); // Only ORD-101 and ORD-102
      assert.equal(kpis.completed_net_sales, 3000.00);
      // AOV = 3000 / 2 = 1500
      assert.equal(kpis.average_order_value, 1500.00);
      // ATV = 3000 / 3 = 1000
      assert.equal(kpis.average_transaction_value, 1000.00);
    });

    it('falls back to ATV when order_id is not mapped', () => {
      const withoutOrderIdMapping = { price: 'price', quantity: 'qty', discount: 'disc', status: 'status' };
      const kpis = engine.computeSummaryKPIs(multiLineOrderRows, withoutOrderIdMapping);
      assert.equal(kpis.has_order_id, false);
      assert.equal(kpis.unique_completed_orders, null);
      assert.equal(kpis.average_order_value, null);
      assert.equal(kpis.average_transaction_value, 1000.00);
    });
  });

  // 6. Return Rate Calculations
  describe('6. Return Rate Calculations', () => {
    it('computes return rate on fulfilled orders basis: returned / (completed + returned)', () => {
      const rows = [
        { status: 'Completed', price: '100' },
        { status: 'Completed', price: '100' },
        { status: 'Completed', price: '100' },
        { status: 'Returned', price: '100' },
        { status: 'Cancelled', price: '100' }, // Cancelled orders were never shipped/fulfilled
      ];
      const mapping = { status: 'status', price: 'price' };
      const kpis = engine.computeSummaryKPIs(rows, mapping);
      assert.equal(kpis.completed_transactions, 3);
      assert.equal(kpis.returned_count, 1);
      assert.equal(kpis.cancelled_count, 1);
      // 1 / (3 + 1) = 25%
      assert.equal(kpis.return_rate, 25.0);
    });
  });

  // 7. Customer Spending & Historical Reference Date
  describe('7. Customer Spending & Historical Reference Date', () => {
    const custRows = [
      // Alice: 2 completed orders, 1 returned. Spend must ONLY include completed!
      { cust_id: 'C1', cust_name: 'Alice', price: '1000', qty: '1', disc: '0', status: 'Completed', date: '2025-01-10' },
      { cust_id: 'C1', cust_name: 'Alice', price: '2000', qty: '1', disc: '10', status: 'Completed', date: '2025-03-15' }, // 1800 net
      { cust_id: 'C1', cust_name: 'Alice', price: '5000', qty: '1', disc: '0', status: 'Returned', date: '2025-04-01' },   // returned, should NOT count!
      // Bob: only cancelled order
      { cust_id: 'C2', cust_name: 'Bob', price: '800', qty: '1', disc: '0', status: 'Cancelled', date: '2025-02-20' },
    ];
    const mapping = {
      customer_id: 'cust_id',
      customer_name: 'cust_name',
      price: 'price',
      quantity: 'qty',
      discount: 'disc',
      status: 'status',
      order_date: 'date',
    };

    it('calculates customer total spent using completed net sales only', () => {
      const res = engine.computeCustomerMetrics(custRows, mapping, 'latest');
      const alice = res.customers.find(c => c.customer_id === 'C1');
      assert.ok(alice);
      assert.equal(alice.total_orders, 2);
      assert.equal(alice.total_spent, 2800.00); // 1000 + 1800 (not 7800!)

      const bob = res.customers.find(c => c.customer_id === 'C2');
      assert.ok(bob);
      assert.equal(bob.total_orders, 0);
      assert.equal(bob.total_spent, 0.00);
      assert.equal(bob.segment, 'Inactive');
    });

    it('uses latest dataset transaction date as default reference date for recency', () => {
      const res = engine.computeCustomerMetrics(custRows, mapping, 'latest');
      assert.equal(res.referenceDate, '2025-04-01'); // max date in dataset
      const alice = res.customers.find(c => c.customer_id === 'C1');
      // Alice last order was 2025-04-01 (returned order recorded date) -> 0 days recency
      assert.equal(alice.days_since_last_order, 0);
    });

    it('supports custom reference date', () => {
      const res = engine.computeCustomerMetrics(custRows, mapping, '2025-05-01');
      assert.equal(res.referenceDate, '2025-05-01');
      const alice = res.customers.find(c => c.customer_id === 'C1');
      assert.equal(alice.days_since_last_order, 30); // 30 days from 2025-04-01 to 2025-05-01
    });
  });

  // 8. Strict Data Validation & Audit
  describe('8. Strict Data Validation & Quality Audit', () => {
    it('detects invalid alphanumeric numbers without converting them to 0 silently', () => {
      assert.equal(engine.parseStrictNumber('12abc'), null);
      assert.equal(engine.parseStrictNumber('₹500'), null);
      assert.equal(engine.parseStrictNumber('12.50'), 12.50);
      assert.equal(engine.parseStrictNumber(42), 42);
    });

    it('audits dataset quality and generates warnings for negative and excessive values', () => {
      const badRows = [
        { price: '-100', qty: '1', disc: '150', status: 'weird_status' },
        { price: '12abc', qty: '0', disc: '0', status: 'Completed' },
      ];
      const audit = engine.auditDatasetQuality(badRows, {
        price: 'price', quantity: 'qty', discount: 'disc', status: 'status', discount_type: 'percentage'
      });
      assert.ok(audit.warnings.length >= 3);
      assert.equal(audit.stats.invalidPrices, 1);
      assert.equal(audit.stats.negativeValues, 1);
      assert.equal(audit.stats.excessiveDiscounts, 1);
      assert.equal(audit.stats.unknownStatusCount, 1);
    });
  });

  // 9. Monthly Trends with Dual Series
  describe('9. Monthly Trends with Dual Series', () => {
    const monthlyRows = [
      { date: '2025-01-05', price: '100', status: 'Completed' },
      { date: '2025-01-20', price: '200', status: 'Completed' },
      { date: '2025-01-22', price: '500', status: 'Cancelled' }, // Should not be in monthly revenue
      { date: '2025-02-10', price: '300', status: 'Completed' },
    ];
    const mapping = { order_date: 'date', price: 'price', status: 'status' };

    it('computes completed net revenue and completed count per month', () => {
      const trends = engine.computeMonthlyTrends(monthlyRows, mapping);
      assert.equal(trends.length, 2);
      assert.equal(trends[0].month, '2025-01');
      assert.equal(trends[0].revenue, 300.00); // 100 + 200 (500 cancelled excluded)
      assert.equal(trends[0].count, 2);

      assert.equal(trends[1].month, '2025-02');
      assert.equal(trends[1].revenue, 300.00);
      assert.equal(trends[1].count, 1);
    });
  });

  // 10. Golden Dataset Validation: new_transactions.csv
  describe('10. Golden Dataset Validation (new_transactions.csv)', () => {
    const csvPath = path.join(__dirname, '..', 'new_transactions.csv');
    const content = fs.readFileSync(csvPath, 'utf8').trim();
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(l => {
      const parts = l.split(',').map(p => p.trim());
      const obj = {};
      headers.forEach((h, i) => obj[h] = parts[i]);
      return obj;
    });

    const mapping = {
      customer_id: 'customer_id',
      product_id: 'product_id',
      quantity: 'quantity',
      price: 'unit_price',
      discount: 'discount_pct',
      discount_type: 'percentage',
      price_type: 'unit_price',
      payment_type: 'payment_type',
      status: 'status',
      order_date: 'order_date',
    };

    it('matches exact Part 8 golden baseline metrics', () => {
      const kpis = engine.computeSummaryKPIs(rows, mapping);

      // Total transaction rows: 25
      assert.equal(kpis.total_records, 25);
      // Completed transactions: 23
      assert.equal(kpis.completed_transactions, 23);
      // Returned transactions: 1
      assert.equal(kpis.returned_count, 1);
      // Cancelled transactions: 1
      assert.equal(kpis.cancelled_count, 1);

      // Financials
      assert.equal(kpis.gross_transaction_value, 635844.00);
      assert.equal(kpis.completed_gross_sales, 615846.00);
      assert.equal(kpis.completed_discount_amount, 43985.14);
      assert.equal(kpis.completed_net_sales, 571860.86);
      assert.equal(kpis.returned_gross_value, 4999.00);
      assert.equal(kpis.cancelled_gross_value, 14999.00);
      assert.equal(kpis.total_discounts_all, 45884.96);

      // Return Rate: 4.1667%
      assert.equal(kpis.return_rate, 4.1667);

      // Completed net per transaction: ~24863.52
      assert.equal(kpis.average_transaction_value, 24863.52);
    });

    it('identifies 20 unique customers and resolves reference date to latest transaction date', () => {
      const custMetrics = engine.computeCustomerMetrics(rows, mapping);
      assert.equal(custMetrics.customers.length, 20);
      assert.equal(custMetrics.referenceDate, '2025-04-12');
      assert.equal(custMetrics.maxDatasetDate, '2025-04-12');

      // Top customer by spend should have completed net spend
      const topCust = custMetrics.customers[0];
      assert.equal(topCust.customer_id, '1');
      assert.equal(topCust.total_orders, 2);
      assert.equal(topCust.total_spent, 153795.50);
    });

    it('displays product ID fallback when product names are absent', () => {
      const topProds = engine.computeTopProducts(rows, mapping);
      assert.ok(topProds.length > 0);
      // Since new_transactions.csv has product_id but no product name
      topProds.forEach(p => {
        assert.ok(p.product.startsWith('Product #'), `Expected Product #ID format, got ${p.product}`);
      });
    });
  });

});
