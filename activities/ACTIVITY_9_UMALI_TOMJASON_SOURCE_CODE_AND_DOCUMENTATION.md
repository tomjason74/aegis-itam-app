# Activity 9: Source Code & Documentation
**Company:** Aegis Health Partners  
**Author:** Tom Jason Umali  
**Course:** Master of Science in Information Technology (ASDI)  

---

## Executive Summary

This document presents the complete **Source Code & Documentation** deliverable for the **Aegis Health Partners IT Asset Management (ITAM)** system. It covers the customization scope, source code repository structure, a detailed deployment guide (local, Docker, and AWS Cloud environments), REST and WebSocket API documentation, and a detailed testing report validating the middleware capabilities.

---

## 1. Customization Scope

The prototype represents a custom-developed middleware and frontend single-page application built to address the IT asset management and compliance lifecycle needs of Aegis Health Partners. 

### 1.1 Customization Tier and Architecture
- **Complexity Tier:** Deployed under Tier 3 (Advanced Stack) parameters.
- **Backend Architecture:** Node.js + Express.js HTTP and WebSocket servers.
- **Frontend Architecture:** Vanilla HTML5 / CSS3 / JS Single Page Application featuring a responsive glassmorphism UI.
- **Polyglot Persistence Layer:** Simulated multi-database persistence mapping directly to the production specifications:
  - **Relational Storage (PostgreSQL Mock):** Relational tables tracking `employees`, hardware `assets`, and Coupa `procurementOrders` with foreign-key relationships.
  - **Document Storage (MongoDB Mock):** Document registry tracking HIPAA cryptographic wipe certificates and signed Acceptable Use Policies.
  - **Time-Series Storage (InfluxDB Mock):** Columnar data collection tracking live CPU temperatures and battery health metrics streamed from remote diagnostic kits.
- **Asynchronous Integrations:**
  - **Apache Kafka Mock:** Pub-Sub event loop utilizing **AJV (Another JSON Validator)** to compile and enforce strict event payload formats.
  - **Temporal Workflow Engine Mock:** A durable async state machine driving the 5-step employee offboarding process with automated retries, error simulation, and callback triggers.

---

## 2. Source Code Repository

The project codebase is hosted on GitHub, serving as the central delivery platform for review.

