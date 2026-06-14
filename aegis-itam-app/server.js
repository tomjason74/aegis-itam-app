const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true });

// Load and compile schemas
let schemaValidators = {};
try {
  const termSchema = require('./src/schemas/EmployeeTerminatedEvent.json');
  const hireSchema = require('./src/schemas/EmployeeHiredEvent.json');
  schemaValidators['EmployeeTerminatedEvent'] = ajv.compile(termSchema);
  schemaValidators['EmployeeHiredEvent'] = ajv.compile(hireSchema);
  console.log('[Schema Validation] Schemas successfully compiled.');
} catch (err) {
  console.error('[Schema Validation] Failed compiling schemas:', err.message);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP and WebSocket Server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ==========================================
// 1. IN-MEMORY SIMULATED DATABASES (POSTGRES & MONGODB & INFLUXDB)
// ==========================================

// PostgreSQL Mock: Core relational assets and users
const postgres = {
  employees: [
    { id: "EMP-101", name: "Dr. Evelyn Santos", role: "Senior Pediatrician", department: "Telehealth", status: "Active", email: "evelyn.santos@aegishealth.ph" },
    { id: "EMP-102", name: "Dr. Mark Rivera", role: "Cardiology Consultant", department: "Telehealth", status: "Active", email: "mark.rivera@aegishealth.ph" },
    { id: "EMP-103", name: "Dr. Clara Cruz", role: "General Practitioner", department: "Telehealth", status: "Active", email: "clara.cruz@aegishealth.ph" },
    { id: "EMP-104", name: "Dr. Jason Umali", role: "Internal Medicine Specialist", department: "Telehealth", status: "Active", email: "jason.umali@aegishealth.ph" }
  ],
  assets: [
    { tag: "LPT-881", model: "MacBook Pro 14\"", serial: "C02DFGH8Q05D", type: "Laptop", ownerId: "EMP-101", status: "Ready to Deploy", cost: 1800, mdmStatus: "Enrolled" },
    { tag: "KIT-302", model: "Telehealth Diagnostic Kit v2", serial: "THK-9923881", type: "Diagnostic Kit", ownerId: "EMP-101", status: "Deployed", cost: 1200, mdmStatus: "Enrolled" },
    { tag: "LPT-882", model: "Lenovo ThinkPad T14", serial: "PF2XW882", type: "Laptop", ownerId: "EMP-102", status: "Deployed", cost: 1300, mdmStatus: "Enrolled" },
    { tag: "KIT-303", model: "Telehealth Diagnostic Kit v2", serial: "THK-9923882", type: "Diagnostic Kit", ownerId: "EMP-102", status: "Deployed", cost: 1200, mdmStatus: "Enrolled" },
    { tag: "LPT-883", model: "MacBook Pro 14\"", serial: "C02DFGH8Q05E", type: "Laptop", ownerId: "EMP-103", status: "Deployed", cost: 1800, mdmStatus: "Enrolled" },
    { tag: "IPD-401", model: "iPad Pro 11\"", serial: "DMPFX883", type: "Tablet", ownerId: "EMP-103", status: "Deployed", cost: 900, mdmStatus: "Enrolled" },
    { tag: "LPT-884", model: "Lenovo ThinkPad T14", serial: "PF2XW884", type: "Laptop", ownerId: "EMP-104", status: "Deployed", cost: 1300, mdmStatus: "Enrolled" },
    { tag: "KIT-304", model: "Telehealth Diagnostic Kit v2", serial: "THK-9923884", type: "Diagnostic Kit", ownerId: "EMP-104", status: "Deployed", cost: 1200, mdmStatus: "Enrolled" },
    { tag: "LPT-885", model: "Lenovo ThinkPad T14", serial: "PF2XW885", type: "Laptop", ownerId: null, status: "Ready to Deploy", cost: 1300, mdmStatus: "Unenrolled" },
    { tag: "KIT-305", model: "Telehealth Diagnostic Kit v2", serial: "THK-9923885", type: "Diagnostic Kit", ownerId: null, status: "Ready to Deploy", cost: 1200, mdmStatus: "Unenrolled" }
  ],
  procurementOrders: [
    { poId: "PO-7721", vendor: "Lenovo Corp", item: "ThinkPad T14", quantity: 5, unitCost: 1300, status: "Approved", date: "2026-06-01" },
    { poId: "PO-7722", vendor: "VitalsEdge Logistics", item: "Telehealth Diagnostic Kit v2", quantity: 2, unitCost: 1200, status: "Approved", date: "2026-06-03" }
  ]
};

// MongoDB Mock: Document storage for HIPAA wipe certificates and policies
const mongodb = {
  wipeCertificates: {}, // maps assetTag -> { uploadedAt, file: { name, size }, content: base64/url }
  compliancePolicies: {
    "EMP-101": { signedAt: "2026-01-15T09:00:00Z", version: "HIPAA-AUP-v4" },
    "EMP-102": { signedAt: "2026-01-16T10:30:00Z", version: "HIPAA-AUP-v4" },
    "EMP-103": { signedAt: "2026-02-01T14:15:00Z", version: "HIPAA-AUP-v4" },
    "EMP-104": { signedAt: "2026-02-05T11:00:00Z", version: "HIPAA-AUP-v4" }
  }
};

// InfluxDB Mock: Time-series database for telemetry metrics (battery health, temperature)
const influxdb = {
  metrics: [] // array of { time, tag, cpuTemp, batteryHealth, memoryLoad }
};

// ==========================================
// 2. KAFKA EVENT BROKER SIMULATION
// ==========================================
const kafkaLogs = [];
function publishToKafka(eventType, data) {
  // Validate against Ajv if we have a compiled schema
  if (schemaValidators[eventType]) {
    const validate = schemaValidators[eventType];
    const valid = validate(data);
    if (!valid) {
      const errorMsgs = validate.errors.map(err => `${err.instancePath || 'payload'} ${err.message}`).join(', ');
      logSystemMessage(`[KAFKA SCHEMA ERROR] Event ${eventType} failed schema validation: ${errorMsgs}`);
      console.warn(`[Kafka Validation Fail] ${eventType}: ${errorMsgs}`);
      return false; // prevent publishing invalid events
    }
  }

  const event = {
    eventId: uuidv4(),
    eventType,
    timestamp: new Date().toISOString(),
    data
  };
  kafkaLogs.push(event);
  if (kafkaLogs.length > 100) kafkaLogs.shift(); // keep last 100 logs

  broadcastToClients({ type: 'KAFKA_EVENT', payload: event });
  
  // Trigger consumers asynchronously
  setTimeout(() => handleKafkaEvent(event), 500);
  return true;
}

// ==========================================
// 3. TEMPORAL WORKFLOW ENGINE SIMULATION
// ==========================================
const activeWorkflows = {};

function startOffboardingWorkflow(employeeId, terminationDate) {
  const workflowId = `WF-OFFBOARD-${employeeId}-${Date.now().toString().slice(-4)}`;
  const employee = postgres.employees.find(e => e.id === employeeId);
  if (!employee) return;

  // Find all assets assigned to employee
  const assets = postgres.assets.filter(a => a.ownerId === employeeId).map(a => a.tag);

  activeWorkflows[workflowId] = {
    workflowId,
    employeeId,
    employeeName: employee.name,
    assets,
    status: "Running",
    step: "INITIALIZED",
    steps: {
      "INITIALIZED": "COMPLETED",
      "JAMF_LOCK": "PENDING",
      "FEDEX_LABEL": "PENDING",
      "SHIPPING": "PENDING",
      "WIPE_VERIFICATION": "PENDING",
      "FINISHED": "PENDING"
    },
    fedexLabelUrl: null,
    fedexTrackingNumber: null,
    shippingProgress: 0,
    logs: [`Workflow initialized for ${employee.name} (Assets to recover: ${assets.join(', ')})`],
    updatedAt: new Date().toISOString()
  };

  employee.status = "Terminated";

  broadcastToClients({ type: 'WORKFLOW_UPDATE', payload: activeWorkflows[workflowId] });
  logWorkflowStep(workflowId, "Workflow successfully launched via Temporal.");

  // Process the workflow steps with artificial delays
  runWorkflowStateLoop(workflowId);
}

async function runWorkflowStateLoop(workflowId) {
  const wf = activeWorkflows[workflowId];
  if (!wf || wf.status !== "Running") return;

  try {
    if (wf.steps["JAMF_LOCK"] === "PENDING") {
      wf.step = "JAMF_LOCK";
      logWorkflowStep(workflowId, "Contacting Jamf/Intune API to issue MDM Remote Lock...");
      broadcastToClients({ type: 'WORKFLOW_UPDATE', payload: wf });

      await delay(2000);
      logWorkflowStep(workflowId, "[Network Alert] Jamf API socket timeout on attempt 1. Retrying with backoff...");
      broadcastToClients({ type: 'WORKFLOW_UPDATE', payload: wf });
      await delay(2000);
      
      // Update assets in database to Locked status
      wf.assets.forEach(tag => {
        const asset = postgres.assets.find(a => a.tag === tag);
        if (asset) {
          asset.mdmStatus = "Locked (Offboarding)";
          asset.status = "Needs Sanitization";
        }
      });
      wf.steps["JAMF_LOCK"] = "COMPLETED";
      logWorkflowStep(workflowId, "Success: Devices remotely locked and set to 'Needs Sanitization'.");
      broadcastToClients({ type: 'WORKFLOW_UPDATE', payload: wf });
    }

    if (wf.steps["FEDEX_LABEL"] === "PENDING") {
      wf.step = "FEDEX_LABEL";
      logWorkflowStep(workflowId, "Calling FedEx API to generate return shipping label...");
      broadcastToClients({ type: 'WORKFLOW_UPDATE', payload: wf });

      await delay(2000);
      logWorkflowStep(workflowId, "[Rate Limit Alert] FedEx API returned HTTP 429. Retrying in 2 seconds...");
      broadcastToClients({ type: 'WORKFLOW_UPDATE', payload: wf });
      await delay(2000);

      // Simulate generating tracking number
      const tracking = "4002688" + Math.floor(10000 + Math.random() * 90000);
      wf.fedexTrackingNumber = tracking;
      wf.fedexLabelUrl = `/api/download/label/${wf.employeeId}`;
      wf.steps["FEDEX_LABEL"] = "COMPLETED";
      logWorkflowStep(workflowId, `FedEx Return Label generated: Track #${tracking}. Email sent to employee.`);
      publishToKafka("ShipmentLabelGeneratedEvent", {
        employeeId: wf.employeeId,
        trackingNumber: tracking,
        labelUrl: wf.fedexLabelUrl
      });
      broadcastToClients({ type: 'WORKFLOW_UPDATE', payload: wf });
    }

    if (wf.steps["SHIPPING"] === "PENDING") {
      wf.step = "SHIPPING";
      logWorkflowStep(workflowId, "Waiting for courier pickup / package delivery...");
      broadcastToClients({ type: 'WORKFLOW_UPDATE', payload: wf });

      // Start simulated shipping loop
      simulateShippingJourney(workflowId);
    }
  } catch (err) {
    wf.status = "Failed";
    logWorkflowStep(workflowId, `ERROR: ${err.message}. Temporal holds current execution state for retries.`);
    broadcastToClients({ type: 'WORKFLOW_UPDATE', payload: wf });
  }
}

function logWorkflowStep(workflowId, message) {
  const wf = activeWorkflows[workflowId];
  if (wf) {
    wf.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
    wf.updatedAt = new Date().toISOString();
  }
}

async function simulateShippingJourney(workflowId) {
  const wf = activeWorkflows[workflowId];
  if (!wf) return;

  const states = [
    { progress: 25, msg: "FedEx Logged: Package collected by local Manila carrier." },
    { progress: 50, msg: "FedEx Status: In Transit. Dispatched to regional sorting hub." },
    { progress: 75, msg: "FedEx Status: Out for delivery to HQ Clinical Operations Manila." },
    { progress: 100, msg: "FedEx Status: Delivered to HQ. Asset received by IT Helpdesk." }
  ];

  for (let state of states) {
    await delay(4000);
    if (!activeWorkflows[workflowId] || activeWorkflows[workflowId].status !== "Running") return;
    
    wf.shippingProgress = state.progress;
    logWorkflowStep(workflowId, state.msg);
    broadcastToClients({ type: 'WORKFLOW_UPDATE', payload: wf });
  }

  wf.steps["SHIPPING"] = "COMPLETED";
  logWorkflowStep(workflowId, "Asset receipt confirmed. Waiting for clinical sanitization certificate upload...");
  wf.step = "WIPE_VERIFICATION";
  broadcastToClients({ type: 'WORKFLOW_UPDATE', payload: wf });
  publishToKafka("AssetReturnedEvent", { employeeId: wf.employeeId, assets: wf.assets });
}

// ==========================================
// 4. KAFKA EVENT CONSUMER LOGIC
// ==========================================
function handleKafkaEvent(event) {
  console.log(`[Kafka Consumer] Received: ${event.eventType}`);
  
  switch (event.eventType) {
    case 'EmployeeHiredEvent':
      const newEmp = {
        id: event.data.employeeId,
        name: event.data.name,
        role: event.data.role,
        department: event.data.department,
        status: "Active",
        email: `${event.data.name.toLowerCase().replace(/\s+/g, '.')}@aegishealth.ph`
      };
      postgres.employees.push(newEmp);
      
      // Auto-provision a Laptop and Diagnostic Kit from stock (ownerId: null)
      const laptop = postgres.assets.find(a => a.type === "Laptop" && !a.ownerId && a.status === "Ready to Deploy");
      if (laptop) {
        laptop.ownerId = newEmp.id;
        laptop.status = "Deployed";
        laptop.mdmStatus = "Enrolled";
        publishToKafka("AssetAssignedEvent", { employeeId: newEmp.id, assetTag: laptop.tag });
      }
      
      const kit = postgres.assets.find(a => a.type === "Diagnostic Kit" && !a.ownerId && a.status === "Ready to Deploy");
      if (kit) {
        kit.ownerId = newEmp.id;
        kit.status = "Deployed";
        kit.mdmStatus = "Enrolled";
        publishToKafka("AssetAssignedEvent", { employeeId: newEmp.id, assetTag: kit.tag });
      }
      
      logSystemMessage(`[Onboarding] Onboarded ${newEmp.name} (${newEmp.id}). Deployed hardware and enrolled in Jamf.`);
      broadcastToClients({ type: 'DATA_REFRESH' });
      break;

    case 'EmployeeTerminatedEvent':
      startOffboardingWorkflow(event.data.employeeId, event.data.terminationDate);
      break;
    
    case 'AssetReturnedEvent':
      // Trigger notification or specific DB updates if needed
      break;
    
    case 'DeviceTelemetryAnomalyEvent':
      // Trigger Procurement via Coupa API Mock
      const { assetTag, cpuTemp, batteryHealth, issue } = event.data;
      logSystemMessage(`[AI Model] High Failure Risk detected for ${assetTag}. Triggering automated replacement PO...`);
      createAutomatedProcurementOrder(assetTag, issue);
      break;
  }
}

function createAutomatedProcurementOrder(assetTag, issue) {
  const asset = postgres.assets.find(a => a.tag === assetTag);
  if (!asset) return;

  const order = {
    poId: "PO-" + Math.floor(1000 + Math.random() * 9000),
    vendor: asset.type === "Laptop" ? "Lenovo Corp" : "VitalsEdge Logistics",
    item: asset.model,
    quantity: 1,
    unitCost: asset.cost,
    status: "Approved (AI-Triggered)",
    date: new Date().toISOString().split('T')[0],
    notes: `Automated replacement request due to: ${issue}`
  };

  postgres.procurementOrders.push(order);
  publishToKafka("PurchaseOrderCreatedEvent", order);
  broadcastToClients({ type: 'DATA_REFRESH' });
}

// ==========================================
// 5. TELEMETRY & AI INFERENCE SIMULATION
// ==========================================
// Periodically generate telemetry updates to populate InfluxDB and evaluate CPU/battery health
let telemetryInterval = null;

function startTelemetrySimulation() {
  telemetryInterval = setInterval(() => {
    postgres.assets.forEach(asset => {
      // Only active / deployed assets send telemetry
      if (asset.ownerId && asset.status === "Deployed") {
        let cpuTemp = 50 + Math.floor(Math.random() * 25); // normal range: 50-75C
        let batteryHealth = 95 - (parseInt(asset.tag.slice(-3)) % 15) - Math.floor(Math.random() * 5); // stable battery
        let memoryLoad = 40 + Math.floor(Math.random() * 30);

        // Inject high temperatures occasionally for Dr. Evelyn's Diagnostic Kit
        if (asset.tag === "KIT-302" && Math.random() > 0.7) {
          cpuTemp = 88 + Math.floor(Math.random() * 7); // Anomaly!
        }
        
        // Inject low battery for Dr. Mark's Laptop
        if (asset.tag === "LPT-882" && Math.random() > 0.7) {
          batteryHealth = 54 - Math.floor(Math.random() * 5); // Battery Degraded Anomaly!
        }

        const metrics = {
          time: new Date().toISOString(),
          tag: asset.tag,
          model: asset.model,
          owner: postgres.employees.find(e => e.id === asset.ownerId)?.name || "Unknown",
          cpuTemp,
          batteryHealth,
          memoryLoad
        };

        influxdb.metrics.push(metrics);
        if (influxdb.metrics.length > 500) influxdb.metrics.shift(); // limit queue

        // Run AI Predictive Model Mock
        runAIPrediction(metrics);
      }
    });

    broadcastToClients({ type: 'TELEMETRY_BATCH', payload: influxdb.metrics.slice(-15) });
  }, 5000);
}

function runAIPrediction(metrics) {
  let failureProbability = 5; // base 5% probability
  let issues = [];

  if (metrics.cpuTemp > 85) {
    failureProbability += 45;
    issues.push(`Overheating Alert: CPU CPU temperature reached ${metrics.cpuTemp}°C`);
  }
  if (metrics.batteryHealth < 60) {
    failureProbability += 35;
    issues.push(`Battery Degradation Alert: capacity dropped to ${metrics.batteryHealth}%`);
  }
  if (metrics.memoryLoad > 90) {
    failureProbability += 10;
    issues.push(`Severe Resource Exhaustion: Memory utilization > 90%`);
  }

  // Cap at 98%
  failureProbability = Math.min(failureProbability, 98);

  // If failure risk exceeds threshold (70%), trigger alert
  if (failureProbability >= 70) {
    // Check if we already have an active PO or open alert for this asset
    const alreadyAlerted = kafkaLogs.some(log => 
      log.eventType === "DeviceTelemetryAnomalyEvent" && 
      log.data.assetTag === metrics.tag &&
      (new Date() - new Date(log.timestamp)) < 120000 // avoid spam within 2 minutes
    );

    if (!alreadyAlerted) {
      publishToKafka("DeviceTelemetryAnomalyEvent", {
        assetTag: metrics.tag,
        cpuTemp: metrics.cpuTemp,
        batteryHealth: metrics.batteryHealth,
        failureProbability,
        issue: issues.join(" & ")
      });
    }
  }
}

// ==========================================
// 6. HTTP API ROUTING (WEBHOOKS, MOCKS, GRAPHQL)
// ==========================================

// REST endpoint simulating BambooHR Webhook with HMAC
app.post("/api/webhooks/bamboohr", (req, res) => {
  const signature = req.headers['x-bamboohr-signature'];
  const { type, employee_id, terminationDate } = req.body;
  
  // Shared webhook secret key
  const webhookSecret = "aegis-webhook-secret-key";
  
  // 1. Signature Verification Check
  if (!signature) {
    logSystemMessage(`[SECURITY WARNING] Incoming Webhook to /api/webhooks/bamboohr has NO signature header. Request BLOCKED.`);
    return res.status(401).json({ error: "Unauthorized: Missing x-bamboohr-signature header" });
  }
  
  if (signature === 'unsigned-spoof') {
    logSystemMessage(`[SECURITY ALERT] Webhook signature header holds 'unsigned-spoof'. Intercepted mock spoofing attack! Request BLOCKED.`);
    return res.status(401).json({ error: "Unauthorized: Blocked suspicious spoofed signature" });
  }
  
  // For authentic requests, calculate HmacSHA256 of payload
  const payloadStr = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(payloadStr)
    .digest('hex');
    
  if (signature !== expectedSignature) {
    logSystemMessage(`[SECURITY WARNING] Cryptographic HMAC mismatch on incoming webhook. Calculated: ${expectedSignature.substring(0,8)}... Received: ${signature.substring(0,8)}... Request BLOCKED.`);
    return res.status(401).json({ error: "Unauthorized: HMAC signature verification failed" });
  }
  
  logSystemMessage(`[SECURITY SUCCESS] HMAC Signature verified successfully: ${signature.substring(0,8)}... Webhook authenticated.`);

  if (!employee_id) {
    return res.status(400).json({ error: "Missing employee_id" });
  }

  const eventType = type || "EmployeeTerminatedEvent";

  if (eventType === "EmployeeTerminatedEvent") {
    const employee = postgres.employees.find(e => e.id === employee_id);
    if (!employee) {
      return res.status(404).json({ error: "Employee not found in registry" });
    }
    publishToKafka("EmployeeTerminatedEvent", {
      employeeId: employee_id,
      terminationDate: terminationDate || new Date().toISOString().split('T')[0]
    });
  } else if (eventType === "EmployeeHiredEvent") {
    const publishSuccess = publishToKafka("EmployeeHiredEvent", {
      employeeId: employee_id,
      name: req.body.name,
      role: req.body.role,
      department: req.body.department
    });
    if (!publishSuccess) {
      return res.status(400).json({ error: "Schema Validation Error: Payload failed formatting checks" });
    }
  } else {
    return res.status(400).json({ error: "Unsupported event type" });
  }

  res.json({ status: "success", message: "Event published to Kafka" });
});

// REST endpoint to retrieve assets
app.get("/api/assets", (req, res) => {
  const enrichedAssets = postgres.assets.map(asset => {
    const owner = postgres.employees.find(e => e.id === asset.ownerId);
    const certificate = mongodb.wipeCertificates[asset.tag];
    return {
      ...asset,
      ownerName: owner ? owner.name : "Unassigned",
      wipeCertificate: certificate || null
    };
  });
  res.json(enrichedAssets);
});

// REST endpoint to inject telemetry anomaly
app.post("/api/telemetry/inject", (req, res) => {
  const { tag, type } = req.body;
  const asset = postgres.assets.find(a => a.tag === tag);
  if (!asset) return res.status(404).json({ error: "Asset not found" });

  let cpuTemp = 50 + Math.floor(Math.random() * 20);
  let batteryHealth = 90 - Math.floor(Math.random() * 10);
  let memoryLoad = 40 + Math.floor(Math.random() * 20);

  if (type === "temp") {
    cpuTemp = 93;
    logSystemMessage(`[Jamf Simulator] Telemetry anomaly injected: Spiked temperature on ${tag} to 93°C.`);
  } else if (type === "battery") {
    batteryHealth = 48;
    logSystemMessage(`[Jamf Simulator] Telemetry anomaly injected: Degraded battery health on ${tag} to 48%.`);
  }

  const metrics = {
    time: new Date().toISOString(),
    tag: asset.tag,
    model: asset.model,
    owner: postgres.employees.find(e => e.id === asset.ownerId)?.name || "Unknown",
    cpuTemp,
    batteryHealth,
    memoryLoad
  };

  influxdb.metrics.push(metrics);
  if (influxdb.metrics.length > 500) influxdb.metrics.shift();

  // Run AI logic immediately
  runAIPrediction(metrics);
  
  // Send telemetry update to front-end chart
  broadcastToClients({ type: 'TELEMETRY_BATCH', payload: [metrics] });
  broadcastToClients({ type: 'DATA_REFRESH' });

  res.json({ status: "success", message: `Anomaly injected successfully for ${tag}` });
});

// REST endpoint to upload HIPAA Cryptographic Wipe Certificate
app.post("/api/assets/:tag/wipe-certificate", (req, res) => {
  const { tag } = req.params;
  const { fileName, fileSize, base64Data } = req.body;

  const asset = postgres.assets.find(a => a.tag === tag);
  if (!asset) {
    return res.status(404).json({ error: "Asset not found" });
  }

  // Save in MongoDB Compliance Layer
  mongodb.wipeCertificates[tag] = {
    uploadedAt: new Date().toISOString(),
    fileName: fileName || "cryptowipe-cert.pdf",
    fileSize: fileSize || "184 KB",
    verified: true
  };

  // Change asset status and MDM status
  asset.status = "Ready to Deploy";
  asset.mdmStatus = "Wiped & HIPAA Sanitized";
  asset.ownerId = null; // Unassign it

  // Trigger Kafka event
  publishToKafka("DeviceWipedEvent", { assetTag: tag, timestamp: new Date().toISOString() });

  // Update any running workflows waiting on this asset's verification
  Object.keys(activeWorkflows).forEach(wfId => {
    const wf = activeWorkflows[wfId];
    if (wf.employeeId === req.body.employeeId || (wf.assets && wf.assets.includes(tag))) {
      // Check if all workflow assets are wiped
      const allWiped = wf.assets.every(assetTag => mongodb.wipeCertificates[assetTag]);
      if (allWiped && wf.step === "WIPE_VERIFICATION") {
        wf.steps["WIPE_VERIFICATION"] = "COMPLETED";
        wf.steps["FINISHED"] = "COMPLETED";
        wf.status = "Completed";
        logWorkflowStep(wfId, "Success: All wipe certificates verified. Offboarding complete.");
        broadcastToClients({ type: 'WORKFLOW_UPDATE', payload: wf });
      }
    }
  });

  broadcastToClients({ type: 'DATA_REFRESH' });
  res.json({ status: "success", message: "Cryptographic wipe certificate registered. Asset is marked sanitised and ready for deployment." });
});

// REST endpoint to get Kafka logs
app.get("/api/kafka/logs", (req, res) => {
  res.json(kafkaLogs);
});

// REST endpoint to get active workflows
app.get("/api/workflows", (req, res) => {
  res.json(Object.values(activeWorkflows));
});

// REST endpoint to get active procurement orders
app.get("/api/procurement/orders", (req, res) => {
  res.json(postgres.procurementOrders);
});

// REST endpoint to get employees
app.get("/api/employees", (req, res) => {
  res.json(postgres.employees);
});

// GraphQL Mock Endpoint
app.post("/api/graphql", (req, res) => {
  const { query, variables } = req.body;
  
  // High-fidelity resolver mocks for dashboard federated queries
  if (query.includes("GetEmployeeDiagnostics")) {
    const employeeId = variables ? variables.id : "EMP-101";
    const employee = postgres.employees.find(e => e.id === employeeId);
    if (!employee) return res.json({ data: { employee: null } });

    const assets = postgres.assets.filter(a => a.ownerId === employeeId).map(asset => {
      const telemetry = influxdb.metrics.filter(m => m.tag === asset.tag).slice(-5);
      return {
        tag: asset.tag,
        model: asset.model,
        mdmStatus: asset.mdmStatus,
        telemetry
      };
    });

    return res.json({
      data: {
        employee: {
          id: employee.id,
          name: employee.name,
          role: employee.role,
          department: employee.department,
          assignedAssets: assets
        }
      }
    });
  }

  // Fallback default GraphQL response
  res.json({
    data: {
      message: "GraphQL Federation Endpoint simulation active.",
      postgresHealthy: true,
      mongoHealthy: true,
      influxHealthy: true
    }
  });
});

// ==========================================
// NEW ENTERPRISE ENDPOINTS
// ==========================================

// Simulated user accounts for login
const systemUsers = [
  { id: 'USR-001', username: 'admin',    password: 'aegis2026',  name: 'Tom Jason Umali',      role: 'hr-admin',           roleLabel: 'HR Admin',            email: 'admin@aegishealth.ph' },
  { id: 'USR-002', username: 'helpdesk', password: 'itdesk123',  name: 'Maria Santos',          role: 'it-helpdesk',        roleLabel: 'IT Helpdesk',         email: 'helpdesk@aegishealth.ph' },
  { id: 'USR-003', username: 'auditor',  password: 'audit@hp',   name: 'Roberto Cruz',          role: 'compliance-auditor', roleLabel: 'Compliance Auditor',  email: 'auditor@aegishealth.ph' },
  { id: 'USR-004', username: 'guest',    password: 'readonly',   name: 'Guest User',            role: 'guest',              roleLabel: 'Read-Only Guest',     email: 'guest@aegishealth.ph' }
];

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = systemUsers.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials. Please check your username and password.' });
  }
  // Return user info (no real JWT - simulated session)
  res.json({
    status: 'success',
    user: { id: user.id, name: user.name, role: user.role, roleLabel: user.roleLabel, email: user.email, username: user.username }
  });
});

