# Kubernetes 项目分析 - 09: 存储机制

**项目路径**: `~/work/todo/kubernetes`
**分析日期**: 2026-02-10
**主题**: PV/PVC、StorageClass、CSI

---

## 存储机制概述

Kubernetes 存储系统支持动态和静态持久化存储：

**核心组件：**
1. **PV（PersistentVolume）** - 集群级别的存储资源
2. **PVC（PersistentVolumeClaim）** - 命名空间级别的存储请求
3. **StorageClass** - 存储类定义
4. **CSI（Container Storage Interface）** - 容器存储接口标准

---

## PV（PersistentVolume）

### PV 概述

PV 是集群级别的存储资源，管理员预先创建的存储：

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: pv-hostpath
spec:
  capacity:
    storage: 10Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  hostPath:
    path: /mnt/data
```

### PV 状态

```go
type PersistentVolumePhase string

const (
    // Available: PV 可用，未被绑定
    VolumeAvailable PersistentVolumePhase = "Available"

    // Bound: PV 已绑定到 PVC
    VolumeBound PersistentVolumePhase = "Bound"

    // Released: PVC 删除，PV 释放
    VolumeReleased PersistentVolumePhase = "Released"

    // Failed: PV 失败
    VolumeFailed PersistentVolumePhase = "Failed"
)
```

### PV 回收策略

```yaml
spec:
  persistentVolumeReclaimPolicy: Retain  # 或 Delete
```

**Retain**: PVC 删除后 PV 保留，需要手动清理
**Delete**: PVC 删除后 PV 自动删除

---

## PVC（PersistentVolumeClaim）

### PVC 概述

PVC 是命名空间级别的存储请求，用户声明需要的存储：

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: pvc-claim
  namespace: default
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  storageClassName: standard
```

### PVC 状态

```go
type PersistentVolumeClaimPhase string

const (
    // Pending: PVC 等待绑定
    ClaimPending PersistentVolumeClaimPhase = "Pending"

    // Bound: PVC 已绑定到 PV
    ClaimBound PersistentVolumeClaimPhase = "Bound"

    // Lost: PV 被删除，PVC 处于 Lost 状态
    ClaimLost PersistentVolumeClaimPhase = "Lost"
)
```

### PVC 访问模式

```yaml
spec:
  accessModes:
    - ReadWriteOnce    # RWO - 单节点读写
    - ReadOnlyMany     # ROX - 多节点只读
    - ReadWriteMany    # RWX - 多节点读写
```

---

## 绑定机制

### 双向绑定

PV 和 PVC 之间是双向绑定关系：

```
PV.Spec.ClaimRef ↔ PVC.Spec.VolumeName
```

**设计原则：**
- 任何时刻最多一个 PVC 绑定到一个 PV
- PV 和 PVC 可以各自独立删除
- 需要确保最终一致性

### PV Controller

**位置**: `pkg/controller/volume/persistentvolume/pv_controller.go`

**职责：**
- 监听 PV 和 PVC 变化
- 管理绑定和解绑
- 处理预绑定（Pre-bound）
- 支持 Provisioning 和 Deletion

**工作流程：**
```
1. PVC 创建
    ↓
2. 查找合适的 PV（按 StorageClass、容量、访问模式）
    ↓
3. 如果找到 PV，绑定（update PV.ClaimRef、PVC.VolumeName）
    ↓
4. 如果未找到 PV，触发 Provisioning（如果 StorageClass 支持动态供应）
    ↓
5. 更新 PVC 状态为 Bound
    ↓
6. Kubelet 挂载卷到 Pod
```

