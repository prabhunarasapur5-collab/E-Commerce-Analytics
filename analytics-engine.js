// ============================================================
// analytics-engine.js
// Centralized Business Logic & Accuracy Engine for EcomAnalytics
// Stage 1 & Stage 1.1 Complete Implementation
// ============================================================

/**
 * Robust RFC 4180 compliant CSV Parser
 * Handles:
 * - UTF-8 BOM (\uFEFF)
 * - Multiline quoted fields (\r\n or \n inside quotes)
 * - Escaped quotation marks ("" inside quotes)
 * - Validates column count per row against header length
 */
function parseCSV(text) {
  if (text === undefined || text === null || typeof text !== 'string') {
    throw new Error('CSV input must be a non-empty string.');
  }

  // Strip UTF-8 BOM if present
  const cleanText = text.replace(/^\uFEFF/, '');
  if (cleanText.trim().length === 0) {
    throw new Error('CSV text is empty.');
  }

  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;
  const len = cleanText.length;

  while (i < len) {
    const ch = cleanText[i];
    const nextCh = i + 1 < len ? cleanText[i + 1] : '';

    if (inQuotes) {
      if (ch === '"') {
        if (nextCh === '"') {
          // Escaped double-quote: "" -> "
          currentField += '"';
          i += 2;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
        }
      } else {
        // Character inside quotes (including newlines and commas)
        currentField += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        // Opening quote
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        // Field delimiter
        currentRow.push(currentField.trim());
        currentField = '';
        i++;
      } else if (ch === '\r') {
        if (nextCh === '\n') {
          i++; // Skip \r in \r\n
        }
        i++;
        currentRow.push(currentField.trim());
        currentField = '';
        if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0] === '')) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else if (ch === '\n') {
        i++;
        currentRow.push(currentField.trim());
        currentField = '';
        if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0] === '')) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else {
        currentField += ch;
        i++;
      }
    }
  }

  // Final field/row if any
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0] === '')) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) {
    throw new Error('CSV file must have a header row and at least one data row.');
  }

  // Filter out any pure comment rows
  const validRows = rows.filter(r => r.length > 0 && !(r.length === 1 && r[0].startsWith('#')));
  if (validRows.length < 2) {
    throw new Error('CSV file must have a header row and at least one data row.');
  }

  const rawHeaders = validRows[0].map(h => h.trim());
  const headerCount = rawHeaders.length;
  const parsedRows = [];
  const columnCountMismatches = [];

  for (let rIdx = 1; rIdx < validRows.length; rIdx++) {
    const rowVals = validRows[rIdx];
    if (rowVals.length === 1 && rowVals[0] === '') continue; // Skip blank line

    if (rowVals.length !== headerCount) {
      columnCountMismatches.push({
        rowNumber: rIdx + 1,
        expected: headerCount,
        actual: rowVals.length,
      });
    }

    const rowObj = {};
    rawHeaders.forEach((h, cIdx) => {
      rowObj[h] = cIdx < rowVals.length ? rowVals[cIdx] : '';
    });
    parsedRows.push(rowObj);
  }

  return {
    headers: rawHeaders,
    rows: parsedRows,
    columnCountMismatches,
  };
}

/**
 * Validates actual calendar dates, not merely regex patterns.
 * Correctly rejects impossible calendar dates such as 2025-02-30 or 2025-04-31.
 */
function isValidCalendarDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;

  // Days in given month for year (using UTC to prevent timezone skew)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

/**
 * Normalizes and strictly validates calendar date strings.
 * Returns ISO YYYY-MM-DD or null if invalid calendar date.
 */
