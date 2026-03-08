# Kubernetes 项目分析 - 04: Scheduler

**项目路径**: `~/work/todo/kubernetes`
**分析日期**: 2026-02-09
**组件**: kube-scheduler
**位置**: `cmd/kube-scheduler/`

---

## Scheduler 概述

Scheduler 是 Kubernetes 的调度器，负责将 Pod 分配到合适的 Node 上运行。

**核心职责：**
1. 监听未调度的 Pod
2. 筛选合适的节点 (Predicates)
3. 对节点评分 (Priorities)
4. 选择最佳节点
5. 将绑定信息发送给 API Server

---

## 目录结构

```
cmd/kube-scheduler/
└── app/                    # Scheduler 应用逻辑
    ├── scheduler.go        # 主入口
    ├── config.go          # 配置管理
    └── options.go         # 命令行选项

pkg/scheduler/              # 调度器核心实现
├── framework/             # 调度框架
│   ├── interface.go       # 框架接口
│   ├── plugins.go         # 插件管理
│   └── cycle_state.go     # 调度周期状态
├── profile/               # 调度配置文件
│   └── profile.go         # Profile 定义
├── scheduler.go           # 调度器主逻辑
├── schedule_one.go        # 单 Pod 调度
├── eventhandlers.go       # 事件处理
├── backend/               # 调度后端
│   ├── queue.go           # 调度队列
│   └── snapshot.go        # 集群快照
├── metrics/               # 指标
└── util/                  # 工具函数
```

---

## 调度流程

完整的调度流程：

```
1. Pod 创建
   ↓
2. Pod 进入待调度队列 (Scheduling Queue)
   ↓
3. Scheduler 获取 Pod
   ↓
4. 创建集群快照 (Cluster Snapshot)
   ↓
5. 过滤阶段 (Predicates)
   - 筛选符合要求的节点
   - 移除不满足条件的节点
   ↓
6. 优选阶段 (Priorities)
   - 对剩余节点打分
   - 按分数排序
   ↓
7. 选择最佳节点
   - 选择分数最高的节点
   - 或随机选择同分节点
   ↓
8. 绑定阶段 (Binding)
   - 更新 Pod 的 NodeName
   - 发送给 API Server
   ↓
9. 等待 Pod 真正运行
   ↓
10. 确认调度成功/失败
```

---

## 调度框架

**位置**: `pkg/scheduler/framework/interface.go`

Scheduler 使用插件化的调度框架：

```go
// 调度周期状态
type CycleState struct {
    // 记录插件的状态
    record PluginToState
    // 任意数据存储
    mutableState map[StateKey]interface{}
}

// 调度插件接口
type Plugin interface {
    // 返回插件名称
    Name() string
}

// 过滤插件
type FilterPlugin interface {
    Plugin
    // 过滤节点
    Filter(ctx context.Context, state *CycleState, pod *v1.Pod, nodeInfo *NodeInfo) *Status
}

// 评分插件
type ScorePlugin interface {
    Plugin
    // 对节点打分
    Score(ctx context.Context, state *CycleState, pod *v1.Pod, nodeName string) (int64, *Status)
    // 返回得分扩展信息
    ScoreExtensions() ScoreExtensions
}

// 绑定插件
type BindPlugin interface {
    Plugin
    // 绑定 Pod 到节点
    Bind(ctx context.Context, state *CycleState, pod *v1.Pod, nodeName string) *Status
}

// 预预留插件
type ReservePlugin interface {
    Plugin
    // 预留资源
    Reserve(ctx context.Context, state *CycleState, pod *v1.Pod, nodeName string) *Status
    // 取消预留
    Unreserve(ctx context.Context, state *CycleState, pod *v1.Pod, nodeName string)
}
```

---

## 核心调度算法

### 1. Predicates (过滤阶段)

**目标**: 移除不满足 Pod 要求的节点

**常用 Predicates:**

#### PodFitsResources
- 检查节点资源是否足够
- CPU、内存、GPU 等

```go
func (p *PodFitsResources) Filter(ctx context.Context, state *CycleState, pod *v1.Pod, nodeInfo *NodeInfo) *Status {
    // 获取节点可用资源
    allocatable := nodeInfo.Allocatable

    // 计算需要的资源
    requested := computePodResourceRequest(pod)

    // 检查是否足够
    if !allocatable.Cpu().Cmp(*requested.Cpu) >= 0 {
        return framework.NewStatus(framework.Unschedulable, "Insufficient CPU")
    }
    if !allocatable.Memory().Cmp(*requested.Memory) >= 0 {
        return framework.NewStatus(framework.Unschedulable, "Insufficient memory")
    }

    return nil
}
```

