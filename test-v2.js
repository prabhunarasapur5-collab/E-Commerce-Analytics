// test-v2.js
const http = require('http');

function postJSON(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers,
    }, res => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(buf) });
        } catch {
          resolve({ status: res.statusCode, text: buf });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJSON(path, token) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'GET',
      headers,
    }, res => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(buf) });
        } catch {
          resolve({ status: res.statusCode, text: buf });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Test Suite for V2 Specification ---\n');

  // Test 1: Unauthenticated protection
  const unauthRes = await getJSON('/api/analytics/summary');
  console.log('1. Unauthenticated route protection: status =', unauthRes.status, '(Expected 401)');
  if (unauthRes.status !== 401) throw new Error('Unauthenticated request was not blocked!');

  // Test 2: User signup
  const randomSuffix = Math.floor(Math.random() * 10000);
  const signupRes = await postJSON('/api/auth/signup', {
    username: `analyst_${randomSuffix}`,
    email: `analyst_${randomSuffix}@example.com`,
    password: 'Password@123',
  });
  console.log('2. User signup status =', signupRes.status, '| User:', signupRes.data.user?.username);
  if (signupRes.status !== 201 || !signupRes.data.token) throw new Error('Signup failed!');
  const token = signupRes.data.token;

  // Test 3: New user empty state
  const sumEmpty = await getJSON('/api/analytics/summary', token);
  console.log('3. New user summary hasDataset =', sumEmpty.data.hasDataset, '(Expected false)');
  if (sumEmpty.data.hasDataset !== false) throw new Error('New user saw data before uploading!');

  const custEmpty = await getJSON('/api/analytics/customers', token);
  console.log('   New user customers hasDataset =', custEmpty.data.hasDataset, '(Expected false)');

  const expEmpty = await getJSON('/api/transactions', token);
  console.log('   New user explorer hasDataset =', expEmpty.data.hasDataset, '| total =', expEmpty.data.total, '(Expected 0)');

  // Test 4: Upload File A (5 rows)
  const rowsA = [
    { order_id: "ORD-101", customer: "Alice", product: "Book", price: "250", quantity: "2", date: "2025-01-05" },
    { order_id: "ORD-102", customer: "Bob", product: "Pen", price: "50", quantity: "5", date: "2025-01-08" },
    { order_id: "ORD-103", customer: "Alice", product: "Notebook", price: "120", quantity: "1", date: "2025-01-12" },
  ];
  const uploadARes = await postJSON('/api/upload/confirm', {
    fileName: 'books_sales.json',
    fileType: 'JSON',
    rows: rowsA,
    columnMapping: {
      customer_id: null,
      customer_name: 'customer',
      product: 'product',
      category: null,
      price: 'price',
      quantity: 'quantity',
      order_date: 'date',
    }
  }, token);
  console.log('4. Upload File A status =', uploadARes.status, '| rowCount =', uploadARes.data.rowCount);
  if (uploadARes.status !== 201) throw new Error('File A upload failed');

  // Verify File A is active
  const sumA = await getJSON('/api/analytics/summary', token);
  console.log('   File A Active:', sumA.data.dataset?.file_name, '| Total Orders =', sumA.data.metrics.total_orders, '(Expected 3)');
  if (sumA.data.metrics.total_orders !== 3) throw new Error('File A order count mismatch');

  // Test 5: Upload File B (4 rows - different data)
  const rowsB = [
    { txn_id: "TXN-901", client_name: "Charlie", item: "Laptop", amount: "75000", qty: "1", purchase_date: "2025-02-01" },
    { txn_id: "TXN-902", client_name: "David", item: "Mouse", amount: "1500", qty: "2", purchase_date: "2025-02-03" },
  ];
  const uploadBRes = await postJSON('/api/upload/confirm', {
    fileName: 'electronics.csv',
    fileType: 'CSV',
    rows: rowsB,
    columnMapping: {
      customer_id: null,
      customer_name: 'client_name',
      product: 'item',
      category: null,
      price: 'amount',
      quantity: 'qty',
      order_date: 'purchase_date',
    }
  }, token);
  console.log('5. Upload File B status =', uploadBRes.status, '| rowCount =', uploadBRes.data.rowCount);

  // Test 6: Verify ONLY File B is active (No mixing with File A!)
  const sumB = await getJSON('/api/analytics/summary', token);
  console.log('6. File B Active:', sumB.data.dataset?.file_name, '| Total Orders =', sumB.data.metrics.total_orders, '(Expected 2, NOT 5!)');
  if (sumB.data.metrics.total_orders !== 2 || sumB.data.dataset?.file_name !== 'electronics.csv') {
    throw new Error('Dataset isolation failed! Data mixed between uploads.');
  }

  // Test 7: Verify customer segmentation uses File B's exact names (Charlie, David)
  const custB = await getJSON('/api/analytics/customers', token);
  const custNames = custB.data.customers.map(c => c.customer_name);
  console.log('7. File B Customers:', custNames.join(', '), '(Expected Charlie, David; NO Alice or Bob!)');
  if (custNames.includes('Alice') || custNames.includes('Bob')) {
    throw new Error('Customer names leaked from previous dataset!');
  }

  // Test 8: Data Explorer test
  const expB = await getJSON('/api/transactions', token);
  console.log('8. Data Explorer rows =', expB.data.rows.length, '| Original headers =', expB.data.headers.join(', '));
  console.log('   First row client_name =', expB.data.rows[0].raw_data.client_name, '(Uses file own values)');

  // Test 9: Datasets list & switching back to File A
  const dsList = await getJSON('/api/datasets', token);
  console.log('9. User dataset count =', dsList.data.length, '(Expected 2)');
  const dsA = dsList.data.find(d => d.file_name === 'books_sales.json');

  const switchRes = await postJSON('/api/datasets/select', { dataset_id: dsA.id }, token);
  console.log('   Switched active dataset back to File A: status =', switchRes.status);

  const sumASwitched = await getJSON('/api/analytics/summary', token);
  console.log('   Now active:', sumASwitched.data.dataset?.file_name, '| Total Orders =', sumASwitched.data.metrics.total_orders, '(Expected 3)');
  if (sumASwitched.data.metrics.total_orders !== 3) throw new Error('Switching dataset failed');

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! Clean isolation, zero demo data, JWT auth, and active dataset switching verified.');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