function normalizeDateStr(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = val.getMonth() + 1;
    const d = val.getDate();
    if (!isValidCalendarDate(y, m, d)) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const str = String(val).trim();
  if (!str) return null;

  // 1. ISO format: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = str.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (isValidCalendarDate(y, m, d)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null; // Invalid calendar date (e.g. 2025-02-30)
  }

  // 2. Day-Month-Year format: DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10);
    const y = parseInt(dmyMatch[3], 10);
    if (isValidCalendarDate(y, m, d)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
  }

  // 3. Fallback date parse
  const dt = new Date(str);
  if (!isNaN(dt.getTime())) {
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    if (isValidCalendarDate(y, m, d)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Normalizes transaction status strings into standard categories:
 * - 'completed'
 * - 'returned'
 * - 'cancelled'
 * - 'pending'
 * - 'other'
 *
 * If raw status is missing and statusHandling is explicitly 'assume_completed',
 * returns 'completed'. Otherwise returns 'other'.
 */
function normalizeStatus(rawStatus, statusHandling = 'treat_as_unverified') {
  if (rawStatus === undefined || rawStatus === null || String(rawStatus).trim() === '') {
    return statusHandling === 'assume_completed' ? 'completed' : 'other';
  }

  const s = String(rawStatus).trim().toLowerCase();

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
    s === 'exchanged' ||
    s === 'chargeback'
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
    s === 'hold' ||
    s === 'awaiting payment' ||
    s === 'awaiting_payment'
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
 * Calculates line-level financials:
 * - gross_amount
 * - discount_amount
 * - net_amount
 * - normalized_status
 *
 * Implements strict calculation safety:
 * - Does NOT silently convert negative prices or quantities into zero.
 * - Does NOT silently cap discount percentages above 100%.
 * - Explicitly tracks assumed quantity when quantity column is missing.
 * - Flags invalid records (negative values, excessive discount > 100%) so they cannot silently corrupt KPIs.
 */
function calculateRowFinancials(row, mapping = {}) {
  const getCol = (key) => {
    const colName = mapping[key];
    if (!colName || row[colName] === undefined || row[colName] === null) return null;
    return row[colName];
  };

  const priceType = mapping.price_type || 'unit_price'; // 'unit_price' | 'line_total'
  const discountType = mapping.discount_type || 'percentage'; // 'percentage' | 'fixed_total' | 'fixed_unit'
  const statusHandling = mapping.status_handling || 'treat_as_unverified'; // 'assume_completed' | 'treat_as_unverified'

  const rawPrice = getCol('price');
  const rawQty = getCol('quantity');
  const rawDisc = getCol('discount');
  const rawStatus = getCol('status');
  const rawDate = getCol('order_date');

  const priceNum = parseStrictNumber(rawPrice);
  const qtyNum = parseStrictNumber(rawQty);
  const discNum = parseStrictNumber(rawDisc);

  const validationErrors = [];
  let isValid = true;
  let assumedQuantity = false;

  // Validate price
  let unitPrice = null;
  if (rawPrice !== null && String(rawPrice).trim() !== '') {
    if (priceNum === null) {
      isValid = false;
      validationErrors.push(`Non-numeric price value: "${rawPrice}"`);
    } else if (priceNum < 0) {
      isValid = false;
      validationErrors.push(`Negative price not allowed: ${priceNum}`);
    } else {
      unitPrice = priceNum;
    }
  }

  // Validate quantity
  let quantity = null;
  if (rawQty !== null && String(rawQty).trim() !== '') {
    if (qtyNum === null) {
      isValid = false;
      validationErrors.push(`Non-numeric quantity value: "${rawQty}"`);
    } else if (qtyNum < 0) {
      isValid = false;
      validationErrors.push(`Negative quantity not allowed: ${qtyNum}`);
    } else if (qtyNum === 0) {
      isValid = false;
      validationErrors.push(`Zero quantity row`);
    } else {
      quantity = qtyNum;
    }
  } else if (unitPrice !== null) {
    // Quantity missing but price exists: explicit visible assumption
    quantity = 1;
    assumedQuantity = true;
  }

  // Calculate gross
  let gross = 0.0;
  if (unitPrice !== null && quantity !== null && isValid) {
    if (priceType === 'line_total') {
      gross = unitPrice;
    } else {
      gross = unitPrice * quantity;
    }
  }

  // Validate & calculate discount
  let discountAmount = 0.0;
  if (rawDisc !== null && String(rawDisc).trim() !== '') {
    if (discNum === null) {
      isValid = false;
      validationErrors.push(`Non-numeric discount value: "${rawDisc}"`);
    } else if (discNum < 0) {
      isValid = false;
      validationErrors.push(`Negative discount value: ${discNum}`);
    } else if (discountType === 'percentage') {
      // Do NOT silently cap percentages above 100%!
      if (discNum > 100) {
        isValid = false;
        validationErrors.push(`Discount percentage exceeds 100%: ${discNum}%`);
      } else if (isValid) {
        discountAmount = gross * (discNum / 100.0);
      }
    } else if (discountType === 'fixed_unit') {
      if (isValid) {
        discountAmount = Math.min(gross, discNum * (quantity !== null ? quantity : 1));
      }
    } else {
      // fixed_total
      if (isValid) {
        discountAmount = Math.min(gross, discNum);
      }
    }
  }

  // Validate calendar date
  let validDate = null;
  if (rawDate !== null && String(rawDate).trim() !== '') {
    validDate = normalizeDateStr(rawDate);
    if (!validDate) {
      validationErrors.push(`Invalid calendar date: "${rawDate}"`);
    }
  }

  // Net calculation
  const net = isValid ? Math.max(0.0, gross - discountAmount) : 0.0;

  // Normalized status
  const normalizedStatus = normalizeStatus(rawStatus, !mapping.status ? statusHandling : 'treat_as_unverified');
  const hasAssumedStatus = !mapping.status && statusHandling === 'assume_completed';

  return {
    unit_price: unitPrice,
    quantity,
    gross_amount: Math.round(gross * 100) / 100,
    discount_amount: Math.round(discountAmount * 100) / 100,
    net_amount: Math.round(net * 100) / 100,
    normalized_status: normalizedStatus,
    raw_status: rawStatus !== null && rawStatus !== undefined ? String(rawStatus).trim() : null,
    is_valid: isValid,
    validation_errors: validationErrors,
    assumed_quantity: assumedQuantity,
    assumed_status: hasAssumedStatus,
    normalized_date: validDate,
  };
}

/**
 * Audits uploaded rows and generates data quality warnings
 */
function auditDatasetQuality(rows, mapping = {}) {
  const warnings = [];
  const rowErrors = [];

  let invalidPrices = 0;
  let negativePrices = 0;
  let invalidQuantities = 0;
  let negativeQuantities = 0;
  let assumedQuantities = 0;
  let decimalQuantities = 0;
  let invalidDates = 0;
  let excessiveDiscounts = 0;
  let negativeDiscounts = 0;
  let unknownStatusCount = 0;
  let missingStatusCount = 0;
  let potentialDuplicateRows = 0;
  let missingOrderIdCount = 0;

  const unknownStatusesSet = new Set();
  const seenOrderCustomerProduct = new Set();

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
    const rowNum = idx + 1;
    const fin = calculateRowFinancials(r, mapping);

    if (!fin.is_valid) {
      rowErrors.push({ row: rowNum, errors: fin.validation_errors });
    }

    if (priceCol && r[priceCol] !== undefined && r[priceCol] !== null && String(r[priceCol]).trim() !== '') {
      const p = parseStrictNumber(r[priceCol]);
      if (p === null) invalidPrices++;
      else if (p < 0) negativePrices++;
    }

    if (qtyCol && r[qtyCol] !== undefined && r[qtyCol] !== null && String(r[qtyCol]).trim() !== '') {
      const q = parseStrictNumber(r[qtyCol]);
      if (q === null) invalidQuantities++;
      else if (q < 0) negativeQuantities++;
      else if (q % 1 !== 0) decimalQuantities++;
    } else if (priceCol && r[priceCol]) {
      assumedQuantities++;
    }

    if (discCol && r[discCol] !== undefined && r[discCol] !== null && String(r[discCol]).trim() !== '') {
      const d = parseStrictNumber(r[discCol]);
      if (d !== null) {
        if (discountType === 'percentage' && d > 100) excessiveDiscounts++;
        else if (d < 0) negativeDiscounts++;
      }
    }

    if (dateCol && r[dateCol] !== undefined && r[dateCol] !== null && String(r[dateCol]).trim() !== '') {
      const d = normalizeDateStr(r[dateCol]);
      if (!d) invalidDates++;
    }

    if (!statusCol) {
      missingStatusCount++;
    } else if (r[statusCol] !== undefined && r[statusCol] !== null && String(r[statusCol]).trim() !== '') {
      const norm = normalizeStatus(r[statusCol]);
      if (norm === 'other') {
        unknownStatusCount++;
        unknownStatusesSet.add(String(r[statusCol]).trim());
      }
    } else {
      unknownStatusCount++;
    }

    if (orderIdCol) {
      const oid = r[orderIdCol];
      if (oid === undefined || oid === null || String(oid).trim() === '') {
        missingOrderIdCount++;
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
  if (negativePrices > 0) warnings.push(`${negativePrices} row(s) contain negative price values. These cannot enter financial KPIs.`);
  if (invalidQuantities > 0) warnings.push(`${invalidQuantities} row(s) contain invalid non-numeric quantity values.`);
  if (negativeQuantities > 0) warnings.push(`${negativeQuantities} row(s) contain negative quantity values.`);
  if (assumedQuantities > 0 && !qtyCol) warnings.push(`No quantity column mapped: assumed 1 unit per transaction line across ${assumedQuantities} row(s).`);
  if (decimalQuantities > 0) warnings.push(`${decimalQuantities} row(s) have decimal quantities (e.g. fractional units or weight).`);
  if (excessiveDiscounts > 0) warnings.push(`${excessiveDiscounts} row(s) have discount percentage exceeding 100%. These rows are rejected from financial calculations.`);
  if (negativeDiscounts > 0) warnings.push(`${negativeDiscounts} row(s) contain negative discount values.`);
  if (invalidDates > 0) warnings.push(`${invalidDates} row(s) contain invalid calendar dates (e.g. Feb 30 or unparseable date strings).`);

  if (!statusCol) {
    const handling = mapping.status_handling || 'treat_as_unverified';
    if (handling === 'assume_completed') {
      warnings.push(`Status column not mapped: User selected 'Assume Completed' (all ${rows.length} rows counted as completed sales).`);
    } else {
      warnings.push(`Status column not mapped: All ${rows.length} rows treated as Unverified / Pending (excluded from completed sales until confirmed).`);
    }
  } else if (unknownStatusCount > 0) {
    const list = Array.from(unknownStatusesSet).slice(0, 5).join(', ');
    warnings.push(`${unknownStatusCount} row(s) have unrecognized statuses (${list || 'blank'}). These are treated as 'Other' and excluded from completed sales.`);
  }

  if (orderIdCol && missingOrderIdCount > 0) {
    warnings.push(`${missingOrderIdCount} row(s) are missing Order IDs. Order-level AOV will not mix these unassigned rows; ATV will be displayed.`);
  }

  if (potentialDuplicateRows > 0) {
    warnings.push(`Detected ${potentialDuplicateRows} potential duplicate transaction rows sharing the same ID, item, and date.`);
  }

  return {
    warnings,
    rowErrors,
    canProceed: rowErrors.length === 0,
    stats: {
      invalidPrices,
      negativePrices,
      invalidQuantities,
      negativeQuantities,
      negativeValues: negativePrices + negativeQuantities + negativeDiscounts,
      assumedQuantities,
      decimalQuantities,
      excessiveDiscounts,
      negativeDiscounts,
      invalidDates,
      unknownStatusCount,
      missingStatusCount,
      missingOrderIdCount,
      unknownStatuses: Array.from(unknownStatusesSet),
      potentialDuplicateRows,
      invalidRecordsCount: rowErrors.length,
    },
  };
}

/**
 * Computes Executive Summary KPI Metrics strictly from rows
 * Accurately implements:
 * - Gross Transaction Value vs Completed Gross Sales
 * - True monetary discounts
 * - Completed Net Sales
 * - Separate returns & cancellations
 * - True Order AOV (when fully identified) vs ATV fallback
 * - Order Return Rate vs Transaction Return Rate
 * - Partial Order ID handling (never silently inflates AOV)
 */
function computeSummaryKPIs(rows, mapping = {}) {
  const hasPrice = !!mapping.price;
  const hasStatus = !!mapping.status;
  const hasOrderId = !!mapping.order_id;

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
  let invalidRecordsCount = 0;

  let completedWithOrderIdCount = 0;
  let completedMissingOrderIdCount = 0;
  let totalMissingOrderIdCount = 0;

  const verifiedCompletedOrderIds = new Set();
  const verifiedReturnedOrderIds = new Set();
  const allVerifiedOrderIds = new Set();
  const verifiedOrderNetMap = new Map(); // order_id -> net_sales

  rows.forEach(r => {
    const fin = calculateRowFinancials(r, mapping);
    if (!fin.is_valid) {
      invalidRecordsCount++;
      return; // Do not silently inject invalid financial records into sales
    }

    const status = fin.normalized_status;
    const gross = fin.gross_amount;
    const discount = fin.discount_amount;
    const net = fin.net_amount;

    grossTransactionValue += gross;
    totalDiscountsAll += discount;

    const rawOrderId = hasOrderId && r[mapping.order_id] ? String(r[mapping.order_id]).trim() : null;
    if (hasOrderId) {
      if (rawOrderId) {
        allVerifiedOrderIds.add(rawOrderId);
      } else {
        totalMissingOrderIdCount++;
      }
    }

    if (status === 'completed') {
      completedTransactionsCount++;
      completedGrossSales += gross;
      completedDiscountAmount += discount;

      if (hasOrderId) {
        if (rawOrderId) {
          completedWithOrderIdCount++;
          verifiedCompletedOrderIds.add(rawOrderId);
          verifiedOrderNetMap.set(rawOrderId, (verifiedOrderNetMap.get(rawOrderId) || 0.0) + net);
        } else {
          completedMissingOrderIdCount++;
        }
      }
    } else if (status === 'returned') {
      returnedCount++;
      returnedGrossValue += gross;
      if (hasOrderId && rawOrderId) {
        verifiedReturnedOrderIds.add(rawOrderId);
      }
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

  // Partial Order ID Logic (Requirement 2)
  const hasPartialOrderIds = hasOrderId && completedMissingOrderIdCount > 0;
  const verifiedOrderCount = verifiedCompletedOrderIds.size;

  let averageOrderValue = null;
  let averageTransactionValue = completedTransactionsCount > 0
    ? parseFloat((completedNetSales / completedTransactionsCount).toFixed(2))
    : 0.0;

  let orderMetricType = 'transactions';
  let verifiedOrderAov = null;

  if (hasOrderId && !hasPartialOrderIds && verifiedOrderCount > 0) {
    // 100% verified order IDs for completed transactions
    averageOrderValue = parseFloat((completedNetSales / verifiedOrderCount).toFixed(2));
    orderMetricType = 'verified_orders';
  } else if (hasOrderId && hasPartialOrderIds) {
    // Partially missing Order IDs: Never mix incomplete orders with verified AOV!
    orderMetricType = 'partial_orders';
    let verifiedOrderNetSum = 0.0;
    verifiedOrderNetMap.forEach(v => { verifiedOrderNetSum += v; });
    verifiedOrderAov = verifiedOrderCount > 0 ? parseFloat((verifiedOrderNetSum / verifiedOrderCount).toFixed(2)) : null;
  }

  // Return Rate Calculation (Requirement 3)
  let returnRate = null;
  let returnRateType = 'transaction';

  if (hasOrderId && !hasPartialOrderIds && (verifiedOrderCount + verifiedReturnedOrderIds.size) > 0) {
    // Order-level Return Rate
    const totalFulfilledOrders = verifiedOrderCount + verifiedReturnedOrderIds.size;
    returnRate = parseFloat(((verifiedReturnedOrderIds.size / totalFulfilledOrders) * 100).toFixed(4));
    returnRateType = 'order';
  } else {
    // Transaction Return Rate
    const fulfilledTransactions = completedTransactionsCount + returnedCount;
    if (fulfilledTransactions > 0) {
      returnRate = parseFloat(((returnedCount / fulfilledTransactions) * 100).toFixed(4));
    }
    returnRateType = 'transaction';
  }

  return {
    total_records: rows.length,
    valid_records: rows.length - invalidRecordsCount,
    invalid_records_count: invalidRecordsCount,

    // Status Counts (with backward-compatible aliases)
    completed_transactions: completedTransactionsCount,
    returned_transactions: returnedCount,
    returned_count: returnedCount,
    cancelled_transactions: cancelledCount,
    cancelled_count: cancelledCount,
    pending_transactions: pendingCount,
    pending_count: pendingCount,
    other_transactions: otherCount,
    other_count: otherCount,
    unclassified_transactions: !hasStatus ? rows.length : otherCount,

    // Order Counts & Partial Order Tracking
    has_order_id: hasOrderId,
    has_partial_order_ids: hasPartialOrderIds,
    order_metric_type: orderMetricType,
    unique_completed_orders: hasOrderId ? verifiedOrderCount : null,
    completed_with_order_id: completedWithOrderIdCount,
    completed_missing_order_id: completedMissingOrderIdCount,
    total_missing_order_id: totalMissingOrderIdCount,

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
    return_rate_type: returnRateType,
    average_order_value: averageOrderValue,
    verified_order_aov: verifiedOrderAov,
    average_transaction_value: averageTransactionValue,
  };
}

/**
 * Computes Monthly Trends with dual metrics:
 * 1. Completed Net Sales (₹)
 * 2. Completed Order Count (if Order ID available) OR Completed Transaction Count
 * Handles partial Order IDs consistently
 */
function computeMonthlyTrends(rows, mapping = {}) {
  if (!mapping.order_date) return [];

  const hasOrderId = !!mapping.order_id;
  const monthMap = new Map();

  rows.forEach(r => {
    const fin = calculateRowFinancials(r, mapping);
    if (!fin.is_valid || fin.normalized_status !== 'completed') return;

    const normalizedDate = fin.normalized_date || normalizeDateStr(r[mapping.order_date]);
    if (!normalizedDate) return;

    const monthKey = normalizedDate.substring(0, 7); // YYYY-MM
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, {
        revenue: 0.0,
        transactions: 0,
        verifiedOrders: new Set(),
        missingOrderRows: 0,
      });
    }

    const mObj = monthMap.get(monthKey);
    mObj.revenue += fin.net_amount;
    mObj.transactions += 1;

    const rawOrderId = hasOrderId && r[mapping.order_id] ? String(r[mapping.order_id]).trim() : null;
    if (hasOrderId) {
      if (rawOrderId) {
        mObj.verifiedOrders.add(rawOrderId);
      } else {
        mObj.missingOrderRows += 1;
      }
    }
  });

  const sortedMonths = Array.from(monthMap.keys()).sort();

  return sortedMonths.map(m => {
    const entry = monthMap.get(m);
    let count = entry.transactions;
    let countType = 'transactions';

    if (hasOrderId) {
      if (entry.missingOrderRows === 0 && entry.verifiedOrders.size > 0) {
        count = entry.verifiedOrders.size;
        countType = 'orders';
      } else if (entry.verifiedOrders.size > 0 && entry.missingOrderRows > 0) {
        count = entry.verifiedOrders.size + entry.missingOrderRows;
        countType = 'orders_plus_unassigned';
      }
    }

    return {
      month: m,
      revenue: parseFloat(entry.revenue.toFixed(2)),
      count,
      count_type: countType,
      verified_orders: entry.verifiedOrders.size,
      unassigned_transactions: entry.missingOrderRows,
    };
  });
}

/**
 * Computes Customer Metrics & Segmentation strictly based on completed net sales
 *
 * Requirements 1 & 2 fixes:
 * - Only completed purchases determine customer last_order_date and total_orders.
 * - Returned, cancelled, pending, and unknown transactions do NOT reset recency.
 * - Latest dataset reference date is based on valid completed transaction dates.
 * - Handles customers with partial Order IDs without discarding unassigned rows.
 */
function computeCustomerMetrics(rows, mapping = {}, referenceDateInput = null) {
  const custIdCol = mapping.customer_id;
  const custNameCol = mapping.customer_name;
  if (!custIdCol && !custNameCol) return { customers: [], referenceDate: null, dateType: 'none' };

  const hasDate = !!mapping.order_date;
  const hasOrderId = !!mapping.order_id;

  // Determine latest dataset date strictly based on completed purchases with valid dates
  let maxCompletedDatasetDate = null;
  let maxAnyDatasetDate = null;

  if (hasDate) {
    rows.forEach(r => {
      const fin = calculateRowFinancials(r, mapping);
      const d = fin.normalized_date || normalizeDateStr(r[mapping.order_date]);
      if (d) {
        if (!maxAnyDatasetDate || d > maxAnyDatasetDate) {
          maxAnyDatasetDate = d;
        }
        if (fin.is_valid && fin.normalized_status === 'completed') {
          if (!maxCompletedDatasetDate || d > maxCompletedDatasetDate) {
            maxCompletedDatasetDate = d;
          }
        }
      }
    });
  }

  const effectiveMaxDate = maxCompletedDatasetDate || maxAnyDatasetDate || null;

  // Resolve analysis reference date:
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
    resolvedReferenceDate = effectiveMaxDate || '2026-01-01';
    dateType = 'latest';
  }

  const refTime = new Date(`${resolvedReferenceDate}T00:00:00Z`).getTime();

  // Aggregate per customer
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
        completed_net_spent: 0.0,
        last_order_date: null,
        verifiedOrderIds: new Set(),
        unassignedCompletedRows: 0,
        hasOnlyNonCompleted: true,
      });
    }

    const c = customerMap.get(groupKey);
    if (!c.customer_name && custName) c.customer_name = custName;

    const fin = calculateRowFinancials(r, mapping);
    const d = fin.normalized_date || normalizeDateStr(r[mapping.order_date]);

    // ONLY completed transactions determine purchase recency and spending!
    if (fin.is_valid && fin.normalized_status === 'completed') {
      c.hasOnlyNonCompleted = false;
      c.completed_net_spent += fin.net_amount;

      if (d) {
        if (!c.last_order_date || d > c.last_order_date) {
          c.last_order_date = d;
        }
      }

      const orderId = hasOrderId && r[mapping.order_id] ? String(r[mapping.order_id]).trim() : null;
      if (orderId) {
        c.verifiedOrderIds.add(orderId);
      } else {
        c.unassignedCompletedRows += 1;
      }
    }
  });

  const customerList = Array.from(customerMap.values()).map(c => {
    // Total completed orders = verified unique orders + unassigned completed transactions
    const totalOrders = c.verifiedOrderIds.size + c.unassignedCompletedRows;

    let recencyDays = null;
    if (c.last_order_date) {
      const orderTime = new Date(`${c.last_order_date}T00:00:00Z`).getTime();
      const diffMs = refTime - orderTime;
      recencyDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }

    return {
      customer_id: c.customer_id,
      customer_name: c.customer_name,
      total_orders: totalOrders,
      verified_orders: c.verifiedOrderIds.size,
      unassigned_orders: c.unassignedCompletedRows,
      total_spent: parseFloat(c.completed_net_spent.toFixed(2)),
      last_order_date: c.last_order_date,
      days_since_last_order: recencyDays,
      days_ago: recencyDays,
    };
  });

  // Calculate spending thresholds among customers with completed purchases
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

    if (orders === 0 || spent === 0) {
      segment = 'Inactive';
      justification = '0 completed purchases (only unfulfilled, cancelled or returned transactions)';
    } else if (recency !== null && recency > 90) {
      segment = 'Inactive';
      justification = `Last purchase was ${recency} days ago (> 90 days threshold)`;
    } else if (spent >= highSpendThreshold && orders >= 2) {
      segment = 'High-Value';
      justification = `High net spend (₹${spent.toLocaleString('en-IN')} ≥ ₹${Math.round(highSpendThreshold).toLocaleString('en-IN')}) with ${orders} orders`;
    } else if (orders >= 3) {
      segment = 'Frequent';
      justification = `${orders} completed orders with recent activity (${recency !== null ? recency + 'd ago' : 'recent'})`;
    } else if (orders >= 1) {
      segment = 'Occasional';
      justification = `${orders} order(s), net spend ₹${spent.toLocaleString('en-IN')}`;
    }

    c.segment = segment;
    c.justification = justification;
  });

  // Sort by total_spent DESC, then total_orders DESC
  customerList.sort((a, b) => b.total_spent - a.total_spent || b.total_orders - a.total_orders);

  // Add rank
  customerList.forEach((c, idx) => {
    c.rank = idx + 1;
  });

  return {
    customers: customerList,
    referenceDate: resolvedReferenceDate,
    maxDatasetDate: effectiveMaxDate,
    dateType,
  };
}

