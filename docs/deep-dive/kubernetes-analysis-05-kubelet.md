# Kubernetes 项目分析 - 05: Kubelet 深度分析

**项目路径**: `~/work/todo/kubernetes`
**分析日期**: 2026-02-09
**组件**: kubelet
**位置**: `cmd/kubelet/`, `pkg/kubelet/`

---

## Kubelet 概述

Kubelet 是 Kubernetes 在每个节点上运行的代理，是控制平面与容器运行时之间的桥梁。

**核心职责：**
1. 接收 Pod 分配请求
2. 与容器运行时交互 (CRI)
3. 管理 Pod 生命周期
4. 监控容器健康状态
5. 汇报节点和 Pod 状态
6. 管理存储卷
7. 资源管理和 QoS

---

## 目录结构

```
cmd/kubelet/
└── app/                      # Kubelet 应用逻辑
    ├── kubelet.go            # 主入口
    ├── config.go             # 配置管理
    └── options.go            # 命令行选项

pkg/kubelet/                 # Kubelet 核心实现
├── kubelet.go              # Kubelet 主结构和方法
├── pod_workers.go           # Pod 工作线程管理
├── kuberuntime/            # 容器运行时接口
│   ├── kuberuntime_manager.go    # 运行时管理器
│   ├── kuberuntime_container.go # 容器操作
│   └── util/                 # 工具函数
├── pleg/                  # Pod Lifecycle Event Generator
├── cm/                    # Container Manager (资源管理)
│   ├── cpumanager/         # CPU 管理
│   ├── memorymanager/       # 内存管理
│   ├── devicemanager/      # 设备管理
│   └── topologymanager/    # 拓扑管理
├── volumemanager/          # 卷管理器
│   ├── reconciler/         # 卷协调器
│   └── populator/         # 卷填充器
├── prober/                # 探针 (健康检查)
├── status/                # 状态管理器
├── config/                # 配置管理
├── images/                # 镜像管理
├── eviction/              # 驱逐管理
├── logs/                 # 日志管理
├── network/               # 网络管理
└── metrics/              # 指标收集
```

---

## Kubelet 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Kubelet                             │
├─────────────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────────────────────────────────────┐        │
│  │       Pod Manager                          │        │
│  │  - 管理期望 Pod 集合                   │        │
│  │  - 同步镜像 Pod                            │        │
│  └─────────────────────────────────────────────┘        │
│                      ↓                              │
│  ┌─────────────────────────────────────────────┐        │
│  │      Pod Workers                         │        │
│  │  - 每个一个 goroutine                   │        │
│  │  - FIFO 顺序处理                         │        │
│  │  - 状态机驱动                            │        │
│  └─────────────────────────────────────────────┘        │
│                      ↓                              │
│  ┌─────────────────────────────────────────────┐        │
│  │   KubeGenericRuntimeManager           │        │
│  │  - CRI 客户端                             │        │
│  │  - Sandbox 管理                           │        │
│  │  - 容器生命周期                           │        │
│  └─────────────────────────────────────────────┘        │
│                      ↓                              │
│  ┌─────────────────────────────────────────────┐        │
│  │      Container Runtime (CRI)            │        │
│  │  - containerd / dockerd / CRI-O      │        │
│  └─────────────────────────────────────────────┘        │
│                                                     │
│  ┌─────────────────────────────────────────────┐        │
│  │    PLEG (Pod Lifecycle Events)       │        │
│  │  - 监听容器事件                          │        │
│  │  - 触发 Pod 重建                         │        │
│  └─────────────────────────────────────────────┘        │
│                                                     │
│  ┌─────────────────────────────────────────────┐        │
│  │      Probe Manager                       │        │
│  │  - Liveness 探针                         │        │
│  │  - Readiness 探针                        │        │
│  │  - Startup 探针                          │        │
│  └─────────────────────────────────────────────┘        │
│                                                     │
│  ┌─────────────────────────────────────────────┐        │
│  │    Container Manager                  │        │
│  │  - QoS Cgroups                           │        │
│  │  - CPU/Memory 限制                        │        │
│  │  - 设备分配                              │        │
│  └─────────────────────────────────────────────┘        │
│                                                     │
│  ┌─────────────────────────────────────────────┐        │
│  │     Volume Manager                      │        │
│  │  - 卷挂载                                │        │
│  │  - CSI 集成                              │        │
│  │  - 卷清理                                │        │
│  └─────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