#### PodFitsHostPorts
- 检查端口冲突
- Pod 的 hostPort 是否已被占用

```go
func (p *PodFitsHostPorts) Filter(ctx context.Context, state *CycleState, pod *v1.Pod, nodeInfo *NodeInfo) *Status {
    // 获取 Pod 的 hostPort
    hostPorts := getHostPorts(pod)

    // 检查是否被占用
    for _, port := range hostPorts {
        if nodeInfo.UsedPorts[port] {
            return framework.NewStatus(framework.Unschedulable, "Host port in use")
        }
    }

    return nil
}
```

#### MatchNodeSelector
- 匹配节点选择器
- NodeSelector、NodeAffinity

```go
func (m *MatchNodeSelector) Filter(ctx context.Context, state *CycleState, pod *v1.Pod, nodeInfo *NodeInfo) *Status {
    // 获取节点标签
    nodeLabels := nodeInfo.Node().Labels

    // 检查 NodeSelector
    if !matchesNodeSelector(pod.Spec.NodeSelector, nodeLabels) {
        return framework.NewStatus(framework.Unschedulable, "Node selector doesn't match")
    }

    // 检查 NodeAffinity
    if !matchesNodeAffinity(pod.Spec.Affinity.NodeAffinity, nodeLabels) {
        return framework.NewStatus(framework.Unschedulable, "Node affinity doesn't match")
    }

    return nil
}
```

#### CheckNodeUnschedulable
- 检查节点是否可调度
- Node.Spec.Unschedulable 字段

#### PodToleratesNodeTaints
- 检查 Pod 是否容忍节点的污点

```go
func (p *PodToleratesNodeTaints) Filter(ctx context.Context, state *CycleState, pod *v1.Pod, nodeInfo *NodeInfo) *Status {
    // 获取节点污点
    taints := nodeInfo.Node().Spec.Taints

    // 检查 Pod 是否容忍
    for _, taint := range taints {
        if !taint.ToleratesTaint(taint) {
            return framework.NewStatus(framework.Unschedulable, "Node taint not tolerated")
        }
    }

    return nil
}
```

#### CheckNodeMemoryPressure
- 检查节点内存压力

#### CheckNodeDiskPressure
- 检查节点磁盘压力

---

### 2. Priorities (优选阶段)

**目标**: 对符合条件的节点打分，选择最佳节点

**常用 Priorities:**

#### NodeResourcesFit
- 基于资源使用情况打分
- 资源使用越均衡，分数越高

```go
func (n *NodeResourcesFit) Score(ctx context.Context, state *CycleState, pod *v1.Pod, nodeName string) (int64, *Status) {
    // 获取节点信息
    nodeInfo := snapshot.NodeInfo(nodeName)

    // 计算资源使用率
    cpuUsage := nodeInfo.Requested.Cpu().AsApproximateFloat64() /
                nodeInfo.Allocatable.Cpu().AsApproximateFloat64()
    memUsage := nodeInfo.Requested.Memory().AsApproximateFloat64() /
                nodeInfo.Allocatable.Memory().AsApproximateFloat64()

    // 计算分数 (0-100)
    // 使用率越接近 50%，分数越高
    score := int64((1 - math.Abs(0.5-cpuUsage)) * 100)

    return score, nil
}
```

#### NodeAffinityPriority
- 基于节点亲和性打分
- 匹配的亲和性越多，分数越高

```go
func (n *NodeAffinityPriority) Score(ctx context.Context, state *CycleState, pod *v1.Pod, nodeName string) (int64, *Status) {
    var score int64

    // 检查 PreferredSchedulingTerms
    for _, term := range pod.Spec.Affinity.NodeAffinity.PreferredDuringSchedulingIgnoredDuringExecution {
        if term.Match(nodeInfo.Node()) {
            score += term.Weight
        }
    }

    return score, nil
}
```

#### TaintTolerationPriority
- 基于污点容忍度打分
- 容忍的污点越多，分数越高