/**
 * Computes Category Performance using completed net sales only
 */
function computeCategoryPerformance(rows, mapping = {}) {
  const catCol = mapping.category;
  if (!catCol) return [];

  const catMap = new Map();

  rows.forEach(r => {
    const cat = r[catCol] !== undefined && r[catCol] !== null && String(r[catCol]).trim() !== ''
      ? String(r[catCol]).trim()
      : 'Uncategorized';

    const fin = calculateRowFinancials(r, mapping);
    if (!fin.is_valid || fin.normalized_status !== 'completed') return;

    if (!catMap.has(cat)) {
      catMap.set(cat, { category: cat, revenue: 0.0, orders: 0 });
    }

    const obj = catMap.get(cat);
    obj.revenue += fin.net_amount;
    obj.orders += 1;
  });

  const list = Array.from(catMap.values()).map(c => ({
    category: c.category,
    revenue: parseFloat(c.revenue.toFixed(2)),
    orders: c.orders,
  }));

  list.sort((a, b) => b.revenue - a.revenue);
  return list;
}

/**
 * Computes Top Products using completed net sales only
 * Includes clean Product ID fallback when product descriptions are missing
 */
function computeTopProducts(rows, mapping = {}) {
  const prodCol = mapping.product;
  const prodIdCol = mapping.product_id;
  const catCol = mapping.category;

  if (!prodCol && !prodIdCol) return [];

  const prodMap = new Map();

  rows.forEach(r => {
    const prodName = prodCol && r[prodCol] !== undefined && r[prodCol] !== null && String(r[prodCol]).trim() !== ''
      ? String(r[prodCol]).trim()
      : null;
    const prodId = prodIdCol && r[prodIdCol] !== undefined && r[prodIdCol] !== null && String(r[prodIdCol]).trim() !== ''
      ? String(r[prodIdCol]).trim()
      : null;

    if (!prodName && !prodId) return;

    const displayKey = prodId ? `id:${prodId}` : `name:${prodName}`;
    const displayName = prodName || (prodId ? `Product #${prodId}` : 'Unknown Product');
    const category = catCol && r[catCol] ? String(r[catCol]).trim() : 'General';

    const fin = calculateRowFinancials(r, mapping);
    if (!fin.is_valid || fin.normalized_status !== 'completed') return;

    if (!prodMap.has(displayKey)) {
      prodMap.set(displayKey, {
        product: displayName,
        product_id: prodId,
        category,
        revenue: 0.0,
        orders: 0,
      });
    }

    const obj = prodMap.get(displayKey);
    obj.revenue += fin.net_amount;
    obj.orders += 1;
  });

  const list = Array.from(prodMap.values()).map(p => ({
    product: p.product,
    product_id: p.product_id,
    category: p.category,
    revenue: parseFloat(p.revenue.toFixed(2)),
    orders: p.orders,
  }));

  list.sort((a, b) => b.revenue - a.revenue);
  return list.slice(0, 10);
}