---

## Kubelet 主结构

**位置**: `pkg/kubelet/kubelet.go`

```go
type Kubelet struct {
    // Kubelet 配置
    kubeletConfiguration kubeletconfiginternal.KubeletConfiguration

    // 节点信息
    nodeName        types.NodeName
    hostname        string
    cachedNode      *v1.Pod

    // Kubernetes 客户端
    kubeClient      clientset.Interface
    heartbeatClient clientset.Interface

    // Pod 管理
    podManager     kubepod.Manager
    podWorkers     PodWorkers

    // 容器运行时
    runtimeCache   kubecontainer.RuntimeCache
    containerRuntime kubecontainer.Runtime

    // 资源管理器
    containerManager cm.ContainerManager

    // 卷管理器
    volumeManager volumemanager.VolumeManager

    // 探针管理器
    probeManager prober.Manager

    // 状态管理器
    statusManager status.Manager

    // 镜像管理
    imageManager images.ImageManager

    // PLEG
    pleg podlifecycle.PodLifecycleEventGenerator

    // 事件记录器
    recorder record.EventRecorder
}
```

---

## Pod Workers - Pod 生命周期引擎

**位置**: `pkg/kubelet/pod_workers.go`

Pod Workers 是 Kubelet 的核心引擎，负责管理 Pod 的生命周期。

### Pod 状态机

```go
type PodWorkerState int

const (
    // SyncPod - Pod 应该正在运行
    SyncPod PodWorkerState = iota
    
    // TerminatingPod - Pod 不再被设置，但容器可能还在运行
    TerminatingPod
    
    // TerminatedPod - Pod 已停止，所有容器已清理
    TerminatedPod
)
```

### Pod Workers 接口

```go
type PodWorkers interface {
    // 通知 Pod 变化
    UpdatePod(options UpdatePodOptions)
    
    // 同步已知 Pod 集合，清理未知的 Pod
    SyncKnownPods(desiredPods []*v1.Pod) map[types.UID]PodWorkerSync
    
    // 查询 Pod 状态
    IsPodKnownTerminated(uid types.UID) bool
    CouldHaveRunningContainers(uid types.UID) bool
    ShouldPodBeFinished(uid types.UID) bool
    IsPodTerminationRequested(uid types.UID) bool
    ShouldPodContainersBeTerminating(uid types.UID) bool
    ShouldPodRuntimeBeRemoved(uid types.UID) bool
    ShouldPodContentBeRemoved(uid types.UID) bool
}
```

### UpdatePod 流程

```
1. 接收 Pod 更新
   ↓
2. 根据类型决定处理方式
   ├── SyncPodCreate     - 创建新 Pod
   ├── SyncPodUpdate     - 更新现有 Pod
   ├── SyncPodKill       - 删除 Pod
   └── SyncPodSync       - 定期同步
   ↓
3. 根据 Pod Worker 状态调用对应方法
   ├── SyncPod           - 运行 Pod
   ├── SyncTerminatingPod - 终止 Pod
   └── SyncTerminatedPod  - 清理 Pod
```

---

## KubeGenericRuntimeManager - 容器运行时接口

**位置**: `pkg/kubelet/kuberuntime/kuberuntime_manager.go`

KubeGenericRuntimeManager 实现了与容器运行时的交互接口。

### 核心结构