**核心方法：**
```go
// 同步 PVC
func (ctrl *PVController) syncClaim(ctx context.Context, claim *v1.PersistentVolumeClaim) error {
    // 1. 检查 PVC 是否已绑定
    if claim.Spec.VolumeName != "" {
        return ctrl.syncBoundClaim(ctx, claim)
    }

    // 2. 查找合适的 PV
    volume, err := ctrl.findBestVolumeForClaim(claim)

    // 3. 如果找到 PV，绑定
    if volume != nil {
        return ctrl.bindVolumeToClaim(ctx, volume, claim)
    }

    // 4. 否则触发 Provisioning
    return ctrl.provisionClaim(ctx, claim)
}

// 绑定 PV 到 PVC
func (ctrl *PVController) bindVolumeToClaim(
    ctx context.Context,
    volume *v1.PersistentVolume,
    claim *v1.PersistentVolumeClaim,
) (*v1.PersistentVolume, error) {
    // 1. 更新 PV.Spec.ClaimRef
    volume.Spec.ClaimRef = &v1.ObjectReference{
        APIVersion: "v1",
        Kind:       "PersistentVolumeClaim",
        Name:       claim.Name,
        UID:         claim.UID,
    }

    // 2. 更新 PVC.Spec.VolumeName
    claim.Spec.VolumeName = volume.Name

    // 3. 更新 PV 状态为 Bound
    volume.Status.Phase = v1.VolumeBound

    // 4. 原子更新
    updatedPV, err := ctrl.kubeClient.CoreV1().PersistentVolumes().Update(ctx, volume)
    updatedPVC, err := ctrl.kubeClient.CoreV1().PersistentVolumeClaims().Update(ctx, claim)

    return updatedPV, nil
}
```

### PVC Protection

**位置**: `pkg/controller/volume/pvcprotection/pvc_protection_controller.go`

**职责：**
- 保护正在使用的 PVC
- 防止误删除
- Finalizer 管理机制

**保护机制：**
```go
// 添加 Finalizer
func (c *Controller) addFinalizer(pvc *v1.PersistentVolumeClaim) error {
    pvc.Finalizers = append(pvc.Finalizers, "kubernetes.io/pvc-protection")
    _, err := c.pvcLister.PersistentVolumeClaims(pvc.Namespace).Update(ctx, pvc)
    return err
}

// 移除 Finalizer
func (c *Controller) removeFinalizer(pvc *v1.PersistentVolumeClaim) error {
    pvc.Finalizers = removeString(pvc.Finalizers, "kubernetes.io/pvc-protection")
    _, err := c.pvcLister.PersistentVolumeClaims(pvc.Namespace).Update(ctx, pvc)
    return err
}

// 删除 PVC
func (c *Controller) deletePVC(ctx context.Context, pvc *v1.PersistentVolumeClaim) error {
    // 1. 检查是否有 Pod 使用
    pods, err := c.findPodsUsingPVC(pvc)
    if len(pods) > 0 {
        return fmt.Errorf("PVC %s is in use by %d pods", pvc.Name, len(pods))
    }

    // 2. 移除 Finalizer
    if err := c.removeFinalizer(pvc); err != nil {
        return err
    }

    // 3. 删除 PVC
    return c.pvcLister.PersistentVolumeClaims(pvc.Namespace).Delete(ctx, pvc)
}
```

---

## StorageClass

### StorageClass 概述

StorageClass 定义了存储的类别和供应策略：

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast
provisioner: kubernetes.io/aws-ebs
parameters:
  type: gp2
  iopsPerGB: "10"
allowVolumeExpansion: true
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
```

### StorageClass 字段

```go
type StorageClass struct {
    Provisioner string        // 供应驱动名称
    Parameters map[string]string  // 驱动参数
    ReclaimPolicy *ReclaimPolicy  // 回收策略
    VolumeBindingMode *VolumeBindingMode  // 绑定模式
    AllowedTopologies []string  // 允许的拓扑域
    MountOptions []string  // 挂载选项
}
```

**VolumeBindingMode:**
```go
type VolumeBindingMode string

const (
    // Immediate: 立即绑定
    VolumeBindingImmediate VolumeBindingMode = "Immediate"

    // WaitForFirstConsumer: 等待 Pod 创建
    VolumeBindingWaitForFirstConsumer VolumeBindingMode = "WaitForFirstConsumer"
)
```

---

## 动态供应（Provisioning）

### 供应流程

```
1. PVC 创建（未指定 PV）
    ↓
2. PV Controller 检测到未绑定 PVC
    ↓
3. 根据 StorageClass 找到 Provisioner
    ↓
4. 调用外部 Provisioner 创建 PV
    ↓
5. Provisioner 创建物理存储（如 AWS EBS）
    ↓
6. Provisioner 返回 PV 对象
    ↓
7. PV Controller 绑定 PV 到 PVC
    ↓
8. Kubelet 挂载卷到 Pod
```

### 外部 Provisioner

**位置**: `pkg/volume/csi/`

```go
type ProvisionableVolumePlugin interface {
    // 创建新卷
    Provision(opts volume.VolumeOptions) (*v1.PersistentVolume, error)

    // 删除卷
    Delete(volume *v1.PersistentVolume) error
}
```

**CSI Provisioner:**
```go
// CSI Driver 实现 Provisioner
type CSIProvisioner struct {
    driverName string
    csiClient  csi.Client
}

