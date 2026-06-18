const { spawn } = require('child_process');
const assert = require('assert');
const crypto = require('crypto');

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;
const WEBHOOK_SECRET = 'aegis-webhook-secret-key';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('Starting Aegis ITAM Middleware server on port 3001 for integration tests...');
  
  const path = require('path');
  const serverPath = path.resolve(__dirname, '../server.js');
  const serverProcess = spawn('node', [serverPath], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverOutput = '';
  serverProcess.stdout.on('data', (data) => {
    serverOutput += data.toString();
    // Optional debug log
    // process.stdout.write('[Server Stdout] ' + data.toString());
  });

  serverProcess.stderr.on('data', (data) => {
    console.error('[Server Stderr]', data.toString());
  });

  // Wait for server to start
  let attempts = 0;
  let started = false;
  while (attempts < 10) {
    await delay(500);
    if (serverOutput.includes(`Listening on http://localhost:${PORT}`)) {
      started = true;
      break;
    }
    attempts++;
  }

  if (!started) {
    console.error('Server failed to start or write listening message within 5 seconds.');
    console.log('Output so far:', serverOutput);
    serverProcess.kill();
    process.exit(1);
  }

  console.log('Server started successfully! Beginning test execution...\n');
  let failures = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ TEST PASSED: ${name}`);
    } catch (err) {
      console.error(`❌ TEST FAILED: ${name}`);
      console.error(err);
      failures++;
    }
  }

  // Test 1: Health Check Endpoint
  await test('GET /ping (Health Check)', async () => {
    const res = await fetch(`${BASE_URL}/ping`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
    assert.ok(data.uptime > 0);
  });

  // Test 2: Authentication (Login Success)
  await test('POST /api/auth/login (Success)', async () => {
    const payload = { username: 'admin', password: 'aegis2026' };
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'success');
    assert.strictEqual(data.user.role, 'hr-admin');
    assert.strictEqual(data.user.name, 'Tom Jason Umali');
  });

  // Test 3: Authentication (Login Failure)
  await test('POST /api/auth/login (Failure)', async () => {
    const payload = { username: 'admin', password: 'wrongpassword' };
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.ok(data.error.includes('Invalid credentials'));
  });

  // Test 4: Webhook Security (HMAC - Missing Signature)
  await test('POST /api/webhooks/bamboohr (Missing Signature)', async () => {
    const payload = { type: 'EmployeeTerminatedEvent', employee_id: 'EMP-101' };
    const res = await fetch(`${BASE_URL}/api/webhooks/bamboohr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.ok(data.error.includes('Missing x-bamboohr-signature'));
  });

  // Test 5: Webhook Security (HMAC - Spoofed Signature)
  await test('POST /api/webhooks/bamboohr (Spoofed Signature)', async () => {
    const payload = { type: 'EmployeeTerminatedEvent', employee_id: 'EMP-101' };
    const res = await fetch(`${BASE_URL}/api/webhooks/bamboohr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bamboohr-signature': 'unsigned-spoof'
      },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.ok(data.error.includes('Blocked suspicious spoofed signature'));
  });

  // Test 6: Webhook Security (HMAC - Invalid Signature)
  await test('POST /api/webhooks/bamboohr (HMAC Mismatch)', async () => {
    const payload = { type: 'EmployeeTerminatedEvent', employee_id: 'EMP-101' };
    const res = await fetch(`${BASE_URL}/api/webhooks/bamboohr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bamboohr-signature': 'a1b2c3d4e5f6' // bad sig
      },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.ok(data.error.includes('HMAC signature verification failed'));
  });

  // Test 7: Webhook Security (HMAC - Success)
  await test('POST /api/webhooks/bamboohr (Success Termination Event)', async () => {
    const payload = {
      type: 'EmployeeTerminatedEvent',
      employee_id: 'EMP-104',
      terminationDate: '2026-06-18'
    };
    const bodyStr = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(bodyStr)
      .digest('hex');

    const res = await fetch(`${BASE_URL}/api/webhooks/bamboohr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bamboohr-signature': signature
      },
      body: bodyStr
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'success');
  });

  // Test 8: Webhook Validation (JSON Schema Failure)
  await test('POST /api/webhooks/bamboohr (JSON Schema Failure on Hire)', async () => {
    const payload = {
      type: 'EmployeeHiredEvent',
      employee_id: 'EMP-105',
      name: 'T', // minLength is 2, so this fails schema
      role: 'Engineer',
      department: 'Telehealth'
    };
    const bodyStr = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(bodyStr)
      .digest('hex');

    const res = await fetch(`${BASE_URL}/api/webhooks/bamboohr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bamboohr-signature': signature
      },
      body: bodyStr
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('Schema Validation Error'));
  });

  // Test 9: Webhook Validation (JSON Schema Success)
  await test('POST /api/webhooks/bamboohr (JSON Schema Success on Hire)', async () => {
    const payload = {
      type: 'EmployeeHiredEvent',
      employee_id: 'EMP-105',
      name: 'Dr. John Doe',
      role: 'Telehealth Practitioner',
      department: 'Telehealth'
    };
    const bodyStr = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(bodyStr)
      .digest('hex');

    const res = await fetch(`${BASE_URL}/api/webhooks/bamboohr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bamboohr-signature': signature
      },
      body: bodyStr
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'success');
  });

  // Test 10: Fetch Assets Registry
  await test('GET /api/assets (Retrieve Registry)', async () => {
    const res = await fetch(`${BASE_URL}/api/assets`);
    assert.strictEqual(res.status, 200);
    const assets = await res.json();
    assert.ok(Array.isArray(assets));
    assert.ok(assets.length > 0);
    // Spot check a specific asset
    const a = assets.find(item => item.tag === 'LPT-881');
    assert.strictEqual(a.model, 'MacBook Pro 14"');
  });

  // Test 11: Upload HIPAA Cryptographic Wipe Certificate
  await test('POST /api/assets/:tag/wipe-certificate (Upload Certificate)', async () => {
    const tag = 'LPT-885';
    const payload = {
      fileName: 'sanitization_cert_LPT885.pdf',
      fileSize: '154 KB',
      base64Data: 'JVBERi0xLjQKJ...'
    };
    const res = await fetch(`${BASE_URL}/api/assets/${tag}/wipe-certificate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'success');

    // Confirm asset status updated
    const assetRes = await fetch(`${BASE_URL}/api/assets`);
    const assets = await assetRes.json();
    const asset = assets.find(item => item.tag === tag);
    assert.strictEqual(asset.status, 'Ready to Deploy');
    assert.strictEqual(asset.mdmStatus, 'Wiped & HIPAA Sanitized');
    assert.strictEqual(asset.ownerId, null);
    assert.ok(asset.wipeCertificate);
    assert.strictEqual(asset.wipeCertificate.fileName, 'sanitization_cert_LPT885.pdf');
  });

  // Test 12: GraphQL Federation Simulation
  await test('POST /api/graphql (Query Federated Employee Diagnostics)', async () => {
    const payload = {
      query: `
        query GetEmployeeDiagnostics($id: String!) {
          employee(id: $id) {
            id
            name
            role
            assignedAssets {
              tag
              model
              mdmStatus
              telemetry {
                cpuTemp
                batteryHealth
              }
            }
          }
        }
      `,
      variables: { id: 'EMP-101' }
    };
    const res = await fetch(`${BASE_URL}/api/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.data.employee);
    assert.strictEqual(data.data.employee.id, 'EMP-101');
    assert.ok(Array.isArray(data.data.employee.assignedAssets));
  });

  console.log('\n----------------------------------------');
  console.log(`Execution complete. Passed: ${12 - failures}/12, Failed: ${failures}`);
  console.log('----------------------------------------');

  // Terminate the server process
  serverProcess.kill();

  if (failures > 0) {
    process.exit(1);
  } else {
    console.log('All tests completed successfully. Integration verification passed!');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test runner encountered fatal error:', err);
  process.exit(1);
});