```go
type kubeGenericRuntimeManager struct {
    // 运行时服务
    runtimeService internalapi.RuntimeService
    imageService   internalapi.ImageManagerService

    // 容器 GC
    containerGC *containerGC

    // 探针结果
    livenessManager  proberesults.Manager
    readinessManager proberesults.Manager
    startupManager   proberesults.Manager

    // 镜像拉取器
    imagePuller images.ImageManager

    // 版本缓存
    versionCache *cache.ObjectCache

    // 运行时帮助器
    runtimeHelper kubecontainer.RuntimeHelper

    // 事件记录器
    recorder record.EventRecorder

    // OOM kill 配置
    singleProcessOOMKill *bool
    cpuCFSQuota        bool
    cpuCFSQuotaPeriod  metav1.Duration
}
```

### SyncPod 方法

**位置**: `pkg/kubelet/kuberuntime/kuberuntime_manager.go:1394`

SyncPod 是 Pod 同步的核心方法：

```go
func (m *kubeGenericRuntimeManager) SyncPod(
    ctx context.Context,
    pod *v1.Pod,
    podStatus *kubecontainer.PodStatus,
    pullSecrets []v1.Secret,
    backOff *flowcontrol.Backoff,
    restartAllContainers bool,
) (result kubecontainer.PodSyncResult) {
```

**SyncPod 流程：**

```
Step 1: 计算容器变更
   ↓
   比对期望状态和实际状态
   确定：
   - 是否需要创建 Sandbox
   - 是否需要创建容器
   - 是否需要删除容器
   - 是否需要重启容器
   ↓
Step 2: 如果 Sandbox 改变，停止整个 Pod
   ↓
   killPodWithSyncResult()
   ↓
Step 3: 停止不需要保留的容器
   ↓
   killContainer() for each container
   ↓
Step 4: 创建 Sandbox（如果需要）
   ↓
   createPodSandbox()
   ↓
   获取 Sandbox 状态和 IP
   ↓
Step 5: 启动容器
   ↓
   for each container:
     - doBackOff() - 检查回退策略
     - getImageVolumes() - 拉取镜像
     - startContainer() - 启动容器
   ↓
Step 6: 执行 post-start 操作
   ↓
   - 记录事件
   - 更新状态
   ↓
Step 7: 返回结果
```

**关键代码：**

```go
// Step 1: 计算容器变更
podContainerChanges := m.computePodActions(ctx, pod, podStatus, restartAllContainers)

// Step 2: 如果需要，停止 Pod
if podContainerChanges.KillPod {
    killResult := m.killPodWithSyncResult(ctx, pod, runningPod, nil)
    result.AddPodSyncResult(killResult)
}

// Step 4: 创建 Sandbox
if podContainerChanges.CreateSandbox {
    podSandboxID, msg, err := m.createPodSandbox(ctx, pod, attempt)
}

// Step 5: 启动容器
for _, container := range pod.Spec.Containers {
    startContainerResult := m.startContainer(
        ctx, 
        pod, 
        podSandboxConfig, 
        container, 
        podIPs,
        podIP,
        pullSecrets,
        backOff,
    )
}
```

---

## Kubelet 主循环

**位置**: `pkg/kubelet/kubelet.go:2509`

```go
func (kl *Kubelet) syncLoop(ctx context.Context, updates <-chan kubetypes.PodUpdate, handler SyncHandler) {
    for {
        select {
        case u := <-updates:
            switch u.Op {
            case SET:
                kl.HandlePodAdditions(u.Pods)
            case UPDATE:
                kl.HandlePodUpdates(u.Pods)
            case DELETE:
                kl.HandlePodRemoves(u.Pods)
            case REMOVE:
                kl.HandlePodReconcile(u.Pods)
            case RECONCILE:
                kl.HandlePodSyncs(u.Pods)
            }
        }
    }
}
```

### 事件处理方法