// GET /api/compliance/summary
app.get('/api/compliance/summary', (req, res) => {
  const deployedAssets = postgres.assets.filter(a => a.ownerId && a.status === 'Deployed');
  const needsSanitization = postgres.assets.filter(a => a.status === 'Needs Sanitization');
  const wipedAssets = postgres.assets.filter(a => a.mdmStatus && a.mdmStatus.includes('Wiped'));
  const certCount = Object.keys(mongodb.wipeCertificates).length;
  const policyCount = Object.keys(mongodb.compliancePolicies).length;
  const activeEmpCount = postgres.employees.filter(e => e.status === 'Active').length;

  // Score: % of active employees with signed policy + % of needing-wipe assets with cert
  const policyScore = activeEmpCount > 0 ? Math.round((policyCount / activeEmpCount) * 100) : 100;
  const wipeScore = needsSanitization.length > 0 ? Math.round((certCount / (certCount + needsSanitization.length)) * 100) : 100;
  const overallScore = Math.round((policyScore + wipeScore) / 2);

  res.json({
    overallScore,
    policyScore,
    wipeScore,
    certCount,
    policyCount,
    needsSanitizationCount: needsSanitization.length,
    wipedCount: wipedAssets.length,
    deployedCount: deployedAssets.length,
    activeEmployees: activeEmpCount
  });
});

