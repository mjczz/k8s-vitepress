# Kubernetes 项目分析 - 01: 项目概览

**项目路径**: `~/work/todo/kubernetes`
**分析日期**: 2026-02-09
**当前版本**: v1.36.0-alpha.0
**Go 版本**: 1.25.6
**官方文档**: https://kubernetes.io

---

## 项目简介

Kubernetes (K8s) 是一个开源系统，用于在多台主机上管理容器化应用。它提供了部署、维护和扩展应用程序的基本机制。

**核心特点：**
- 基于 Google Borg 系统 15 年的生产经验
- 云原生计算基金会 (CNCF) 托管项目
- 提供基本的机制：部署、维护、扩展
- 支持跨多主机的容器化应用管理

---

## 项目结构概览

```
kubernetes/
├── cmd/                 # 所有二进制文件的入口点
├── pkg/                 # 核心库和业务逻辑
├── api/                 # API 定义和规范
├── staging/             # 阶段性代码（准备发布的库）
├── test/                # 测试代码
├── build/               # 构建系统和工具
├── hack/                # 辅助脚本和工具
├── cluster/             # 集群启动脚本
├── docs/                # 文档
└── vendor/              # 第三方依赖
```

---

## 核心二进制组件 (cmd/)

### 控制平面组件

1. **kube-apiserver** - API Server
   - 集群的统一入口
   - 处理所有 REST 操作
   - 验证和配置数据

2. **kube-controller-manager** - 控制器管理器
   - 运行所有控制器
   - 确保集群状态符合期望
   - 包含多个子控制器

3. **kube-scheduler** - 调度器
   - 负责将 Pod 调度到合适的节点
   - 基于资源需求和约束
   - 支持可扩展调度策略

### 节点组件

4. **kubelet** - 节点代理
   - 在每个节点上运行
   - 管理 Pod 生命周期
   - 与容器运行时交互

5. **kube-proxy** - 网络代理
   - 维护网络规则
   - 实现 Service 负载均衡
   - 处理网络转发

### 管理工具

6. **kubectl** - 命令行工具
   - 管理集群的主要 CLI
   - 部署、调试、监控

7. **kubeadm** - 集群引导工具
   - 快速启动 Kubernetes 集群
   - 简化集群初始化

---

## 核心库模块 (pkg/)

### 1. API 相关

```
pkg/api/
├── endpoints/          # Endpoints 资源
├── job/                # Job 资源
├── node/               # Node 资源
├── persistentvolume/   # PV 资源
├── persistentvolumeclaim/ # PVC 资源
├── pod/                # Pod 资源
├── service/            # Service 资源
└── storage/            # 存储相关
```

### 2. API 组 (apis/)

```
pkg/apis/
├── core/               # 核心 API (v1)
├── apps/               # 应用 API (Deployment, StatefulSet)
├── batch/              # 批处理 API (Job, CronJob)
├── autoscaling/        # 自动扩展 (HPA)
├── networking/         # 网络 API
├── storage/            # 存储 API
├── admission/          # 准入控制
├── authentication/     # 认证
├── authorization/      # 授权
├── rbac/              # 基于角色的访问控制
└── scheduling/         # 调度 API
```

### 3. 控制器 (controller/)

```
pkg/controller/
├── deployment/         # Deployment 控制器
├── replicaset/          # ReplicaSet 控制器
├── statefulset/        # StatefulSet 控制器
├── daemon/             # DaemonSet 控制器
├── job/                # Job 控制器
├── cronjob/            # CronJob 控制器
├── endpoint/           # Endpoint 控制器
├── endpointslice/      # EndpointSlice 控制器
├── namespace/          # Namespace 控制器
├── nodeipam/           # Node IPAM 控制器
├── nodelifecycle/      # Node 生命周期控制器
├── garbagecollector/   # 垃圾回收控制器
├── serviceaccount/     # ServiceAccount 控制器
└── podgc/              # Pod 垃圾回收
```

### 4. 调度器 (scheduler/)

```
pkg/scheduler/
├── framework/          # 调度框架
├── profile/            # 调度配置文件
├── backend/            # 调度后端
├── metrics/            # 指标
└── util/               # 工具函数
```