```go
// 处理 Pod 添加
func (kl *Kubelet) HandlePodAdditions(pods []*v1.Pod)

// 处理 Pod 更新
func (kl *Kubelet) HandlePodUpdates(pods []*v1.Pod)

// 处理 Pod 删除
func (kl *Kubelet) HandlePodRemoves(pods []*v1.Pod)

// 处理 Pod 协调
func (kl *Kubelet) HandlePodReconcile(pods []*v1.Pod)

// 处理 Pod 同步
func (kl *Kubelet) HandlePodSyncs(pods []*v1.Pod)
```

---

## PLEG - Pod Lifecycle Event Generator

**位置**: `pkg/kubelet/pleg/`

PLEG 监听容器运行时事件，触发 Pod 重建。

### PLEG 工作原理

```
1. 定期轮询容器运行时
   ↓
2. 检测容器状态变化
   - 容器创建
   - 容器删除
   - 容器状态变化
   ↓
3. 生成 Pod 事件
   ↓
4. 触发 Pod 重建
   ↓
5. 更新 Pod 状态
```

### PLEG 接口

```go
type PodLifecycleEventGenerator interface {
    Watch() chan<- struct{}
    Healthy() (bool, error)
    Start()
    Stop()
}
```

---

## Container Manager (CM)

**位置**: `pkg/kubelet/cm/`

Container Manager 负责资源管理和 QoS。

### 核心组件

#### 1. CPU Manager

**位置**: `pkg/kubelet/cm/cpumanager/`

```go
type Manager interface {
    // 添加 Pod
    AddPod(pod *v1.Pod) error
    
    // 移除 Pod
    RemovePod(pod *v1.Pod) error
    
    // 分配 CPU
    Allocate(pod *v1.Pod, container *v1.Container) error
    
    // 获取分配状态
    GetCPUAssignment() map[string]map[int]cpuset.CPUSet
}
```

**CPU 策略：**
- `none` - 不限制 CPU
- `static` - 静态分配
- `dynamic` - 动态分配

#### 2. Memory Manager

**位置**: `pkg/kubelet/cm/memorymanager/`

```go
type Manager interface {
    AddPod(pod *v1.Pod) error
    RemovePod(pod *v1.Pod) error
    GetPodMemory(pod *v1.Pod) (map[string]uint64, error)
    Allocate(pod *v1.Pod, container *v1.Container) error
}
```

**内存管理：**
- NUMA 感知分配
- 页面共享优化
- 容器内存限制

#### 3. Device Manager

**位置**: `pkg/kubelet/cm/devicemanager/`

```go
type Manager interface {
    // 注册设备
    RegisterDevice(device Device)
    
    // 分配设备
    Allocate(pod *v1.Pod, container *v1.Container) error
    
    // 获取设备列表
    GetDevices() []Device
}
```

**支持的设备：**
- GPU (NVIDIA, AMD)
- FPGA
- SR-IOV
- 其他加速设备

#### 4. Topology Manager

**位置**: `pkg/kubelet/cm/topologymanager/`

```go
type Manager interface {
    // 提供资源提示
    Admit(pod *v1.Pod) (bool, error)
    
    // 分配资源
    Allocate(pod *v1.Pod) error
    
    // 释放资源
    Release(pod *v1.Pod)
}
```

**拓扑策略：**
- `none` - 不感知拓扑
- `best-effort` - 尽力而为
- `restricted` - 限制性
- `single-numa-node` - 单 NUMA 节点

---

## Volume Manager

**位置**: `pkg/kubelet/volumemanager/`

Volume Manager 负责存储卷的生命周期管理。

### Volume Manager 接口

