# Kubernetes 项目分析 - 03: Controller Manager

**项目路径**: `~/work/todo/kubernetes`
**分析日期**: 2026-02-09
**组件**: kube-controller-manager
**位置**: `cmd/kube-controller-manager/`

---

## Controller Manager 概述

Controller Manager 运行所有 Kubernetes 控制器，是控制平面的"大脑"，负责确保集群状态符合期望状态。

**核心职责：**
1. 运行所有内置控制器
2. 监听资源变化
3. 执行 reconciliation 循环
4. 维护集群状态

---

## 目录结构

```
cmd/kube-controller-manager/
└── app/                         # Controller Manager 应用逻辑
    ├── controllermanager.go    # 主入口
    ├── config.go               # 配置管理
    └── options.go              # 命令行选项

pkg/controller/                  # 所有控制器实现
├── deployment/                 # Deployment 控制器
├── replicaset/                 # ReplicaSet 控制器
├── statefulset/                # StatefulSet 控制器
├── daemon/                     # DaemonSet 控制器
├── job/                        # Job 控制器
├── cronjob/                    # CronJob 控制器
├── namespace/                  # Namespace 控制器
├── nodeipam/                   # Node IPAM 控制器
├── nodelifecycle/              # Node 生命周期控制器
├── endpoint/                   # Endpoint 控制器
├── endpointslice/              # EndpointSlice 控制器
├── garbagecollector/           # 垃圾回收控制器
├── serviceaccount/             # ServiceAccount 控制器
├── podgc/                      # Pod 垃圾回收
├── resourceclaim/              # ResourceClaim 控制器
├── resourcequota/              # ResourceQuota 控制器
├── ttl/                        # TTL 控制器
├── clusterroleaggregation/     # ClusterRole 聚合控制器
└── certificates/               # 证书控制器
```

---

## 控制器模式

Kubernetes 控制器遵循经典的控制论模式：

```
期望状态 ←──────────────┐
    │                   │
    ↓                   │
当前状态 ──→ 控制器 ──→ 调整 ──→ 新当前状态
    ↑                   │
    └───────────────────┘
```

**核心概念：**
1. **Desired State** - 用户期望的状态（YAML 定义）
2. **Current State** - 当前集群的实际状态
3. **Reconciliation Loop** - 不断对比并调整

---

## 通用控制器接口

所有控制器都实现相同的接口：

```go
// 控制器接口
type Controller interface {
    // 启动控制器
    Run(workers int, stopCh <-chan struct{})
}

// 工作队列
type Interface interface {
    Add(item interface{})
    Get() (item interface{}, shutdown bool)
    Done(item interface{})
    ShutDown()
    ShuttingDown() bool
}

// Informer (事件监听)
type SharedInformer interface {
    AddEventHandler(handler ResourceEventHandler)
    Run(stopCh <-chan struct{})
    HasSynced() bool
    GetStore() Store
}
```

---

## 核心控制器详解

### 1. Deployment 控制器

**位置**: `pkg/controller/deployment/`

**职责：**
- 管理 Deployment 资源
- 创建和管理 ReplicaSet
- 处理滚动更新
- 支持回滚

**工作流程：**
```
1. 监听 Deployment 变化
2. 计算期望的 ReplicaSet 状态
3. 创建/更新/删除 ReplicaSet
4. 监听 ReplicaSet 变化
5. 根据策略调整 Pod 数量
```

**滚动更新策略：**
- `RollingUpdate` - 逐步替换 Pod
- `Recreate` - 先删除所有 Pod，再创建新的

**关键代码：**
```go
type DeploymentController struct {
    kubeClient clientset.Interface
    dLister    appslisters.DeploymentLister
    rsLister   appslisters.ReplicaSetLister
    podLister  corelisters.PodLister
    queue      workqueue.RateLimitingInterface
}

func (dc *DeploymentController) syncDeployment(key string) error {
    // 1. 获取 Deployment
    deployment, err := dc.dLister.Deployments(ns).Get(name)
    if err != nil {
        return err
    }

    // 2. 获取关联的 ReplicaSet
    rsList, err := dc.getReplicaSetsForDeployment(deployment)

    // 3. 计算期望状态
    newRS, oldRSs, err := dc.getAllReplicaSetsAndSyncRevision(deployment, rsList...)

    // 4. 调整 ReplicaSet
    dc.scaleReplicaSet(deployment, newRS, oldRSs...)

    // 5. 检查滚动更新进度
    dc.checkRolloutConditions(deployment, newRS, oldRSs...)

    return nil
}
```

---

### 2. ReplicaSet 控制器

**位置**: `pkg/controller/replicaset/`

**职责：**
- 管理 ReplicaSet 资源
- 确保指定数量的 Pod 运行
- 创建/删除 Pod

