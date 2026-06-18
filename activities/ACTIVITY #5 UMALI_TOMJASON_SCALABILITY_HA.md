# Activity 5: Scalability and High Availability Design
**Company:** Aegis Health Partners  
**Author:** Tom Jason Umali  
**Course:** Master of Science in Information Technology (ASDI)  

---

## 1. Executive Summary & Design Principles

This document presents the Scalability, High Availability (HA), and Disaster Recovery (DR) design for the **Aegis Health Partners IT Asset Management (ITAM)** ecosystem. 

To satisfy the target service level agreement of **99.95% system uptime**, the architecture avoids any single point of failure (SPOF) by leveraging redundant cloud infrastructure distributed across multiple availability zones, coupled with auto-scaling software configurations.

---

## 2. Component Scalability Matrix

The system implements scaling models tailored to the operational demands of each layer:

| System Component | Scaling Model | Trigger / Metric | Minimum Replicas | Maximum Replicas | Action Plan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Admin Web App** | Global CDN Edge | Serverless Static Delivery | N/A | N/A | Cached across CloudFront Edge locations. Scales to handle concurrent user spikes automatically. |
| **API Gateway (Kong)** | Horizontal (HPA) | CPU > 60% or Requests > 500 req/sec | 3 Pods | 10 Pods | Spreads gateway pods across availability zones ap-southeast-1a/b/c. |
| **API Application** | Horizontal (HPA) | CPU > 70% or Memory > 80% | 3 Pods | 20 Pods | Deploys containers on mixed EKS On-Demand and Spot instances. |
| **Compliance Service** | Horizontal (HPA) | Kafka queue lag > 100 messages | 2 Pods | 10 Pods | Scales up workers dynamically during heavy compliance certificate parsing. |
| **RDS PostgreSQL** | Vertical Storage & Read Replicas | CPU > 80% or Storage > 85% | 1 Primary 1 Standby | 1 Primary 5 Replicas | Scales storage space dynamically (auto-grow gp3). Offloads reporting queries to read replicas. |
| **MongoDB Atlas** | Horizontal Sharding | Storage > 80% or IOPS exhaustion | 3 Nodes | Unlimited (via Shards) | Automatically shards data segments based on location and asset grouping. |
| **MSK Kafka** | Horizontal Broker Scale | Broker storage utilization > 80% | 3 Brokers | 12 Brokers | Auto-expands storage; manually adds brokers to repartition topics. |

---

## 3. High Availability (HA) Architecture

The platform uses a Multi-Availability Zone (Multi-AZ) topology within the Singapore region:

* **Stateless Compute Layer:** API gateway, API backend, and worker services run as containerized pods managed by AWS EKS. Kubernetes Pod Anti-Affinity rules are applied to ensure pods are distributed evenly across physical failure domains:
  ```yaml
  affinity:
    podAntiAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchExpressions:
          - key: app
            operator: In
            values:
            - api-application
        topologyKey: "topology.kubernetes.io/zone"
  ```
* **Core Database (PostgreSQL):** Configured in Multi-AZ active-standby deployment. Writes are replicated synchronously from the primary database instance in `ap-southeast-1a` to the standby instance in `ap-southeast-1b`. Failover is automated via DNS route adjustment in less than 120 seconds.
* **Message Broker (MSK):** Distributed across three zones with a replication factor of 3 and `min.insync.replicas=2`. If an AZ fails, the client producers retry writing to the remaining brokers, preventing message loss.

---

## 4. Disaster Recovery (DR) Plan

To protect against region-wide outages or catastrophic data corruption, the system follows a tiered Disaster Recovery strategy:

| Tier | Priority level | Target RTO (Recovery Time) | Target RPO (Data Loss Window) | Backup & Replication Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | Critical Core Database (Postgres, Users) | < 1 Hour | < 5 Minutes | Continuous transaction log shipping (WAL) to secondary AWS region (`ap-southeast-2` Sydney) with point-in-time recovery logs kept for 30 days. |
| **Tier 2** | Important Document Stores & Assets (MongoDB, Elastic) | < 4 Hours | < 1 Hour | Cross-region replica sets and daily automated snapshots exported to S3 Glacier Deep Archive classes. |
| **Tier 3** | Normal Historical audit logs & telemetry | < 24 Hours | < 24 Hours | Weekly snapshots stored in local region S3 buckets with lifecycle deletion rules. |

### 4.1 Disaster Recovery Failover Procedure
In the event of a primary region collapse:
1. **Detection:** Route 53 Health Checks identify region unavailability.
2. **Infrastructure Rollout:** CI/CD pipelines use Terragrunt to deploy networking and compute resources into the Sydney failover VPC.
3. **Data Promotion:** Standby databases and replica sets in Sydney are promoted to primary instances.
4. **Traffic Re-route:** DNS records (`api.aegishealth.ph`) are updated to point to the new regional ALB.