```go
type VolumeManager interface {
    // 开始操作卷
    WaitForAttachAndMount(ctx context.Context, pod *v1.Pod) error
    
    // 检查卷是否可访问
    ReconcilerStates() map[v1.UniqueVolumeName]reconciler.VolumeReconcilerState
    
    // 获取 Pod 的卷
    GetMountedVolumesForPod(volumeName v1.UniqueVolumeName, podUID types.UID) map[string]volume.MountedVolume
    
    // 清理 Pod 卷
    CleanupPodOnDiskError(ctx context.Context, pod *v1.Pod) error
}
```

### 卷操作流程

```
1. 等待卷可用
   ↓
2. 附加卷 (Attach)
   ↓
3. 挂载卷 (Mount)
   ↓
4. 容器启动
   ↓
5. 容器停止
   ↓
6. 卸载卷 (Unmount)
   ↓
7. 分离卷 (Detach)
   ↓
8. 清理卷 (Delete)
```

---

## Probe Manager

**位置**: `pkg/kubelet/prober/`

Probe Manager 负责执行健康检查。

### 探针类型

```go
type ProbeType string

const (
    // Liveness 探针 - 判断容器是否需要重启
    Liveness ProbeType = "liveness"
    
    // Readiness 探针 - 判断容器是否就绪
    Readiness ProbeType = "readiness"
    
    // Startup 探针 - 判断容器是否启动成功
    Startup ProbeType = "startup"
)
```

### 探针实现

```go
type Manager interface {
    // 添加 Pod
    AddPod(pod *v1.Pod)
    
    // 移除 Pod
    RemovePod(pod *v1.Pod)
    
    // 停止探针
    StopLivenessAndStartup(pod *v1.Pod)
    
    // 更新探针
    UpdatePodStatus(pod *v1.Pod, podStatus *kubecontainer.PodStatus)
}
```

### 探针执行方式

```
HTTP 探针
→ HTTP GET 请求
→ 检查 HTTP 状态码

TCP 探针
→ TCP 连接尝试
→ 检查连接是否成功

Exec 探针
→ 在容器内执行命令
→ 检查退出码

gRPC 探针
→ gRPC 健康检查
→ 检查响应
```

---

## Status Manager

**位置**: `pkg/kubelet/status/`

Status Manager 管理和同步 Pod 状态到 API Server。

### Status Manager 接口

```go
type Manager interface {
    // 设置 Pod 状态
    SetPodStatus(logger klog.Logger, pod *v1.Pod, status v1.PodStatus) error
    
    // 获取 Pod 状态
    GetPodStatus(uid types.UID) (v1.PodStatus, bool)
    
    // 删除 Pod
    RemovePod(uid types.UID)
    
    // 批量设置状态
    SetPodsStatus(podStatuses []v1.PodStatus) error
}
```

### 状态同步流程

```
1. 容器运行时状态
   ↓
2. 转换为 API 状态
   ↓
3. 计算容器状态
   - Running
   - Waiting
   - Terminated
   ↓
4. 计算 Pod 阶段
   - Pending
   - Running
   - Succeeded
   - Failed
   ↓
5. 汇报到 API Server
   ↓
6. 批量更新优化
```

---

## Eviction Manager

**位置**: `pkg/kubelet/eviction/`

Eviction Manager 负责 Pod 驱逐。

### 驱逐原因

```go
const (
    // 资源不足
    EvictionReasonMemoryPressure = "MemoryPressure"
    EvictionReasonDiskPressure = "DiskPressure"
    EvictionReasonPIDPressure = "PIDPressure"
    EvictionReasonUnavailable = "NodeUnavailable"
)
```

### 驱逐策略

```
1. 监控资源使用
   ↓
2. 检测压力信号
   - 内存压力
   - 磁盘压力
   - PID 压力
   ↓
3. 识别候选 Pod
   - 根据 QoS
   - 根据优先级
   - 根据运行时间
   ↓
4. 执行驱逐
   - 删除 Pod
   - 释放资源
```

---

## 镜像管理

**位置**: `pkg/kubelet/images/`

镜像管理负责容器镜像的生命周期。

### Image Manager 接口

