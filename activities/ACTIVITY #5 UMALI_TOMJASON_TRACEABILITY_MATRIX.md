# Activity 5: Traceability Matrix (Technology Decisions to Requirements)
**Company:** Aegis Health Partners  
**Author:** Tom Jason Umali  
**Course:** Master of Science in Information Technology (ASDI)  

---

## 1. Introduction & Context

This Traceability Matrix maps technology decisions and deployment configurations directly back to the business pain points and TO-BE processes defined in prior deliverables (**Activity #2: TO-BE Business Architecture** and **Activity #3: Data Architecture**). This mapping guarantees that every infrastructure component serves a specific business purpose and satisfies defined operational requirements.

---

## 2. Business Pain Point to Technology Solution Matrix

| Pain Point ID | Business Pain Point Description | Selected Technology Solution | Target Container Layer | Infrastructure / Hosting Placement | Business Value & Justification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P1** | Delayed HR onboarding for new clinical staff. | Event-driven integration webhook handlers. | API Gateway + API Application + MSK Kafka | Private App Subnet running on AWS EKS. | Event-driven architecture captures BambooHR webhook events instantly, eliminating manual entry delays. |
| **P3** | Poor mobile performance when scanning assets on the floor. | Global Edge Content Caching & Lightweight client bundles. | Admin Web App + S3 Storage + CloudFront CDN | AWS S3 Static Hosting and Global Edge CDN locations. | Reduces network latency for clinicians scanning asset tags from 2.5s to under 300ms. |
| **P5** | License over-purchasing and lack of tracking. | Real-time Elasticsearch index queries. | API Application + Search Engine | Elastic Cloud SaaS connected via PrivateLink. | Real-time lookup of software seats identifies unused licenses for immediate revocation, saving licensing costs. |
| **P7** | Assets not returned by departing employees. | Durable workflow orchestration pipelines. | API Application + Temporal Workflow Engine | Temporal Cloud SaaS connected via PrivateLink. | Orchestrates complex offboarding flows, automated notifications, and FedEx API shipping updates. |
| **P10** | Missing HIPAA device sanitization certificates. | Unstructured document attachment support. | API Application + MongoDB Document Store | MongoDB Atlas SaaS connected via PrivateLink. | Stores PDF compliance sanitization certificates directly in the asset metadata folder to ensure regulatory compliance. |

---

## 3. TO-BE Process to Deployment Mapping Matrix

| TO-BE Process Flow | System Support Layer | deployment Component | Subnet Placement | Security / Traffic Restriction Policy |
| :--- | :--- | :--- | :--- | :--- |
| **1.0 User Synchronization** | HRIS Webhook → Kong Ingress Gateway | API Gateway + API Application | Private Application Subnet (`10.0.2.0/24`) | Inbound restricted strictly to HTTPS (443) forwarded by the public ALB. |
| **2.0 Asset Intake & Tagging** | Coupa Purchase Order event consumer | API Application + Core Database | Private Data Subnet (`10.0.3.0/24`) | DB writes restricted to incoming requests from `sg-app`. No direct internet ingress. |
| **3.0 Asset Allocation** | Clinician mobile scan request | Kong API Gateway + API Application | Private Application Subnet (`10.0.2.0/24`) | Gateway authorizes requests using JWT token verification before forwarding to API app. |
| **4.0 Asset Offboarding** | Offboarding trigger → Temporal state track | API Application + Temporal Cloud | Private SaaS Subnet (`10.0.4.0/24`) | Outbound-only connectivity to Temporal Cloud endpoints over AWS PrivateLink. |
| **5.0 Compliance Audits** | Document Store query → Audit Search Index | MongoDB Atlas + Elastic Search | Private SaaS Subnet (`10.0.4.0/24`) | Encrypted VPC interface endpoints restrict access to designated SaaS instances. |
