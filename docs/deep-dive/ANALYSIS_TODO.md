- [x] **Network Policy 实现深度分析** (`network-policy-implementation-deep-dive.md`) ✅ (19KB)
  - Network Policy 概述和作用
  - Network Policy Controller 架构
  - 规则评估引擎
  - IPTables/IPVS 实现细节
  - eBPF 网络策略
  - 规则匹配和排序
  - 性能优化
  - 最佳实践（默认策略、命名空间策略、限制出站流量、监控、故障排查）

---

## 第二阶段：核心机制（P1）

### 已完成（9/12）✅

#### 核心底层机制（4 个主题）
- [x] **容器运行时（CRI）深度分析** (`cri-runtime-deep-dive.md`) ✅ (22KB)
- [x] **资源管理器深度分析** (`resource-manager-deep-dive.md`) ✅ (19KB)
- [x] **Kubelet Pod Worker 深度分析** (`pod-worker-deep-dive.md`) ✅ (21KB)
- [x] **PLEG（Pod Lifecycle Event Generator）深度分析** (`pleg-deep-dive.md`) ✅ (15KB)

#### 核心机制（9 个主题）
- [x] **准入控制深度分析** (`admission-control-deep-dive.md`) ✅ (17KB)
- [x] **调度算法深度分析** (`scheduling-algorithm-deep-dive.md`) ✅ (23KB)
- [x] **Pod Security Admission 深度分析** (`pod-security-admission-deep-dive.md`) ✅ (15KB)
- [x] **Cluster Autoscaler 深度分析** (`cluster-autoscaler-deep-dive.md`) ✅ (15KB)
- [x] **CSI Volume Manager 深度分析** (`csi-volume-manager-deep-dive.md`) ✅ (13KB)
- [x] **Network Policy 实现深度分析** (`network-policy-implementation-deep-dive.md`) ✅ (19KB)

---

## 第三阶段：运维和高级特性（P2）

- [ ] **Service Account 和 Token 管理深度分析**
  - ServiceAccount 机制
  - Token 注入（Projected Volume、Downward API）
  - Token 轮换机制
  - Kubelet ServiceAccount Controller
  - OIDC 集成
  - Token 绑定和审计
  - **预计大小**：30-40KB

---

## 待分析主题（2/12）📋

### 第二阶段：核心机制（P1）

- [x] **Volume Manager 深度分析** (`volume-manager-deep-dive.md`) ✅ (30KB)
  - 卷管理接口
  - 卷挂载流程（Attach、Mount、Unmount、Detach）
  - 卷类型处理
  - 卷生命周期管理
  - 卷指标收集
  - 卷清理和回收
  - 最佳实践（卷类型选择、资源限制、存储类、监控、优化）

- [ ] **Service Account 和 Token 管理深度分析**
  - ServiceAccount 机制
  - Token 注入（Projected Volume、Downward API）
  - Token 轮换机制
  - Kubelet ServiceAccount Controller
  - OIDC 集成
  - Token 绑定和审计
  - **预计大小**：30-40KB

- [ ] **Device Manager 深度分析**
  - Device Plugin 接口（Allocate、List、GetDevicePluginOptions）
  - 设备注册和健康检查
  - 设备分配流程（Allocate → PreStartContainer → Register）
  - 设备资源管理（CPU、内存、GPU、FPGA、SR-IOV、RDMA）
  - NUMA 拓扑感知设备分配
  - 设备热插拔支持
  - **预计大小**：25-35KB