### 5. Kubelet (kubelet/)

```
pkg/kubelet/
├── container/          # 容器管理
├── configmap/          # ConfigMap 管理
├── secret/             # Secret 管理
├── volume/             # 卷管理
├── eviction/           # 驱逐管理
├── images/             # 镜像管理
├── checkpointmanager/  # 检查点管理
└── cm/                 # 配置管理
```

---

## API 定义 (api/)

```
api/
├── api-rules/          # API 规则
├── discovery/          # API 发现
└── openapi-spec/       # OpenAPI 规范
    ├── swagger.json    # Swagger 定义
    └── v3/             # OpenAPI v3 规范
```

---

## 构建系统

### 主要构建目标

```makefile
make                    # 构建所有组件
make quick-release      # 快速发布构建
make release            # 完整发布构建
make test-integration   # 集成测试
make test-e2e-node      # E2E 节点测试
make clean              # 清理构建产物
```

### 构建方式

1. **Go 环境构建**
```bash
git clone https://github.com/kubernetes/kubernetes
cd kubernetes
make
```

2. **Docker 环境构建**
```bash
git clone https://github.com/kubernetes/kubernetes
cd kubernetes
make quick-release
```

---

## 项目特点

### 1. 微服务架构
- 每个组件都是独立的二进制文件
- 通过 REST API 通信
- 高度模块化

### 2. 控制器模式
- 期望状态 vs 实际状态
- 声明式配置
- 自动 reconciliation

### 3. 可扩展性
- 自定义资源定义 (CRD)
- 自定义控制器
- 准入控制器 (Admission Controllers)
- 调度器扩展

### 4. 云原生
- 容器化应用
- 自动伸缩
- 自愈能力
- 服务发现和负载均衡

---

## 核心概念

1. **Pod** - 最小部署单元
2. **Node** - 工作节点
3. **Service** - 服务发现和负载均衡
4. **Deployment** - 无状态应用部署
5. **StatefulSet** - 有状态应用部署
6. **DaemonSet** - 守护进程集
7. **Job/CronJob** - 批处理任务
8. **ConfigMap/Secret** - 配置和敏感数据
9. **PV/PVC** - 持久化存储
10. **Namespace** - 资源隔离

---

## 关键技术栈

- **语言**: Go 1.25.6
- **API**: REST + gRPC
- **存储**: etcd (键值存储)
- **网络**: CNI (Container Network Interface)
- **容器运行时**: CRI (Container Runtime Interface)
- **存储**: CSI (Container Storage Interface)

---

## 项目规模

- **总文件数**: 41 个顶层目录
- **Go 依赖**: go.sum 包含 49295 行
- **API 定义**: 多个 API 组和版本
- **控制器**: 20+ 内置控制器
- **测试**: 完整的单元测试、集成测试、E2E 测试

---

## 开发流程

1. **开发文档**: https://git.k8s.io/community/contributors/devel
2. **社区指南**: https://git.k8s.io/community
3. **治理**: https://github.com/kubernetes/community/blob/master/governance.md
4. **增强提案**: https://github.com/kubernetes/enhancements
5. **问题追踪**: GitHub Issues
6. **代码审查**: GitHub Pull Requests

---

## 下一步分析计划

1. **API Server 架构** - REST 处理、认证、授权、准入控制
2. **Controller Manager** - 控制器框架、Reconciliation 循环
3. **Scheduler** - 调度算法、Predicates、Priorities
4. **Kubelet** - Pod 生命周期、容器运行时接口
5. **etcd 集成** - 状态存储、watch 机制
6. **网络模型** - Service、Ingress、CNI
7. **存储机制** - PV/PVC、StorageClass、CSI
8. **API 设计** - 版本控制、CRD、Conversion Webhook

---

## 参考资料

- 官方文档: https://kubernetes.io
- 社区仓库: https://git.k8s.io/community
- 开发者文档: https://git.k8s.io/community/contributors/devel
- 增强提案: https://github.com/kubernetes/enhancements
- Go 代码: https://github.com/kubernetes/kubernetes

---

**分析完成时间**: 2026-02-09
**分析人员**: 小宝
**下一步**: 分析 API Server 架构
