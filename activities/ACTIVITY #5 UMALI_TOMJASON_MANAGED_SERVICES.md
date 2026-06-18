# Activity 5: Managed Services Selection and Justification
**Company:** Aegis Health Partners  
**Author:** Tom Jason Umali  
**Course:** Master of Science in Information Technology (ASDI)  

---

## 1. Introduction & Strategy

This document details the managed services strategy and detailed justifications for the **Aegis Health Partners IT Asset Management (ITAM)** infrastructure deployment. 

Adopting a **Managed Services First** approach allows Aegis Health Partners to offload the heavy lifting of infrastructure maintenance—such as database replication, backup scheduling, vulnerability patching, and cluster coordination—to specialized cloud providers. This ensures compliance with standard SLAs, keeps resource costs predictable, and frees engineering teams to focus on core domain application logic.

---

## 2. Managed Services Comparison and Selection

The table below contrasts the selected managed services against their self-hosted equivalents on raw cloud compute instances (e.g., AWS EC2), detailing the operational savings and technical rationales.

| Component / Container | Self-Hosted Option (EC2 / VM) | Selected Managed Service | Operational Time Savings | Technical & Business Justification |
| :--- | :--- | :--- | :--- | :--- |
| **Relational Database** | PostgreSQL Server installed manually on EC2 instances. | **AWS RDS PostgreSQL** | ~20 hours / month | * RDS automates minor version patching and OS security upgrades. <br>* Provides automated daily snapshot management with 30-day retention policies.<br>* Out-of-the-box Multi-AZ deployment replicates data synchronously, enabling auto-failover in under 120 seconds. |
| **NoSQL Document Store** | MongoDB Replica Set hosted on EC2 with manual EBS mappings. | **MongoDB Atlas on AWS** | ~15 hours / month | * Atlas manages secondary synchronization, replication lag, and node heartbeats automatically.<br>* Handles data volume sharding natively when collections grow beyond thresholds.<br>* Standardizes end-to-end TLS 1.3 connectivity and encryption-at-rest keys. |
| **Message Broker** | Apache Kafka & Apache ZooKeeper clusters on EC2 nodes. | **AWS MSK (Managed Streaming for Kafka)** | ~25 hours / month | * Eliminates the risk of ZooKeeper quorum loss or Kafka broker synchronization failures.<br>* Automates disk expansion and broker node replacements.<br>* Natively integrates with AWS KMS and IAM role-based authentication. |
| **Search Engine** | Elasticsearch & Kibana custom clusters on EC2 instance groups. | **Elastic Cloud (SaaS on AWS)** | ~10 hours / month | * Simplifies index lifecycle management (ILM) for archiving historical records.<br>* Automatically provisions dedicated master nodes.<br>* Seamlessly hosts Kibana dashboards without manual web server setups. |
| **Workflow Engine** | Temporal Server, Web UI, and schemas on EC2 database resources. | **Temporal Cloud (SaaS)** | ~30 hours / month | * Guarantees a **99.99% workflow execution uptime SLA**.<br>* Removes the operational burden of managing and scaling the Cassandra/PostgreSQL storage engines required for Temporal's state history.<br>* Allows developers to focus strictly on building workflow code. |
| **Container Orchestration** | Kubernetes control plane and master nodes on EC2 (via kops). | **AWS EKS (Elastic Kubernetes Service)** | ~30 hours / month | * AWS manages control plane availability, API server upgrades, and master node patching.<br>* Integrates Kubernetes service accounts with AWS IAM roles (IRSA) for secure credential scoping. |

---

## 3. Total Operational Savings

By selecting managed services instead of managing these layers manually, the operational savings for the ITAM administration team are estimated as follows:

* **EKS Administration:** Saves **~30 hours/month**
* **Temporal State Engine:** Saves **~30 hours/month**
* **MSK Kafka Tuning:** Saves **~25 hours/month**
* **RDS PostgreSQL Maintenance:** Saves **~20 hours/month**
* **MongoDB Atlas Administration:** Saves **~15 hours/month**
* **Elastic Search Index Lifecycle Management:** Saves **~10 hours/month**

**Total Administrative Overhead Saved:** **~130 Engineering Hours per Month**

This savings directly translates to lower operational risks, minimized downtime, and faster delivery cycles for the ITAM software deliverables.