#### ImageLocalityPriority
- 基于镜像本地性打分
- 节点上已存在的镜像越多，分数越高

```go
func (i *ImageLocalityPriority) Score(ctx context.Context, state *CycleState, pod *v1.Pod, nodeName string) (int64, *Status) {
    nodeInfo := snapshot.NodeInfo(nodeName)
    var score int64

    // 遍历 Pod 需要的镜像
    for _, image := range pod.Spec.Containers {
        // 检查节点是否已有该镜像
        if nodeInfo.HasImage(image.Image) {
            score += 10
        }
    }

    return score, nil
}
```

#### InterPodAffinityPriority
- 基于 Pod 间亲和性打分
- 已匹配的 Pod 越多，分数越高

---

## 调度队列

**位置**: `pkg/scheduler/backend/queue.go`

调度队列管理待调度的 Pod：

```go
type SchedulingQueue interface {
    // 添加 Pod
    Add(pod *v1.Pod) error
    // 更新 Pod
    Update(pod *v1.Pod) error
    // 删除 Pod
    Delete(pod *v1.Pod) error
    // 获取下一个 Pod
    Pop() (*v1.Pod, error)
    // 检查是否关闭
    Closing() bool
}
```

**队列特性：**
- 优先级队列 (高优先级 Pod 先调度)
- 优先级抢占
- 过滤不可调度 Pod
- 批量处理优化

---

## 集群快照

**位置**: `pkg/scheduler/backend/snapshot.go`

快照提供调度时刻的集群状态：

```go
type Snapshot struct {
    // 节点信息映射
    nodeInfoMap map[string]*NodeInfo
    // Pod 信息映射
    podInfoMap map[string]*PodInfo
}

type NodeInfo struct {
    // 节点对象
    Node *v1.Node
    // Pod 列表
    Pods []*v1.Pod
    // 请求的资源总量
    Requested *Resource
    // 可分配资源
    Allocatable *Resource
    // 使用的端口
    UsedPorts PortMap
    // 镜像列表
    Images []string
}
```

**快照特性：**
- 只读视图
- 调度周期内不变
- 快速查询
- 内存缓存

---

## 调度配置

Scheduler 支持灵活的配置：

```yaml
apiVersion: kubescheduler.config.k8s.io/v1
kind: KubeSchedulerConfiguration
clientConnection:
  kubeconfig: /etc/kubernetes/scheduler.conf
profiles:
- schedulerName: default-scheduler
  plugins:
    queueSort:
      enabled:
      - name: PrioritySort
    preFilter:
      enabled:
      - name: NodeResourcesFit
      - name: NodePorts
    filter:
      enabled:
      - name: NodeUnschedulable
      - name: NodeName
      - name: NodeAffinity
      - name: TaintToleration
    postFilter:
      enabled:
      - name: DefaultPreemption
    preScore:
      enabled:
      - name: InterPodAffinity
      - name: PodTopologySpread
    score:
      enabled:
      - name: NodeResourcesFit
      - name: NodeAffinity
      - name: TaintToleration
    reserve:
      enabled:
      - name: VolumeBinding
    preBind:
      enabled:
      - name: VolumeBinding
    bind:
      enabled:
      - name: DefaultBinder
  pluginConfig:
  - name: NodeResourcesFit
    args:
      resources:
      - name: cpu
        weight: 1
      - name: memory
        weight: 1
```

---

## 亲和性和反亲和性

### Node Affinity (节点亲和性)

```yaml
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
        - matchExpressions:
          - key: disktype
            operator: In
            values:
            - ssd
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        preference:
          matchExpressions:
          - key: zone
            operator: In
            values:
            - zone1
```

### Pod Affinity (Pod 亲和性)

```yaml
spec:
  affinity:
    podAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: web
        topologyKey: kubernetes.io/hostname
```

### Pod Anti-Affinity (Pod 反亲和性)

```yaml
spec:
  affinity:
    podAntiAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: web
        topologyKey: kubernetes.io/hostname
```

---

## 污点和容忍

### Taints (污点)

在 Node 上设置污点，拒绝不兼容的 Pod：

```yaml
apiVersion: v1
kind: Node
metadata:
  name: node1
spec:
  taints:
  - key: node-role.kubernetes.io/master
    effect: NoSchedule
  - key: key1
    effect: NoExecute
    value: value1
```