**工作流程：**
```
1. 监听 ReplicaSet 变化
2. 计算期望的 Pod 数量
3. 对比当前 Pod 数量
4. 创建/删除 Pod 直到数量匹配
```

**关键代码：**
```go
type ReplicaSetController struct {
    kubeClient clientset.Interface
    rsLister   appslisters.ReplicaSetLister
    podLister  corelisters.PodLister
    queue      workqueue.RateLimitingInterface
}

func (rsc *ReplicaSetController) syncReplicaSet(key string) error {
    // 1. 获取 ReplicaSet
    rs, err := rsc.rsLister.ReplicaSets(ns).Get(name)

    // 2. 获取关联的 Pod
    pods, err := rsc.getPodsForReplicaSet(rs)

    // 3. 计算 diff
    diff := len(pods) - int(*(rs.Spec.Replicas))

    // 4. 调整 Pod 数量
    if diff < 0 {
        // 创建 Pod
        rsc.addPod(rs, -diff)
    } else if diff > 0 {
        // 删除 Pod
        rsc.deletePod(rs, diff)
    }

    return nil
}
```

---

### 3. StatefulSet 控制器

**位置**: `pkg/controller/statefulset/`

**职责：**
- 管理有状态应用
- 保证 Pod 的稳定标识
- 有序部署和扩展
- 有序删除和终止

**特殊能力：**
- 稳定的网络标识 (pod-0, pod-1, ...)
- 稳定的持久化存储
- 有序部署和扩展
- 有序删除和终止

**关键代码：**
```go
type StatefulSetController struct {
    kubeClient clientset.Interface
    ssLister   appslisters.StatefulSetLister
    podLister  corelisters.PodLister
    queue      workqueue.RateLimitingInterface
}

func (ssc *StatefulSetController) syncStatefulSet(key string) error {
    // 1. 获取 StatefulSet
    ss, err := ssc.ssLister.StatefulSets(ns).Get(name)

    // 2. 计算期望的 Pod 序列
    replicas := int(*ss.Spec.Replicas)

    // 3. 有序创建 Pod (0 → replicas-1)
    for i := 0; i < replicas; i++ {
        podName := fmt.Sprintf("%s-%d", ss.Name, i)
        ssc.createPod(ss, podName, i)
    }

    // 4. 清理多余的 Pod
    ssc.deleteExcessPods(ss)

    return nil
}
```

---

### 4. DaemonSet 控制器

**位置**: `pkg/controller/daemon/`

**职责：**
- 在每个节点上运行一个 Pod
- 新节点自动添加 Pod
- 节点删除自动清理 Pod

**工作流程：**
```
1. 监听 DaemonSet 变化
2. 监听 Node 变化
3. 为每个符合条件的节点创建 Pod
4. 删除不符合条件的 Pod
```

**关键代码：**
```go
type DaemonSetsController struct {
    kubeClient clientset.Interface
    dsLister   appslisters.DaemonSetLister
    podLister  corelisters.PodLister
    nodeLister corelisters.NodeLister
    queue      workqueue.RateLimitingInterface
}

func (dsc *DaemonSetsController) syncDaemonSet(key string) error {
    // 1. 获取 DaemonSet
    ds, err := dsc.dsLister.DaemonSets(ns).Get(name)

    // 2. 获取所有节点
    nodes, err := dsc.nodeLister.List(labels.Everything())

    // 3. 为每个节点创建 Pod
    for _, node := range nodes {
        if dsc.shouldRunOnNode(ds, node) {
            dsc.createPod(ds, node)
        }
    }

    return nil
}
```

---

### 5. Job 控制器

**位置**: `pkg/controller/job/`

**职责：**
- 管理批处理任务
- 追踪完成状态
- 支持 Pod 失败重试

**工作流程：**
```
1. 监听 Job 变化
2. 创建 Pod 执行任务
3. 监听 Pod 状态
4. 记录成功/失败数量
5. 达到完成条件后标记 Job 完成
```

**关键代码：**
```go
type JobController struct {
    kubeClient clientset.Interface
    jobLister  batchlisters.JobLister
    podLister  corelisters.PodLister
    queue      workqueue.RateLimitingInterface
}

func (jc *JobController) syncJob(key string) error {
    // 1. 获取 Job
    job, err := jc.jobLister.Jobs(ns).Get(name)

    // 2. 获取关联的 Pod
    pods, err := jc.getPodsForJob(job)

    // 3. 统计成功/失败数量
    active, succeeded, failed := jc.countPods(job, pods)

    // 4. 判断是否需要创建更多 Pod
    if active < *job.Spec.Parallelism && !jc.isJobFinished(job) {
        jc.createPods(job, *job.Spec.Parallelism-active)
    }

    // 5. 更新 Job 状态
    jc.updateJobStatus(job, succeeded, failed)

    return nil
}
```

---

### 6. Node 生命周期控制器

