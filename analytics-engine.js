// ============================================================
// analytics-engine.js
// Centralized Business Logic & Accuracy Engine for EcomAnalytics
// ============================================================

/**
 * Normalizes transaction status strings into standard categories:
 * - 'completed'
 * - 'returned'
 * - 'cancelled'
 * - 'pending'
 * - 'other'
 */
function normalizeStatus(rawStatus) {
  if (rawStatus === undefined || rawStatus === null) {
    return 'other';
  }

  const s = String(rawStatus).trim().toLowerCase();
  if (!s) return 'other';

  // Completed variants
  if (
    s === 'completed' ||
    s === 'complete' ||
    s === 'success' ||
    s === 'successful' ||
    s === 'delivered' ||
    s === 'paid' ||
    s === 'fulfilled' ||
    s === 'done' ||
    s === 'closed'
  ) {
    return 'completed';
  }

  // Returned variants
  if (
    s === 'returned' ||
    s === 'return' ||
    s === 'refund' ||
    s === 'refunded' ||
    s === 'rto' ||
    s === 'exchange' ||
    s === 'exchanged'
  ) {
    return 'returned';
  }

  // Cancelled variants
  if (
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'cancel' ||
    s === 'void' ||
    s === 'voided' ||
    s === 'failed' ||
    s === 'aborted' ||
    s === 'rejected'
  ) {
    return 'cancelled';
  }

  // Pending variants
  if (
    s === 'pending' ||
    s === 'processing' ||
    s === 'in_progress' ||
    s === 'in progress' ||
    s === 'placed' ||
    s === 'shipped' ||
    s === 'in_transit' ||
    s === 'in transit' ||
    s === 'on_hold' ||
    s === 'on hold' ||
    s === 'hold'
  ) {
    return 'pending';
  }

  return 'other';
}

/**
 * Strict numeric parser that rejects alphanumeric strings like "12abc"
 */
function parseStrictNumber(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return isFinite(val) ? val : null;
  const str = String(val).trim().replace(/,/g, '');
  if (str === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(str)) return null;
  const num = Number(str);
  return isFinite(num) ? num : null;
}

/**
 * Normalizes date strings (YYYY-MM-DD)
 */
