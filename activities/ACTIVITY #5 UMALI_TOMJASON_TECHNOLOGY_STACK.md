# Activity 5: Technology Stack Selection Matrix
**Company:** Aegis Health Partners  
**Author:** Tom Jason Umali  
**Course:** Master of Science in Information Technology (ASDI)  

---

## 1. Introduction

This document details the Technology Stack Selection Matrix and Managed Services evaluation for the **Aegis Health Partners IT Asset Management (ITAM)** system. The technology stack has been selected to ensure compliance with healthcare standards (HIPAA/GDPR), achieve high availability (99.95% SLA), and leverage cloud-native services to minimize operational overhead.

---

## 2. Technology Stack Selection Matrix

The following matrix documents the selection of technologies forming the backbone of the ITAM deployment:

| System Layer / Container | Selected Technology | Version | Key Capability / Description | Alternatives Considered | Selection Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cloud Provider** | AWS (Amazon Web Services) | N/A | Core Infrastructure Hosting | Microsoft Azure, Google Cloud Platform (GCP) | Offers the most mature compliance footprint in the Singapore region (`ap-southeast-1`), with superior support for managed integrations like RDS and MSK. |
| **Orchestration / Compute** | AWS EKS (Elastic Kubernetes Service) | 1.28 | Containerized application management and pod scaling | AWS ECS, AWS Fargate, Self-Managed K8s | EKS ensures container portability, avoids vendor lock-in, and offers native horizontal pod scaling needed for microservices. |
| **API Gateway** | Kong API Gateway | 3.4 | Dynamic routing, SSL termination, and rate limiting | AWS API Gateway, NGINX | Kong is highly optimized for Kubernetes ingress, supports custom plugins for security/tracing, and easily scales with low resource footprint. |
| **Core Database** | AWS RDS PostgreSQL | 15.x | Relational engine for transactional asset data | Amazon Aurora PostgreSQL, self-hosted MySQL | RDS provides ACID-compliant transactions with Multi-AZ automatic replication at a lower entry cost than Aurora for the initial rollout. |
| **Document Store** | MongoDB Atlas | 6.x | Unstructured storage for asset metadata, logs, and compliance forms | AWS DynamoDB, Couchbase | MongoDB Atlas provides seamless document querying, auto-sharding, and runs natively on AWS without proprietary lock-in. |
| **Message Broker** | AWS MSK (Apache Kafka) | 3.x | Event-streaming pipeline for real-time integrations | RabbitMQ, AWS SQS | Handles high-throughput event logs and HR system sync events with guaranteed message durability and ordering. |
| **Search Engine** | Elastic Cloud on AWS | 8.x | Full-text asset searching and audit log index | OpenSearch, Algolia | Offers superior out-of-the-box support for Kibana visualization dashboards and index lifecycle management. |
| **Workflow Engine** | Temporal Cloud | Latest | State-tracking for long-running workflows (device returns, logistics) | AWS Step Functions, Camunda | Temporal manages complex workflow retries, state recovery, and external human-in-the-loop triggers natively in code. |
| **Web Frontend** | React.js | 18.x | SPA framework for administrative dashboards | Angular, Vue.js | Broad developer ecosystem, efficient virtual DOM rendering, and seamless component library integrations. |
| **Mobile Frontend** | React Native | Latest | Cross-platform framework for clinician asset scanner app | Flutter, Swift/Kotlin | Allows shared codebases between iOS/Android and integrates natively with device camera scanners. |

---

## 3. Managed Services Justification Matrix

Using managed services reduces the administrative burden on Aegis Health Partners' IT team. The table below justifies the selection of managed platforms over self-hosting.

| Container / Service | Self-Hosted Option (EC2) | Managed Offering | Estimated Operational Savings | Technical Justification |
| :--- | :--- | :--- | :--- | :--- |
| **Relational Database** | PostgreSQL on EC2 | **AWS RDS PostgreSQL** | 20 hours / month | Automates minor patching, backups, point-in-time recovery, and handles Multi-AZ standby failover in < 120 seconds. |
| **Document Store** | MongoDB Community on EC2 | **MongoDB Atlas** | 15 hours / month | Abstracts cluster sharding, storage auto-scaling, key rotation, and VPC peering configurations. |
| **Message Broker** | Kafka & ZooKeeper on EC2 | **AWS MSK (Kafka)** | 25 hours / month | Replaces manually configured brokers, partition rebalancing, and ZooKeeper patch cycles with a managed API. |
| **Search Engine** | Elasticsearch on EC2 | **Elastic Cloud** | 10 hours / month | Integrates Kibana, automates index snapshots, and handles hot/warm data tier movements automatically. |
| **Workflow Engine** | Temporal Server on EC2 | **Temporal Cloud** | 30 hours / month | Eliminates the need to maintain, patch, and monitor the Temporal service control plane, ensuring 99.99% workflow SLA. |
| **Kubernetes Control Plane** | K8s on EC2 (kops) | **AWS EKS** | 30 hours / month | Manages control plane master nodes, security updates, and integrates directly with AWS IAM. |