/**
 * Computes Location Breakdown using completed transactions only
 */
function computeLocationBreakdown(rows, mapping = {}) {
  const locCol = mapping.location;
  if (!locCol) return [];

  const locMap = new Map();

  rows.forEach(r => {
    const loc = r[locCol] !== undefined && r[locCol] !== null && String(r[locCol]).trim() !== ''
      ? String(r[locCol]).trim()
      : 'Unknown';

    const fin = calculateRowFinancials(r, mapping);
    if (!fin.is_valid || fin.normalized_status !== 'completed') return;

    if (!locMap.has(loc)) {
      locMap.set(loc, { location: loc, orders: 0, revenue: 0.0 });
    }

    const obj = locMap.get(loc);
    obj.orders += 1;
    obj.revenue += fin.net_amount;
  });

  const list = Array.from(locMap.values()).map(l => ({
    location: l.location,
    orders: l.orders,
    revenue: parseFloat(l.revenue.toFixed(2)),
  }));

  list.sort((a, b) => b.orders - a.orders);
  return list.slice(0, 8);
}

/**
 * Computes Payment Breakdown using completed transactions only
 */
function computePaymentBreakdown(rows, mapping = {}) {
  const payCol = mapping.payment_type;
  if (!payCol) return [];

  const payMap = new Map();

  rows.forEach(r => {
    const pay = r[payCol] !== undefined && r[payCol] !== null && String(r[payCol]).trim() !== ''
      ? String(r[payCol]).trim()
      : 'Other';

    const fin = calculateRowFinancials(r, mapping);
    if (!fin.is_valid || fin.normalized_status !== 'completed') return;

    if (!payMap.has(pay)) {
      payMap.set(pay, { payment_type: pay, count: 0, revenue: 0.0 });
    }

    const obj = payMap.get(pay);
    obj.count += 1;
    obj.revenue += fin.net_amount;
  });

  const list = Array.from(payMap.values()).map(p => ({
    payment_type: p.payment_type,
    count: p.count,
    revenue: parseFloat(p.revenue.toFixed(2)),
  }));

  list.sort((a, b) => b.count - a.count);
  return list;
}

module.exports = {
  parseCSV,
  isValidCalendarDate,
  normalizeDateStr,
  normalizeStatus,
  parseStrictNumber,
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