func (p *CSIProvisioner) Provision(opts volume.VolumeOptions) (*v1.PersistentVolume, error) {
    // 1. 调用 CSI CreateVolume
    resp, err := p.csiClient.CreateVolume(ctx, &csi.CreateVolumeRequest{
        Name:               opts.PVName,
        CapacityRange:      opts.PVC.Spec.Resources.Requests.Storage,
        VolumeCapabilities: p.getCSICapabilities(opts),
        Parameters:         opts.StorageClass.Parameters,
    })

    if err != nil {
        return nil, err
    }

    // 2. 创建 PV 对象
    pv := &v1.PersistentVolume{
        ObjectMeta: metav1.ObjectMeta{
            Name:       opts.PVName,
            Annotations: map[string]string{
                "pv.kubernetes.io/provisioned-by": p.driverName,
            },
        },
        Spec: v1.PersistentVolumeSpec{
            Capacity: v1.ResourceList{
                v1.ResourceStorage: *resp.Volume.CapacityBytes,
            },
            AccessModes: opts.PVC.Spec.AccessModes,
            PersistentVolumeSource: v1.PersistentVolumeSource{
                CSI: &v1.CSIPersistentVolumeSource{
                    Driver:           p.driverName,
                    VolumeHandle:     resp.Volume.VolumeId,
                    FsType:          resp.Volume.VolumeContext.FsType,
                    VolumeAttributes: resp.Volume.VolumeContext,
                },
            },
        },
    }

    return pv, nil
}
```

---

## CSI（Container Storage Interface）

### CSI 概述

CSI 是容器存储接口标准，解耦存储驱动和 Kubernetes：

```
Kubernetes
    ↓
CSI Controller
    ↓
CSI Driver（外部）
    ↓
物理存储（EBS、NFS 等）
```

### CSI 组件

#### 1. CSI Controller

**职责：**
- 监听 PVC、PV、StorageClass
- 管理卷的创建和删除
- 调用 CSI Driver

#### 2. CSI Driver

**职责：**
- 实现 CSI gRPC 接口
- 管理物理存储
- 处理快照、克隆

#### 3. Node Driver（Kubelet）

**职责：**
- 挂载卷到 Pod
- 发布卷指标
- 处理节点拓扑

---

### CSI gRPC 接口

**位置**: `pkg/volume/csi/csi_plugin.go`

#### Node Service

```go
service NodeServer {
    // 获取节点信息
    NodeGetInfo(context, NodeGetInfoRequest) (NodeGetInfoResponse, error)

    // 发布卷指标
    NodePublishVolume(context, NodePublishVolumeRequest) (NodePublishVolumeResponse, error)

    // 取消发布卷
    NodeUnpublishVolume(context, NodeUnpublishVolumeRequest) (NodeUnpublishVolumeResponse, error)

    // 获取卷状态
    NodeGetVolumeStats(context, NodeGetVolumeStatsRequest) (NodeGetVolumeStatsResponse, error)
}
```

#### Controller Service

```go
service ControllerServer {
    // 创建卷
    CreateVolume(context, CreateVolumeRequest) (CreateVolumeResponse, error)

    // 删除卷
    DeleteVolume(context, DeleteVolumeRequest) (DeleteVolumeResponse, error)

    // 创建快照
    CreateSnapshot(context, CreateSnapshotRequest) (CreateSnapshotResponse, error)

    // 删除快照
    DeleteSnapshot(context, DeleteSnapshotRequest) (DeleteSnapshotResponse, error)

    // 列出卷
    ListVolumes(context, ListVolumesRequest) (ListVolumesResponse, error)

    // 列出快照
    ListSnapshots(context, ListSnapshotsRequest) (ListSnapshotsResponse, error)
}
```

### CSI 插件注册

```go
// CSI Driver 注册
type RegistrationHandler struct {
    csiPlugin *csiPlugin
}

// 验证插件
func (h *RegistrationHandler) ValidatePlugin(pluginName string, endpoint string, versions []string) error {
    // 1. 检查 CSI 版本
    // 2. 验证 gRPC 连通性
    // 3. 获取节点信息
    _, err := csi.NodeGetInfo(ctx, &csi.NodeGetInfoRequest{})
    return err
}