**位置**: `pkg/controller/nodelifecycle/`

**职责：**
- 监控节点健康状态
- 标记 NotReady 节点
- 驱逐 NotReady 节点上的 Pod
- 管理节点污点和容忍

**工作流程：**
```
1. 监听 Node 状态
2. 检测心跳超时
3. 标记 NotReady
4. 触发 Pod 驱逐
```

---

### 7. Endpoint 控制器

**位置**: `pkg/controller/endpoint/`

**职责：**
- 管理 Service 的 Endpoints
- 根据 Pod 选择器自动更新
- 支持手动 Endpoints

**工作流程：**
```
1. 监听 Service 变化
2. 监听 Pod 变化
3. 匹配 Service 选择器
4. 更新 Endpoints
```

---

## Informer 架构

Informer 是 Kubernetes 控制器的核心机制：

```
API Server
    ↓ Watch
Informer
    ├── ListWatch (定期同步)
    ├── DeltaFIFO (事件队列)
    ├── Indexer (本地缓存)
    └── Event Handlers (回调)
        ↓
控制器
    ├── Work Queue (工作队列)
    ├── Workers (工作线程)
    └── Sync Loop (同步循环)
```

**Informer 生命周期：**
```go
// 1. 创建 Informer
informer := informers.NewSharedInformerFactory(
    kubeClient,
    time.Minute*10,
).Core().V1().Pods().Informer()

// 2. 添加事件处理器
informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
    AddFunc: func(obj interface{}) {
        // Pod 创建事件
    },
    UpdateFunc: func(oldObj, newObj interface{}) {
        // Pod 更新事件
    },
    DeleteFunc: func(obj interface{}) {
        // Pod 删除事件
    },
})

// 3. 启动 Informer
go informer.Run(stopCh)

// 4. 等待缓存同步
if !cache.WaitForCacheSync(stopCh, informer.HasSynced) {
    log.Fatal("Timed out waiting for caches to sync")
}
```

---

## 工作队列

控制器使用工作队列处理事件：

```go
// 1. 创建队列
queue := workqueue.NewRateLimitingQueue(workqueue.DefaultControllerRateLimiter())

// 2. 处理事件
informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
    AddFunc: func(obj interface{}) {
        key, err := cache.MetaNamespaceKeyFunc(obj)
        if err == nil {
            queue.Add(key)
        }
    },
})

// 3. Worker 循环
for i := 0; i < workers; i++ {
    go wait.Until(c.worker, time.Second, stopCh)
}

func (c *Controller) worker() {
    for c.processNextItem() {
    }
}

func (c *Controller) processNextItem() bool {
    // 1. 从队列获取
    key, quit := queue.Get()
    if quit {
        return false
    }
    defer queue.Done(key)

    // 2. 处理
    err := c.syncHandler(key.(string))

    // 3. 重试
    if err != nil {
        queue.AddRateLimited(key)
    } else {
        queue.Forget(key)
    }

    return true
}
```

---

## 控制器启动

**主入口**: `cmd/kube-controller-manager/app/controllermanager.go`

```go
// 启动所有控制器
func Run(ctx context.Context, c *config.CompletedConfig) error {
    // 1. 创建 Informer Factory
    informerFactory := informers.NewSharedInformerFactory(
        kubeClient,
        resyncPeriod,
    )

    // 2. 启动控制器
    if err := StartControllers(ctx, c, informerFactory); err != nil {
        return err
    }

    // 3. 启动 Informer Factory
    informerFactory.Start(ctx.Done())

    // 4. 等待缓存同步
    informerFactory.WaitForCacheSync(ctx.Done())

    // 5. 等待退出
    <-ctx.Done()

    return nil
}
```

---

## 性能优化

### 1. 本地缓存
- Informer 本地缓存减少 API Server 调用
- Indexer 支持快速查询

### 2. 事件过滤
- 过滤无关事件
- 去重

### 3. 批量处理
- 工作队列批量处理
- 限流控制

### 4. 并发控制
- 多 worker 并行处理
- 按需扩容

---

## 总结

**Controller Manager 核心特点：**
1. **声明式控制** - 期望状态驱动
2. **事件驱动** - Watch 机制
3. **高度解耦** - 独立控制器
4. **本地缓存** - Informer 架构
5. **自动恢复** - 持续 reconciliation
6. **可扩展** - 自定义控制器

**设计模式：**
- 控制器模式
- 观察者模式
- 工作队列模式
- 工厂模式

---

## 下一步分析

1. **Scheduler** - 调度算法和框架
2. **Kubelet** - Pod 生命周期和容器运行时
3. **etcd 集成** - 状态存储和 watch 机制
4. **网络模型** - Service、Ingress、CNI

---

**分析完成时间**: 2026-02-09
**分析人员**: 小宝
**下一步**: 分析 Scheduler