```go
type ImageManager interface {
    // 获取镜像列表
    GetImageRefs() ([]v1.Image, error)
    
    // 删除镜像
    DeleteImage(imageID string) error
    
    // 获取镜像状态
    ImageStats() (*ImageGCStats, error)
    
    // Garbage Collect 镜像
    GarbageCollect() error
}
```

### 镜像 GC

```
1. 定期检查未使用的镜像
   ↓
2. 根据 GC 策略决定删除
   - HighThresholdPercent
   - LowThresholdPercent
   ↓
3. 删除未使用的镜像
   ↓
4. 释放磁盘空间
```

---

## Kubelet 启动流程

**位置**: `cmd/kubelet/app/kubelet.go`

```go
func Run(ctx context.Context, c *config.CompleteConfig) error {
    // 1. 创建 Kubelet 实例
    k, err := CreateKubelet(ctx, c)
    
    // 2. 初始化子模块
    k.initializeModules(ctx)
    
    // 3. 启动 PLEG
    go k.pleg.Start()
    
    // 4. 启动 Probe Manager
    go k.probeManager.Start()
    
    // 5. 启动 Status Manager
    go k.statusManager.Start()
    
    // 6. 启动 Volume Manager
    go k.volumeManager.Run(ctx.Done())
    
    // 7. 启动 Image GC
    k.StartGarbageCollection()
    
    // 8. 启动主循环
    k.Run(updates)
    
    // 9. 等待退出
    <-ctx.Done()
    
    return nil
}
```

---

## Kubelet 配置

**位置**: `pkg/kubelet/apis/config/`

关键配置选项：

```yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
# 节点信息
hostname: node1
clusterDNS:
- 10.96.0.10
# 容器运行时
containerRuntimeEndpoint: unix:///var/run/containerd/containerd.sock
# 容器运行时类型
containerRuntime: containerd
# 数据目录
rootDirectory: /var/lib/kubelet
# Pod 目录
podManifestPath: /etc/kubernetes/manifests
# 容器日志目录
containerLogMaxSize: 100Mi
# 容器日志最大文件数
containerLogMaxFiles: 5
# cgroups 驱动
cgroupDriver: systemd
# 系统预留资源
systemReserved:
  cpu: 500m
  memory: 500Mi
# Kubelet 预留资源
kubeReserved:
  cpu: 100m
  memory: 100Mi
# 最大 Pod 数量
maxPods: 110
# Pod CIDR
podCIDR: 10.244.0.0/24
```

---

## CRI (Container Runtime Interface)

Kubelet 通过 CRI 与容器运行时通信：

### CRI 服务接口

```go
// Runtime Service
type RuntimeService interface {
    // 版本信息
    Version(apiVersion string) (*VersionResponse, error)
    
    // Sandbox 管理
    RunPodSandbox(config *RunPodSandboxRequest) (*RunPodSandboxResponse, error)
    StopPodSandbox(podSandboxID string) error
    RemovePodSandbox(podSandboxID string) error
    PodSandboxStatus(podSandboxID string, verbose bool) (*PodSandboxStatusResponse, error)
    ListPodSandbox(filter *PodSandboxFilter) (*ListPodSandboxResponse, error)
    
    // 容器管理
    CreateContainer(config *CreateContainerRequest) (*CreateContainerResponse, error)
    StartContainer(containerID string) (*StartContainerResponse, error)
    StopContainer(containerID string, timeout int64) error
    RemoveContainer(containerID string) error
    ExecSync(req *ExecSyncRequest) (*ExecSyncResponse, error)
    PortForward(podSandboxID string, port int32, stream io.ReadWriteCloser) error
    ContainerStatus(containerID string, verbose bool) (*ContainerStatusResponse, error)
    ListContainers(filter *ContainerFilter) (*ListContainersResponse, error)
    
    // 镜像管理
    PullImage(image *ImageSpec, auth *AuthConfig) (*PullImageResponse, error)
    ListImages(filter *ImageFilter) (*ListImagesResponse, error)
    ImageStatus(image *ImageSpec) (*ImageStatusResponse, error)
    RemoveImage(image *ImageSpec) (*RemoveImageResponse, error)
}

// Image Service
type ImageManagerService interface {
    PullImage(image *ImageSpec, auth *AuthConfig) (*PullImageResponse, error)
    ListImages(filter *ImageFilter) (*ListImagesResponse, error)
    ImageStatus(image *ImageSpec) (*ImageStatusResponse, error)
    RemoveImage(image *ImageSpec) (*RemoveImageResponse, error)
}
```