**污点效果 (Effect):**
- `NoSchedule` - 不调度新 Pod
- `PreferNoSchedule` - 尽量不调度
- `NoExecute` - 不调度，并驱逐现有 Pod

### Tolerations (容忍)

在 Pod 上设置容忍，允许调度到有污点的节点：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-pod
spec:
  tolerations:
  - key: node-role.kubernetes.io/master
    operator: Exists
    effect: NoSchedule
  - key: key1
    operator: Equal
    value: value1
    effect: NoExecute
```

---

## 优先级和抢占

### PriorityClasses

定义 Pod 的优先级：

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 1000
globalDefault: false
description: "High priority class"
```

### Preemption (抢占)

高优先级 Pod 可以抢占低优先级 Pod 的资源：

```
1. 高优先级 Pod 无法调度
2. 寻找可以抢占的节点
3. 识别可以驱逐的低优先级 Pod
4. 驱逐低优先级 Pod
5. 调度高优先级 Pod
```

---

## 调度器启动

**主入口**: `cmd/kube-scheduler/app/scheduler.go`

```go
// 启动调度器
func Run(ctx context.Context, cc *schemecache.CompletedConfig, sched *scheduler.Scheduler) error {
    // 1. 启动调度器
    go sched.Run(ctx.Done())

    // 2. 等待退出
    <-ctx.Done()

    return nil
}

func (sched *Scheduler) Run(ctx context.Context) {
    // 1. 等待缓存同步
    if !sched.waitForCacheSync(ctx) {
        return
    }

    // 2. 启动调度循环
    go wait.UntilWithContext(ctx, sched.scheduleOne, 0)

    // 3. 等待退出
    <-ctx.Done()
}
```

---

## 单 Pod 调度

**位置**: `pkg/scheduler/schedule_one.go`

```go
func (sched *Scheduler) scheduleOne(ctx context.Context) {
    // 1. 从队列获取 Pod
    podInfo := sched.NextPod()
    pod := podInfo.Pod

    // 2. 调度
    scheduleResult, err := sched.Schedule(ctx, sched.profile, pod)

    if err != nil {
        // 调度失败
        if fitError, ok := err.(*framework.FitError); ok {
            // 尝试抢占
            sched.preempt(ctx, sched.profile, pod, fitError)
        }
        return
    }

    // 3. 绑定
    err = sched.Bind(ctx, sched.profile, pod, scheduleResult.SuggestedHost)

    if err != nil {
        // 绑定失败，回滚
        sched.handleBindingError(pod, scheduleResult, err)
        return
    }

    // 4. 确认
    sched.handlePodAffinity(ctx, pod)
}
```

---

## 性能优化

### 1. 快照缓存
- 调度周期内不变
- 避免重复查询 API Server

### 2. 批量处理
- 一次处理多个 Pod
- 减少 API 调用

### 3. 并行过滤
- 多个 Predicates 并行执行
- 减少调度延迟

### 4. 优先级队列
- 高优先级 Pod 先调度
- 关键业务优先

### 5. 调度缓存
- 缓存节点信息
- 减少重复计算

---

## 调度器指标

Scheduler 提供丰富的指标：

```
# 调度尝试次数
scheduler_schedules_total{result="scheduled|error|unschedulable"}

# 调度延迟
scheduler_schedule_duration_seconds{quantile="0.5|0.9|0.99"}

# 待调度队列长度
scheduler_pending_pods

# 调度失败率
scheduler_pod_scheduling_duration_seconds_bucket{status="failed"}
```

---

## 总结

**Scheduler 核心特点：**
1. **两阶段调度** - 过滤 + 打分
2. **插件化框架** - 灵活扩展
3. **优先级支持** - 关键业务优先
4. **亲和性控制** - 精确部署
5. **污点容忍** - 资源隔离
6. **抢占机制** - 动态调整

**设计优势：**
- 高效的两阶段算法
- 高度可扩展
- 支持复杂的调度策略
- 性能优化完善

---

## 下一步分析

1. **Kubelet** - Pod 生命周期和容器运行时
2. **etcd 集成** - 状态存储和一致性
3. **网络模型** - Service、Ingress、CNI
4. **存储机制** - PV/PVC、StorageClass、CSI

---

**分析完成时间**: 2026-02-09
**分析人员**: 小宝
**下一步**: 分析 Kubelet