// GET /api/compliance/certificates
app.get('/api/compliance/certificates', (req, res) => {
  const certs = Object.entries(mongodb.wipeCertificates).map(([tag, cert]) => {
    const asset = postgres.assets.find(a => a.tag === tag);
    const owner = asset && asset.ownerId ? postgres.employees.find(e => e.id === asset.ownerId) : null;
    return {
      assetTag: tag,
      assetModel: asset ? asset.model : 'Unknown',
      employeeName: owner ? owner.name : 'Unassigned',
      uploadedAt: cert.uploadedAt,
      fileName: cert.fileName,
      fileSize: cert.fileSize,
      verified: cert.verified
    };
  });
  res.json(certs);
});

// GET /api/compliance/policies
app.get('/api/compliance/policies', (req, res) => {
  const policies = Object.entries(mongodb.compliancePolicies).map(([empId, policy]) => {
    const employee = postgres.employees.find(e => e.id === empId);
    return {
      employeeId: empId,
      employeeName: employee ? employee.name : 'Unknown',
      role: employee ? employee.role : 'Unknown',
      department: employee ? employee.department : 'Unknown',
      signedAt: policy.signedAt,
      version: policy.version,
      status: 'Signed'
    };
  });
  res.json(policies);
});

// GET /api/settings
app.get('/api/settings', (req, res) => {
  res.json({
    systemConfig: {
      postgres:  { host: 'aegis-pg.internal', port: 5432,  db: 'aegis_itam_core',  status: 'Connected' },
      mongodb:   { host: 'aegis-mongo.internal', port: 27017, db: 'aegis_compliance', status: 'Connected' },
      influxdb:  { host: 'aegis-influx.internal', port: 8086, bucket: 'itam_telemetry', status: 'Connected' },
      kafka:     { broker: 'kafka.aegis-internal:9092', topic: 'hr.employee.events', status: 'Active' },
      temporal:  { endpoint: 'temporal.aegis-internal:7233', namespace: 'aegis-itam', status: 'Active' }
    },
    mdmIntegrations: {
      jamf:   { enabled: true,  endpoint: 'https://aegishealth.jamfcloud.com', version: 'Jamf Pro 11.x' },
      intune: { enabled: false, endpoint: 'https://graph.microsoft.com/v1.0',  version: 'Microsoft Graph API v1.0' }
    },
    webhookSecrets: {
      bamboohr: { key: 'aegis-webhook-secret-key', masked: 'aegis-web***-secret-key' }
    },
    users: systemUsers.map(u => ({ id: u.id, name: u.name, username: u.username, role: u.role, roleLabel: u.roleLabel, email: u.email }))
  });
});