function normalizeDateStr(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(val).trim();
  const isoMatch = str.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  const dmyMatch = str.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }
  const dt = new Date(str);
  if (!isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

/**
 * Calculates line-level financials:
 * - gross_amount
 * - discount_amount
 * - net_amount
 * - normalized_status
 *
 * Handles:
 * - price_type: 'unit_price' (default) vs 'line_total'
 * - discount_type: 'percentage' (default) vs 'fixed_total' vs 'fixed_unit'
 */
function calculateRowFinancials(row, mapping = {}) {
  const getCol = (key) => {
    const colName = mapping[key];
    if (!colName || row[colName] === undefined || row[colName] === null) return null;
    return row[colName];
  };

  const priceType = mapping.price_type || 'unit_price'; // 'unit_price' | 'line_total'
  const discountType = mapping.discount_type || 'percentage'; // 'percentage' | 'fixed_total' | 'fixed_unit'

  // Extract raw values
  const rawPrice = getCol('price');
  const rawQty = getCol('quantity');
  const rawDisc = getCol('discount');
  const rawStatus = getCol('status');

  const priceNum = parseStrictNumber(rawPrice);
  const qtyNum = parseStrictNumber(rawQty);
  const discNum = parseStrictNumber(rawDisc);

  // Default quantity logic: if price exists and quantity is missing, treat as 1 unit
  const quantity = qtyNum !== null ? Math.max(0, qtyNum) : (priceNum !== null ? 1 : null);
  const unitPrice = priceNum !== null ? Math.max(0, priceNum) : null;

  let gross = 0.0;
  if (unitPrice !== null) {
    if (priceType === 'line_total') {
      gross = unitPrice;
    } else {
      gross = unitPrice * (quantity !== null ? quantity : 1);
    }
  }

  // Calculate actual monetary discount
  let discountAmount = 0.0;
  if (discNum !== null && discNum > 0) {
    if (discountType === 'percentage') {
      // Percentage between 0 and 100
      const pct = Math.min(100, Math.max(0, discNum));
      discountAmount = gross * (pct / 100.0);
    } else if (discountType === 'fixed_unit') {
      discountAmount = Math.min(gross, discNum * (quantity !== null ? quantity : 1));
    } else {
      // fixed_total
      discountAmount = Math.min(gross, discNum);
    }
  }

  // Net amount cannot be negative
  const net = Math.max(0.0, gross - discountAmount);
  const normalizedStatus = normalizeStatus(rawStatus);

  return {
    unit_price: unitPrice,
    quantity,
    gross_amount: Math.round(gross * 100) / 100,
    discount_amount: Math.round(discountAmount * 100) / 100,
    net_amount: Math.round(net * 100) / 100,
    normalized_status: normalizedStatus,
    raw_status: rawStatus ? String(rawStatus).trim() : null,
  };
}

/**
 * Audits uploaded rows and generates data quality warnings
 */
function auditDatasetQuality(rows, mapping = {}) {
  const warnings = [];
  let invalidPrices = 0;
  let invalidQuantities = 0;
  let invalidDates = 0;
  let negativeValues = 0;
  let excessiveDiscounts = 0;
  let unknownStatusCount = 0;
  const unknownStatusesSet = new Set();
  const seenOrderCustomerProduct = new Set();
  let potentialDuplicateRows = 0;

  const priceCol = mapping.price;
  const qtyCol = mapping.quantity;
  const discCol = mapping.discount;
  const dateCol = mapping.order_date;
  const statusCol = mapping.status;
  const orderIdCol = mapping.order_id;
  const custIdCol = mapping.customer_id;
  const prodCol = mapping.product || mapping.product_id;

  const discountType = mapping.discount_type || 'percentage';

  rows.forEach((r, idx) => {
    if (priceCol && r[priceCol] !== undefined && r[priceCol] !== null && String(r[priceCol]).trim() !== '') {
      const p = parseStrictNumber(r[priceCol]);
      if (p === null) invalidPrices++;
      else if (p < 0) negativeValues++;
    }

    if (qtyCol && r[qtyCol] !== undefined && r[qtyCol] !== null && String(r[qtyCol]).trim() !== '') {
      const q = parseStrictNumber(r[qtyCol]);
      if (q === null) invalidQuantities++;
      else if (q < 0) negativeValues++;
    }

    if (discCol && r[discCol] !== undefined && r[discCol] !== null && String(r[discCol]).trim() !== '') {
      const d = parseStrictNumber(r[discCol]);
      if (d !== null) {
        if (discountType === 'percentage' && (d < 0 || d > 100)) excessiveDiscounts++;
        else if (d < 0) negativeValues++;
      }
    }

    if (dateCol && r[dateCol] !== undefined && r[dateCol] !== null && String(r[dateCol]).trim() !== '') {
      const d = normalizeDateStr(r[dateCol]);
      if (!d) invalidDates++;
    }

    if (statusCol && r[statusCol] !== undefined && r[statusCol] !== null && String(r[statusCol]).trim() !== '') {
      const norm = normalizeStatus(r[statusCol]);
      if (norm === 'other') {
        unknownStatusCount++;
        unknownStatusesSet.add(String(r[statusCol]).trim());
      }
    }

    // Duplicate detection key
    const idVal = orderIdCol ? r[orderIdCol] : (custIdCol ? r[custIdCol] : null);
    const prodVal = prodCol ? r[prodCol] : null;
    const dateVal = dateCol ? r[dateCol] : null;
    if (idVal && prodVal && dateVal) {
      const key = `${String(idVal).trim()}|${String(prodVal).trim()}|${String(dateVal).trim()}`;
      if (seenOrderCustomerProduct.has(key)) {
        potentialDuplicateRows++;
      } else {
        seenOrderCustomerProduct.add(key);
      }
    }
  });

  if (invalidPrices > 0) warnings.push(`${invalidPrices} row(s) contain invalid non-numeric price data.`);
  if (invalidQuantities > 0) warnings.push(`${invalidQuantities} row(s) contain invalid non-numeric quantity values.`);
  if (negativeValues > 0) warnings.push(`${negativeValues} row(s) contain negative price, quantity or discount values.`);
  if (excessiveDiscounts > 0) warnings.push(`${excessiveDiscounts} row(s) have discount percentages exceeding 100% or below 0%.`);
  if (invalidDates > 0) warnings.push(`${invalidDates} row(s) contain unparseable date formats.`);
  if (unknownStatusCount > 0) {
    const list = Array.from(unknownStatusesSet).slice(0, 5).join(', ');
    warnings.push(`${unknownStatusCount} row(s) have unrecognized statuses (${list}). These are treated as 'Other' and excluded from completed sales.`);
  }
  if (potentialDuplicateRows > 0) {
    warnings.push(`Detected ${potentialDuplicateRows} potential duplicate transaction rows sharing the same ID, item, and date.`);
  }

  return {
    warnings,
    stats: {
      invalidPrices,
      invalidQuantities,
      negativeValues,
      excessiveDiscounts,
      invalidDates,
      unknownStatusCount,
      unknownStatuses: Array.from(unknownStatusesSet),
      potentialDuplicateRows,
    },
  };
}

/**
 * Computes Executive Summary KPI Metrics strictly from rows
 */
function computeSummaryKPIs(rows, mapping = {}) {
  const hasPrice = !!mapping.price;
  const hasStatus = !!mapping.status;
  const hasOrderId = !!mapping.order_id;
  const hasDiscount = !!mapping.discount;

  let grossTransactionValue = 0.0;
  let completedGrossSales = 0.0;
  let completedDiscountAmount = 0.0;
  let totalDiscountsAll = 0.0;
  let returnedGrossValue = 0.0;
  let cancelledGrossValue = 0.0;

  let completedTransactionsCount = 0;
  let returnedCount = 0;
  let cancelledCount = 0;
  let pendingCount = 0;
  let otherCount = 0;

  const completedOrderIds = new Set();
  const allOrderIds = new Set();
  const completedOrderNetMap = new Map(); // order_id -> net_sales

  rows.forEach(r => {
    const fin = calculateRowFinancials(r, mapping);
    const status = fin.normalized_status;
    const gross = fin.gross_amount;
    const discount = fin.discount_amount;
    const net = fin.net_amount;

    grossTransactionValue += gross;
    totalDiscountsAll += discount;

    const rawOrderId = mapping.order_id && r[mapping.order_id] ? String(r[mapping.order_id]).trim() : null;
    if (rawOrderId) allOrderIds.add(rawOrderId);

    if (status === 'completed') {
      completedTransactionsCount++;
      completedGrossSales += gross;
      completedDiscountAmount += discount;
      if (rawOrderId) {
        completedOrderIds.add(rawOrderId);
        completedOrderNetMap.set(rawOrderId, (completedOrderNetMap.get(rawOrderId) || 0) + net);
      }
    } else if (status === 'returned') {
      returnedCount++;
      returnedGrossValue += gross;
    } else if (status === 'cancelled') {
      cancelledCount++;
      cancelledGrossValue += gross;
    } else if (status === 'pending') {
      pendingCount++;
    } else {
      otherCount++;
    }
  });

  const completedNetSales = Math.max(0.0, completedGrossSales - completedDiscountAmount);

  // Return rate: returned / (completed + returned)
  // Cancellation never fulfilled, so return rate is calculated over fulfilled/attempted orders
  const fulfilledCount = completedTransactionsCount + returnedCount;
  const returnRate = fulfilledCount > 0
    ? parseFloat(((returnedCount / fulfilledCount) * 100).toFixed(4))
    : 0.0;

  // Order count & AOV logic
  let uniqueOrdersCount = null;
  let averageOrderValue = null;
  let averageTransactionValue = null;

  if (completedTransactionsCount > 0) {
    averageTransactionValue = parseFloat((completedNetSales / completedTransactionsCount).toFixed(2));
  } else {
    averageTransactionValue = 0.0;
  }

  if (hasOrderId && completedOrderIds.size > 0) {
    uniqueOrdersCount = completedOrderIds.size;
    averageOrderValue = parseFloat((completedNetSales / uniqueOrdersCount).toFixed(2));
  } else if (hasOrderId && allOrderIds.size > 0) {
    uniqueOrdersCount = 0;
    averageOrderValue = 0.0;
  }

  return {
    total_records: rows.length,
    has_order_id: hasOrderId && allOrderIds.size > 0,
    has_price: hasPrice,
    has_status: hasStatus,
    has_discount: hasDiscount,

    // Counts
    completed_transactions: completedTransactionsCount,
    unique_completed_orders: uniqueOrdersCount,
    returned_count: returnedCount,
    cancelled_count: cancelledCount,
    pending_count: pendingCount,
    other_status_count: otherCount,

    // Financial Metrics
    gross_transaction_value: parseFloat(grossTransactionValue.toFixed(2)),
    completed_gross_sales: parseFloat(completedGrossSales.toFixed(2)),
    completed_discount_amount: parseFloat(completedDiscountAmount.toFixed(2)),
    completed_net_sales: parseFloat(completedNetSales.toFixed(2)),
    total_discounts_all: parseFloat(totalDiscountsAll.toFixed(2)),
    returned_gross_value: parseFloat(returnedGrossValue.toFixed(2)),
    cancelled_gross_value: parseFloat(cancelledGrossValue.toFixed(2)),

    // Rates & Averages
    return_rate: returnRate,
    average_order_value: averageOrderValue,
    average_transaction_value: averageTransactionValue,
  };
}

/**
 * Computes Monthly Trends with dual metrics:
 * 1. Completed Net Sales (₹)
 * 2. Completed Order Count (if Order ID available) OR Completed Transaction Count
 */
function computeMonthlyTrends(rows, mapping = {}) {
  if (!mapping.order_date) return [];

  const hasOrderId = !!mapping.order_id;
  const monthMap = new Map(); // monthStr -> { revenue, transactions, orderIds: Set }

  rows.forEach(r => {
    const fin = calculateRowFinancials(r, mapping);
    if (fin.normalized_status !== 'completed') return; // Completed transactions ONLY

    const dateVal = mapping.order_date ? r[mapping.order_date] : null;
    const normalizedDate = normalizeDateStr(dateVal);
    if (!normalizedDate) return;

    const monthKey = normalizedDate.substring(0, 7); // YYYY-MM
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, { revenue: 0.0, transactions: 0, orderIds: new Set() });
    }

    const mObj = monthMap.get(monthKey);
    mObj.revenue += fin.net_amount;
    mObj.transactions += 1;

    const rawOrderId = hasOrderId && r[mapping.order_id] ? String(r[mapping.order_id]).trim() : null;
    if (rawOrderId) mObj.orderIds.add(rawOrderId);
  });

  const sortedMonths = Array.from(monthMap.keys()).sort();

  return sortedMonths.map(m => {
    const entry = monthMap.get(m);
    const count = hasOrderId && entry.orderIds.size > 0 ? entry.orderIds.size : entry.transactions;
    return {
      month: m,
      revenue: parseFloat(entry.revenue.toFixed(2)),
      count,
      count_type: hasOrderId && entry.orderIds.size > 0 ? 'orders' : 'transactions',
    };
  });
}