---

## Kubelet 关键概念

### 1. Pod QoS (Quality of Service)

Kubernetes 根据资源请求和限制定义 3 种 QoS 级别：

```yaml
# Guaranteed - 请求 = 限制
resources:
  requests:
    cpu: "1"
    memory: "1Gi"
  limits:
    cpu: "1"
    memory: "1Gi"

# Burstable - 请求 < 限制
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"

# BestEffort - 无限制
resources:
  requests:
    cpu: "250m"
    memory: "256Mi"
```

### 2. Pod 生命周期

```
Pending → Running → Succeeded
        ↓
       → Failed
```

### 3. 容器重启策略

```yaml
restartPolicy: Always       # 总是重启
restartPolicy: OnFailure    # 失败时重启
restartPolicy: Never        # 从不重启
```

### 4. 静态 Pod

Kubelet 支持静态 Pod（直接从文件加载）：

```bash
# 位置: /etc/kubernetes/manifests/
cat static-pod.yaml
```

静态 Pod 特点：
- 由 Kubelet 管理
- 直接在节点上创建
- 不会通过 API Server 创建镜像 Pod
- 删除文件即可删除

---

## 性能优化

### 1. 本地缓存
- Pod 状态缓存
- 容器状态缓存
- 镜像列表缓存

### 2. 批量操作
- 批量状态更新
- 批量镜像删除
- 批量容器操作

### 3. 并发处理
- 每个 Pod 一个 goroutine
- 容器操作并发
- 状态同步并发

### 4. 资源限制
- CPU/内存限制
- 磁盘 I/O 限制
- 网络带宽限制

---

## Kubelet 指标

```
# Pod 工作线程指标
kubelet_worker_duration_seconds
kubelet_worker_start_duration_seconds
kubelet_pods_per_worker

# 容器运行时指标
kubelet_runtime_operations_total
kubelet_runtime_operations_duration_seconds

# 镜像管理指标
kubelet_image_gc_duration_seconds
kubelet_pull_duration_seconds

# 卷管理指标
kubelet_volume_stats_used_bytes
kubelet_volume_stats_available_bytes

# 探针指标
kubelet_probe_duration_seconds
kubelet_probe_total
```

---

## 总结

**Kubelet 核心特点：**
1. **Pod Workers** - 每个 Pod 一个 goroutine，状态机驱动
2. **CRI 抽象** - 解耦容器运行时实现
3. **资源管理** - CPU、内存、设备、拓扑感知
4. **存储管理** - 卷的生命周期完整管理
5. **健康检查** - 多种探针类型，自动重启
6. **状态同步** - 实时同步到 API Server
7. **驱逐机制** - 资源压力时主动保护节点

**设计优势：**
- 高度模块化
- 事件驱动
- 异步处理
- 本地缓存优化
- 资源隔离

---

## 下一步分析

1. **etcd 集成** - 状态存储和一致性
2. **网络模型** - Service、Ingress、CNI
3. **存储机制** - PV/PVC、StorageClass、CSI
4. **API 设计** - CRD、Conversion Webhook

---

**分析完成时间**: 2026-02-09
**分析人员**: 小宝
**下一步**: 分析 etcd 集成和状态存储