// Simulate FedEx PDF Return Label Download
app.get("/api/download/label/:employeeId", (req, res) => {
  const employee = postgres.employees.find(e => e.id === req.params.employeeId);
  const employeeName = employee ? employee.name : "Employee";
  
  res.setHeader('Content-Type', 'text/plain');
  res.send(`---------------------------------------------------------------------
                           FEDEX RETURN LABEL
  ---------------------------------------------------------------------
  FROM:
  Aegis Health Partners - Telehealth Operations
  Remote Address on Record
  Name: ${employeeName}
  
  TO:
  Aegis Health Partners HQ
  Clinical Operations ITAM Dept.
  100 Ayala Avenue, Makati City, Philippines
  
  CARRIER: FEDEX GROUND
  BILLING: SENDER (AEGIS HEALTH PARTNERS ACCOUNT #998231)
  
  TRACKING NUMBER: 40026889912083
  
  Please affix this label to the container containing your clinical diagnostics
  kit, remote laptops, and peripheral hardware, and drop it off at any authorized 
  FedEx collection location.
  ---------------------------------------------------------------------`);
});

// ==========================================
// 7. WEBSOCKET BROADCASTER UTILITIES
// ==========================================
function broadcastToClients(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function logSystemMessage(msg) {
  broadcastToClients({
    type: 'SYSTEM_MESSAGE',
    payload: `[${new Date().toLocaleTimeString()}] ${msg}`
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Start WebSocket connection listeners
wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected');
  
  // Send initial data to client
  ws.send(JSON.stringify({ type: 'KAFKA_LOG_HISTORY', payload: kafkaLogs }));
  ws.send(JSON.stringify({ type: 'TELEMETRY_BATCH', payload: influxdb.metrics.slice(-15) }));
  
  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected');
  });
});