/**
 * Computes Customer Metrics & Segmentation strictly based on completed net sales
 * Supports customizable reference date for historical datasets (e.g. 2025 datasets)
 */
function computeCustomerMetrics(rows, mapping = {}, referenceDateInput = null) {
  const custIdCol = mapping.customer_id;
  const custNameCol = mapping.customer_name;
  if (!custIdCol && !custNameCol) return { customers: [], referenceDate: null, dateType: 'none' };

  const hasDate = !!mapping.order_date;
  const hasPrice = !!mapping.price;
  const hasOrderId = !!mapping.order_id;

  // Determine latest dataset date
  let maxDatasetDate = null;
  if (hasDate) {
    rows.forEach(r => {
      const d = normalizeDateStr(r[mapping.order_date]);
      if (d) {
        if (!maxDatasetDate || d > maxDatasetDate) maxDatasetDate = d;
      }
    });
  }

  // Resolve analysis reference date:
  // Default: Latest dataset transaction date (prevents historical datasets from being marked 100% inactive)
  let resolvedReferenceDate = null;
  let dateType = 'latest';

  if (referenceDateInput) {
    if (referenceDateInput === 'current' || referenceDateInput === 'today') {
      const today = new Date();
      resolvedReferenceDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      dateType = 'current';
    } else {
      const parsed = normalizeDateStr(referenceDateInput);
      if (parsed) {
        resolvedReferenceDate = parsed;
        dateType = 'custom';
      }
    }
  }

  if (!resolvedReferenceDate) {
    resolvedReferenceDate = maxDatasetDate || '2026-01-01';
    dateType = 'latest';
  }

  const refTime = new Date(`${resolvedReferenceDate}T00:00:00Z`).getTime();

  // Aggregate per customer
  // Grouping preference: customer_id when present, else customer_name
  const customerMap = new Map();

  rows.forEach(r => {
    const custId = custIdCol && r[custIdCol] !== undefined && r[custIdCol] !== null && String(r[custIdCol]).trim() !== ''
      ? String(r[custIdCol]).trim()
      : null;
    const custName = custNameCol && r[custNameCol] !== undefined && r[custNameCol] !== null && String(r[custNameCol]).trim() !== ''
      ? String(r[custNameCol]).trim()
      : null;

    if (!custId && !custName) return;

    const groupKey = custId ? `id:${custId}` : `name:${custName}`;
    if (!customerMap.has(groupKey)) {
      customerMap.set(groupKey, {
        customer_id: custId,
        customer_name: custName || custId,
        completed_orders: 0,
        completed_net_spent: 0.0,
        last_order_date: null,
        orderIds: new Set(),
      });
    }

    const c = customerMap.get(groupKey);
    if (!c.customer_name && custName) c.customer_name = custName;

    const fin = calculateRowFinancials(r, mapping);
    const d = normalizeDateStr(r[mapping.order_date]);
    if (d) {
      if (!c.last_order_date || d > c.last_order_date) {
        c.last_order_date = d;
      }
    }

    if (fin.normalized_status === 'completed') {
      const orderId = hasOrderId && r[mapping.order_id] ? String(r[mapping.order_id]).trim() : null;
      if (orderId) {
        c.orderIds.add(orderId);
      } else {
        c.completed_orders += 1;
      }
      c.completed_net_spent += fin.net_amount;
    }
  });

  const customerList = Array.from(customerMap.values()).map(c => {
    const finalOrders = hasOrderId && c.orderIds.size > 0 ? c.orderIds.size : c.completed_orders;
    let recencyDays = null;
    if (c.last_order_date) {
      const orderTime = new Date(`${c.last_order_date}T00:00:00Z`).getTime();
      const diffMs = refTime - orderTime;
      recencyDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }
    return {
      customer_id: c.customer_id,
      customer_name: c.customer_name,
      total_orders: finalOrders,
      total_spent: parseFloat(c.completed_net_spent.toFixed(2)),
      last_order_date: c.last_order_date,
      days_since_last_order: recencyDays,
    };
  });

  // Calculate spending thresholds
  const completedCustomers = customerList.filter(c => c.total_orders > 0);
  const totalSpendSum = completedCustomers.reduce((acc, c) => acc + c.total_spent, 0);
  const avgSpend = completedCustomers.length > 0 ? totalSpendSum / completedCustomers.length : 0;
  const highSpendThreshold = Math.max(avgSpend * 1.4, 100);

  // Assign segments to all customers
  customerList.forEach(c => {
    const orders = c.total_orders;
    const spent = c.total_spent;
    const recency = c.days_since_last_order;

    let segment = 'Occasional';
    let justification = '';

    if (orders === 0) {
      segment = 'Inactive';
      justification = '0 completed purchases (transactions returned or cancelled)';
    } else if (hasPrice && spent >= highSpendThreshold && orders >= 3) {
      segment = 'High-Value';
      justification = `Top-tier completed net spend of ₹${spent.toLocaleString('en-IN', { maximumFractionDigits: 0 })} across ${orders} orders`;
    } else if (orders >= 3 && (recency === null || recency <= 120)) {
      segment = 'Frequent';
      justification = `${orders} repeat orders placed within ${recency !== null ? recency : 0} days of reference date`;
    } else if (recency !== null && recency > 180 && orders >= 1) {
      segment = 'Inactive';
      justification = `No completed purchase for ${recency} days prior to reference date (${resolvedReferenceDate})`;
    } else {
      segment = 'Occasional';
      justification = `${orders} completed order(s) totaling ₹${spent.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    }

    const rankScore = (spent * 0.6) + (orders * 500) + (recency !== null ? Math.max(0, 365 - recency) * 10 : 0);
    c.segment = segment;
    c.justification = justification;
    c.rank_score = rankScore;
  });

  customerList.sort((a, b) => b.rank_score - a.rank_score);
  customerList.forEach((c, idx) => { c.rank = idx + 1; });

  return {
    customers: customerList,
    referenceDate: resolvedReferenceDate,
    maxDatasetDate,
    dateType,
    totalCount: customerList.length,
  };
}

/**
 * Dimension Breakdowns based strictly on Completed transactions
 */
function computeCategoryPerformance(rows, mapping = {}) {
  const catCol = mapping.category;
  if (!catCol) return [];

  const map = new Map();
  rows.forEach(r => {
    const fin = calculateRowFinancials(r, mapping);
    if (fin.normalized_status !== 'completed') return;

    const cat = r[catCol] !== undefined && r[catCol] !== null ? String(r[catCol]).trim() : '';
    if (!cat) return;

    if (!map.has(cat)) {
      map.set(cat, { category: cat, orders: 0, revenue: 0.0 });
    }
    const entry = map.get(cat);
    entry.orders += 1;
    entry.revenue += fin.net_amount;
  });

  const list = Array.from(map.values()).map(e => ({
    category: e.category,
    orders: e.orders,
    revenue: parseFloat(e.revenue.toFixed(2)),
  }));

  list.sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
  return list.slice(0, 10);
}

function computeTopProducts(rows, mapping = {}) {
  const prodCol = mapping.product;
  const prodIdCol = mapping.product_id;
  const catCol = mapping.category;
  if (!prodCol && !prodIdCol) return [];

  const map = new Map();
  rows.forEach(r => {
    const fin = calculateRowFinancials(r, mapping);
    if (fin.normalized_status !== 'completed') return;

    const prodName = prodCol && r[prodCol] !== undefined && r[prodCol] !== null ? String(r[prodCol]).trim() : '';
    const prodId = prodIdCol && r[prodIdCol] !== undefined && r[prodIdCol] !== null ? String(r[prodIdCol]).trim() : '';

    if (!prodName && !prodId) return;

    const displayProduct = prodName || `Product #${prodId}`;
    const key = prodId ? `id:${prodId}` : `name:${prodName}`;
    const category = catCol && r[catCol] ? String(r[catCol]).trim() : '—';

    if (!map.has(key)) {
      map.set(key, {
        product: displayProduct,
        product_id: prodId || null,
        category,
        orders: 0,
        revenue: 0.0,
      });
    }

    const entry = map.get(key);
    entry.orders += 1;
    entry.revenue += fin.net_amount;
    if (entry.category === '—' && category !== '—') entry.category = category;
  });

  const list = Array.from(map.values()).map(e => ({
    product: e.product,
    product_id: e.product_id,
    category: e.category,
    orders: e.orders,
    revenue: parseFloat(e.revenue.toFixed(2)),
  }));

  list.sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
  return list.slice(0, 5);
}

function computeLocationBreakdown(rows, mapping = {}) {
  const locCol = mapping.location;
  if (!locCol) return [];

  const map = new Map();
  rows.forEach(r => {
    const fin = calculateRowFinancials(r, mapping);
    if (fin.normalized_status !== 'completed') return;

    const loc = r[locCol] !== undefined && r[locCol] !== null ? String(r[locCol]).trim() : '';
    if (!loc) return;

    if (!map.has(loc)) {
      map.set(loc, { location: loc, orders: 0, revenue: 0.0 });
    }
    const entry = map.get(loc);
    entry.orders += 1;
    entry.revenue += fin.net_amount;
  });

  const list = Array.from(map.values()).map(e => ({
    location: e.location,
    orders: e.orders,
    revenue: parseFloat(e.revenue.toFixed(2)),
  }));

  list.sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
  return list.slice(0, 8);
}

function computePaymentBreakdown(rows, mapping = {}) {
  const payCol = mapping.payment_type;
  if (!payCol) return [];

  const map = new Map();
  rows.forEach(r => {
    const fin = calculateRowFinancials(r, mapping);
    if (fin.normalized_status !== 'completed') return;

    const pay = r[payCol] !== undefined && r[payCol] !== null ? String(r[payCol]).trim() : '';
    if (!pay) return;

    if (!map.has(pay)) {
      map.set(pay, { payment_type: pay, count: 0, revenue: 0.0 });
    }
    const entry = map.get(pay);
    entry.count += 1;
    entry.revenue += fin.net_amount;
  });

  const list = Array.from(map.values()).map(e => ({
    payment_type: e.payment_type,
    count: e.count,
    revenue: parseFloat(e.revenue.toFixed(2)),
  }));

  list.sort((a, b) => b.revenue - a.revenue || b.count - a.count);
  return list;
}

module.exports = {
  normalizeStatus,
  parseStrictNumber,
  normalizeDateStr,
  calculateRowFinancials,
  auditDatasetQuality,
  computeSummaryKPIs,
  computeMonthlyTrends,
  computeCustomerMetrics,
  computeCategoryPerformance,
  computeTopProducts,
  computeLocationBreakdown,
  computePaymentBreakdown,
};