- **Repository Link:** [https://github.com/tomjason74/aegis-itam-app.git](https://github.com/tomjason74/aegis-itam-app.git)
- **Primary Branch:** `master`
- **Collaboration Branch Structure:**
  - `master`: Production release-ready codebase containing verified releases.
  - `staging`: Integration testing branch matching pre-production environments.
  - `feature/*`: Granular topic branches used for individual code updates and pull requests.
- **Commit History Standard:** Adheres to **Conventional Commits** (e.g., `feat:`, `fix:`, `refactor:`, `docs:`) to facilitate change tracking and automate semantic versioning.

---

## 3. Deployment Guide

### 3.1 Local Deployment (Node.js Only)
For bare-metal local evaluation using high-fidelity database simulators:
1. Navigate to the application root directory:
   ```bash
   cd aegis-itam-app
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Launch the server:
   ```bash
   npm start
   ```
4. Access the web client at [http://localhost:3000](http://localhost:3000).

### 3.2 Containerized Multi-Database Deployment (Docker Compose)
For running the application backed by real containerized database instances:
1. Spin up the containers:
   ```bash
   docker-compose up -d
   ```
2. Verify running containers:
   ```bash
   docker-compose ps
   ```
3. Run the Node.js application server:
   ```bash
   npm start
   ```
4. Tear down database services:
   ```bash
   docker-compose down -v
   ```

### 3.3 Windows Desktop Utility Scripts
- **`🚀 Launch Aegis ITAM.vbs`**: Launches the server in the background and opens the UI in the default browser.
- **`🛑 Stop Aegis ITAM.vbs`**: Searches system tasks and stops the background node process.

### 3.4 Production Cloud Deployment Architecture (AWS)
In production, the platform is hosted on AWS Singapore (`ap-southeast-1`) with the following steps:
1. **Virtual Private Cloud (VPC)**: Set up a custom VPC (`10.0.0.0/16`) divided into public subnets (ALB, NAT Gateways), private application subnets (EKS cluster node group), private data subnets (Multi-AZ RDS PostgreSQL and MSK Kafka), and private SaaS subnets (AWS PrivateLink interfaces for MongoDB Atlas, Elastic Cloud, and Temporal Cloud namespaces).
2. **Database Provisioning**:
   - RDS PostgreSQL Multi-AZ instance on `db.t3.large` with `gp3` storage auto-scaling.
   - MongoDB Atlas M30 replica set peering via PrivateLink on port `27017`.
   - MSK Kafka instance on `kafka.t3.small` nodes withGP3 storage.
3. **EKS Orchestration**: Deploy Kong API Gateway pods and containerized FastAPI/Python workloads on AWS EKS using Horizontal Pod Auto-scaling (HPA).
4. **Edge CDN Delivery**: Host the compiled static frontend SPA assets inside an AWS S3 bucket delivered globally via Amazon CloudFront.

---

## 4. API Documentation

### 4.1 RESTful API Catalog

| Method | Endpoint | Description | Auth Type | Access Role |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Authenticates user credentials, returns user details | None | Public |
| `POST` | `/api/webhooks/bamboohr` | Ingests employee events (Hires / Terminations) | HMAC-SHA256 | HR Admin / External |
| `GET` | `/api/assets` | Retrieves the hardware asset registry | Cookie / Session | All Roles |
| `POST` | `/api/assets/:tag/wipe-certificate` | Uploads a sanitization cert for a returned asset | Cookie / Session | IT Helpdesk |
| `GET` | `/api/employees` | Retrieves the employee directory | Cookie / Session | All Roles |
| `GET` | `/api/workflows` | Retrieves the status of active offboarding workflows | Cookie / Session | All Roles |
| `GET` | `/api/procurement/orders` | Retrieves active hardware purchase orders | Cookie / Session | All Roles |
| `POST` | `/api/telemetry/inject` | Injects metric anomalies to test predictive AI models | Cookie / Session | HR Admin |
| `GET` | `/api/compliance/summary` | Calculates overall HIPAA compliance percentages | Cookie / Session | Auditor + |
| `POST` | `/api/graphql` | GraphQL gateway query for federated diagnostics | Cookie / Session | Helpdesk + |
| `GET` | `/api/download/label/:empId` | Downloads return shipping PDF label | Cookie / Session | All Roles |
| `GET` | `/ping` | Health check route | None | Public |

### 4.2 WebSocket Event Protocol

| Message Type | Direction | Payload Description |
| :--- | :--- | :--- |
| `SYSTEM_MESSAGE` | Server → Client | Streaming real-time alerts and console logging |
| `KAFKA_EVENT` | Server → Client | Event envelope broadcast on broker topics |
| `WORKFLOW_UPDATE`| Server → Client | Live offboarding step progression data |
| `TELEMETRY_BATCH`| Server → Client | 15-point batch of device telemetry for Chart.js rendering |
| `DATA_REFRESH`   | Server → Client | Broad mutation notify signaling a data table refresh |

---

## 5. Testing Report

### 5.1 Automated Integration Tests
The middleware includes a complete integration test runner (`test/integration.test.js`) executing 12 comprehensive scenarios checking core API routes, security barriers, and validations.

To run the automated tests:
```bash
npm test
```

### 5.2 Test Execution Results
The test runner executes synchronously on local port `3001` and closes the process automatically on completion:

```text
Starting Aegis ITAM Middleware server on port 3001 for integration tests...
Server started successfully! Beginning test execution...

✅ TEST PASSED: GET /ping (Health Check)
✅ TEST PASSED: POST /api/auth/login (Success)
✅ TEST PASSED: POST /api/auth/login (Failure)
✅ TEST PASSED: POST /api/webhooks/bamboohr (Missing Signature)
✅ TEST PASSED: POST /api/webhooks/bamboohr (Spoofed Signature)
✅ TEST PASSED: POST /api/webhooks/bamboohr (HMAC Mismatch)
✅ TEST PASSED: POST /api/webhooks/bamboohr (Success Termination Event)
[Server Stderr] [Kafka Validation Fail] EmployeeHiredEvent: /name must NOT have fewer than 3 characters
✅ TEST PASSED: POST /api/webhooks/bamboohr (JSON Schema Failure on Hire)
✅ TEST PASSED: POST /api/webhooks/bamboohr (JSON Schema Success on Hire)
✅ TEST PASSED: GET /api/assets (Retrieve Registry)
✅ TEST PASSED: POST /api/assets/:tag/wipe-certificate (Upload Certificate)
✅ TEST PASSED: POST /api/graphql (Query Federated Employee Diagnostics)

----------------------------------------
Execution complete. Passed: 12/12, Failed: 0
----------------------------------------
All tests completed successfully. Integration verification passed!
```

### 5.3 Test Assertions Analysis
- **Security Check:** Verified that webhook calls lacking valid HMAC-SHA256 signatures are blocked with `HTTP 401 Unauthorized`, while authentic payloads are successfully processed.
- **Contract Enforcement:** Schema validation via AJV correctly blocked an invalid event payload (name too short) with `HTTP 400 Bad Request` while allowing compliant payloads to proceed.
- **State Integrity:** Uploading an asset's wipe certificate correctly changed the asset state in the database, unassigned the user, and updated any listening Temporal offboarding workflows.
- **Federated Queries:** The GraphQL server resolved queries linking PostgreSQL records with InfluxDB telemetry structures into a single response.

### 5.4 Known Issues & Constraints
- **Session Duration:** Login state uses memory storage. Refreshing the browser resets the login session, requiring authentication again.
- **Local Telemetry Queue:** Telemetry events in memory are limited to a rolling queue of `500` entries to prevent unbounded heap growth during prolonged execution.
- **Hardware Telemetry Timing:** Telemetry streams updates every `5` seconds; real-time charts show visual changes every interval.
