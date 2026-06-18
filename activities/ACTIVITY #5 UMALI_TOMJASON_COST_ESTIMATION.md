# Activity 5: Cost Estimation and Budget Analysis
**Company:** Aegis Health Partners  
**Author:** Tom Jason Umali  
**Course:** Master of Science in Information Technology (ASDI)  

---

## 1. Executive Summary & Sizing Strategy

This document provides the cost estimation and monthly budget projections for running the **Aegis Health Partners IT Asset Management (ITAM)** infrastructure in the **AWS Singapore Region (`ap-southeast-1`)** and partnered SaaS environments.

The budgeting model is built around a **Developer-first Staged Launch** framework:
* **Development/Staging Environment:** Low-footprint, non-HA, utilizing Spot compute nodes and single-instance databases to minimize costs.
* **Production Environment (Pilot Stage):** Multi-AZ configuration for critical databases, but optimized using Spot nodes for stateless compute. Enterprise security add-ons like AWS Shield Advanced are deferred until the enterprise scale phase.

---

## 2. Production Environment Monthly Cost Estimation

The following matrix represents the estimated monthly run rate for a production pilot deployment in the Singapore region:

| Service Category | Cloud Component / SaaS Platform | Sizing Configuration Details | Quantity | Monthly Cost (USD) | Annual Cost (USD) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Compute** | AWS EKS Control Plane | Managed Kubernetes cluster SLA | 1 | $72.00 | $864.00 |
| **Compute** | EKS Worker Nodes (App Tier) | `t3.large` instances (Spot, 2vCPU/8GB) | 3 | $105.00 | $1,260.00 |
| **Compute** | EKS Worker Nodes (Worker Tier) | `t3.medium` instances (Spot, 2vCPU/4GB) | 2 | $35.00 | $420.00 |
| **Databases** | AWS RDS PostgreSQL | `db.t3.large` Multi-AZ GP3 (100GB initial storage) | 1 | $150.00 | $1,800.00 |
| **Databases** | RDS Backup Tier | GP3 snapshot storage (100GB allocation) | 1 | $10.00 | $120.00 |
| **Databases** | MongoDB Atlas (SaaS) | M30 Cluster Tier (Multi-AZ, 3 replica nodes) | 1 | $300.00 | $3,600.00 |
| **Integration** | AWS MSK (Apache Kafka) | `kafka.t3.small` broker instances (3 AZs) | 1 | $150.00 | $1,800.00 |
| **Integration** | MSK EBS Volumes | GP3 storage volumes (100GB per broker node) | 3 | $30.00 | $360.00 |
| **Integration** | Temporal Cloud (SaaS) | Standard Tier (100K workflow runs included) | 1 | $150.00 | $1,800.00 |
| **Networking** | Application Load Balancer (ALB) | Web ingress routing & health pings | 1 | $22.00 | $264.00 |
| **Networking** | NAT Gateways | Managed NAT traffic instances | 2 | $64.00 | $768.00 |
| **Networking** | Data Outbound & CloudFront CDN | 1TB Edge edge egress + transfer bandwidth | Variable | $175.00 | $2,100.00 |
| **Security** | AWS WAF + Shield Standard | Layer 7 request inspection & DDoS protection | 1 | $25.00 | $300.00 |
| **TOTAL RUN RATE**| | | | **$1,288.00** | **$15,456.00** |

---

## 3. Cost Optimization Strategies

To maintain structural budget control, the following optimization guidelines are implemented:

1. **Spot Instances for EKS Compute (Saves ~60% compute cost):**
   * Using EKS managed spot node groups for stateless API and compliance containers rather than On-Demand nodes. State is preserved in databases, making pod termination safe.
2. **Decommit AWS Shield Advanced (Saves $3,000/month):**
   * Standard Shield protection is free and handles typical DDoS attacks. Shield Advanced is excluded from initial budgets.
3. **Reserved Database Instances (Saves ~30% database cost):**
   * Purchasing a 1-year RDS Reserved Instance commitment for the primary PostgreSQL database once pilot stability is achieved.
4. **Temporal Cloud vs. Self-Hosted Server Infrastructure:**
   * Hosting Temporal clusters, logging engines, and persistent state DBs requires large dedicated virtual machines. Subscribing to Temporal Cloud saves approximately **$450/month** in raw server overhead and licensing.

---

## 4. Multi-Environment Budget Summary

To support the staging lifecycle, three environment tiers are budgeted:

* **Development Environment (~$340/month):**
  * Single-node EKS dev groups, single-instance RDS database (No Multi-AZ), MongoDB Atlas Shared Tier, and mock workflow engines.
* **Staging Environment (~$650/month):**
  * Mimics production compute nodes, uses smaller instance sizing for DBs (`db.t3.medium` single-AZ), and shared MSK streams.
* **Production Environment (~$1,288/month):**
  * Full Multi-AZ configuration as detailed in Section 2.