// 注册插件
func (h *RegistrationHandler) RegisterPlugin(pluginName string, endpoint string, versions []string) error {
    // 1. 验证插件
    if err := h.ValidatePlugin(pluginName, endpoint, versions); err != nil {
        return err
    }

    // 2. 存储插件信息
    csiDrivers.Set(pluginName, Driver{
        endpoint:         endpoint,
        highestSupportedVersion: highestVersion,
    })

    return nil
}
```

---

## 卷挂载流程

### Kubelet Volume Manager

**位置**: `pkg/kubelet/volumemanager/volume_manager.go`

```go
type VolumeManager interface {
    // 启动卷管理器
    Run(ctx context.Context, sourcesReady config.SourcesReady)

    // 等待卷附加和挂载
    WaitForAttachAndMount(ctx context.Context, pod *v1.Pod) error

    // 等待卷卸载
    WaitForUnmount(ctx context.Context, pod *v1.Pod) error

    // 获取已挂载的卷
    GetMountedVolumesForPod(podName types.UniquePodName) container.VolumeMap
}
```

### 挂载流程

```
1. PVC 绑定到 PV
    ↓
2. Kubelet Volume Manager 检测到新卷
    ↓
3. 调用 CSI Driver NodePublishVolume
    ↓
4. CSI Driver 挂载卷到节点
    ↓
5. Kubelet 挂载卷到容器
    ↓
6. Pod 可以访问卷
```

---

## 存储卷类型

### 1. 块存储

```yaml
apiVersion: v1
kind: PersistentVolume
spec:
  csi:
    driver: kubernetes.io/aws-ebs
    volumeHandle: vol-1234abcd
    fsType: ext4
```

**用途：**
- 数据库
- 高性能存储
- 原始块设备

---

### 2. 文件存储

```yaml
apiVersion: v1
kind: PersistentVolume
spec:
  nfs:
    server: 10.0.0.1
    path: /exports/data
```

**用途：**
- 共享文件系统
- 配置文件
- 媒体文件

---

### 3. 对象存储

```yaml
apiVersion: v1
kind: PersistentVolume
spec:
  csi:
    driver: s3.csi.aws.com
    volumeHandle: my-bucket
```

**用途：**
- 云存储
- 静态资源
- 数据备份

---

## 卷扩展

### 动态扩展

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  annotations:
    volume.beta.kubernetes.io/storage-class: fast
spec:
  resources:
    requests:
      storage: 10Gi
```

**流程：**
```
1. 用户更新 PVC 容量请求
    ↓
2. CSI Controller 检测到变化
    ↓
3. 调用 CSI ControllerExpandVolume
    ↓
4. CSI Driver 扩展卷
    ↓
5. 更新 PV 容量
    ↓
6. 重新挂载卷到 Pod
```

---

## 存储卷调度

### Volume Scheduler

**位置**: `pkg/scheduler/framework/plugins/volumebinding/`

```go
type VolumeBindingPlugin interface {
    // 绑定卷到节点
    Bind(ctx context.Context, state *CycleState, pod *v1.Pod, volumeMap *PVAssumeState) *status.Result
}
```

**调度流程：**
```
1. Pod 调度
    ↓
2. Volume Binding Plugin 评估卷拓扑
    ↓
3. 选择合适的节点（基于 PV 的节点亲和性）
    ↓
4. 绑定 PV 到节点
    ↓
5. 调度器调度 Pod 到节点
```

---

## 总结

**Kubernetes 存储核心特点：**
1. **声明式存储** - PVC 声明需求，PV 提供资源
2. **动态供应** - StorageClass 自动创建存储
3. **CSI 标准** - 解耦存储驱动和 Kubernetes
4. **双向绑定** - PV 和 PVC 双向指针
5. **PVC Protection** - 防止误删除
6. **拓扑感知** - 基于节点拓扑调度

**设计优势：**
- 灵活的存储抽象
- 标准化接口（CSI）
- 自动化供应
- 跨云提供商统一管理

---

## 下一步分析

1. **API 设计** - CRD、Conversion Webhook
2. **安全机制** - RBAC、Secret、ServiceAccount
3. **测试策略** - 单元测试、集成测试、E2E
4. **构建流程** - 构建目标、Docker 镜像

---

**分析完成时间**: 2026-02-10
**分析人员**: 小宝
**下一步**: 分析 API 设计和 CRD