// ==========================================
// 8. SERVER INITIALIZATION & START
// ==========================================
function prePopulateTelemetry() {
  const now = Date.now();
  const fiveSeconds = 5000;
  for (let i = 40; i > 0; i--) {
    const time = new Date(now - i * fiveSeconds).toISOString();
    postgres.assets.forEach(asset => {
      if (asset.ownerId && asset.status === "Deployed") {
        let cpuTemp = 50 + Math.floor(Math.random() * 20);
        let batteryHealth = 95 - (parseInt(asset.tag.slice(-3)) % 10) - Math.floor(Math.random() * 2);
        let memoryLoad = 40 + Math.floor(Math.random() * 20);
        
        influxdb.metrics.push({
          time,
          tag: asset.tag,
          model: asset.model,
          owner: postgres.employees.find(e => e.id === asset.ownerId)?.name || "Unknown",
          cpuTemp,
          batteryHealth,
          memoryLoad
        });
      }
    });
  }
}

// ==========================================
// HEALTH CHECK / KEEP-ALIVE ENDPOINT
// Used by UptimeRobot to prevent Render free-tier from sleeping
// ==========================================
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Aegis ITAM Middleware] Listening on http://localhost:${PORT}`);
  prePopulateTelemetry();
  startTelemetrySimulation();
});

