# Kubernetes 项目分析 - 07: etcd 集成

**项目路径**: `~/work/todo/kubernetes`
**分析日期**: 2026-02-10
**组件**: etcd 集成
**位置**: `staging/src/k8s.io/apiserver/pkg/storage/etcd3/`

---

## etcd 集成概述

etcd 是 Kubernetes 的状态存储后端，存储所有集群状态数据。

**核心职责：**
1. 存储 Kubernetes 资源对象（Pod、Service、Node 等）
2. 提供 Watch 机制，实现事件驱动
3. 保证数据一致性和持久化
4. 支持事务操作
5. 实现版本控制和并发控制

---

## 目录结构

```
staging/src/k8s.io/apiserver/pkg/storage/etcd3/
├── store.go              # 核心存储接口实现
├── watcher.go            # Watch 机制实现
├── event.go              # 事件定义
├── lease_manager.go      # 租约管理
├── compact.go            # 数据压缩
├── healthcheck.go         # 健康检查
├── latency_tracker.go    # 延迟跟踪
├── stats.go              # 统计信息
├── decoder.go            # 解码器
├── logger.go             # 日志记录
├── corrupt_obj_deleter.go # 腐败对象清理
├── metrics/             # Prometheus 指标
├── preflight/           # 启动前检查
└── testing/             # 测试工具
```

---

## 存储接口（Store）

**位置**: `store.go`

### 核心数据结构

```go
type store struct {
    client             *kubernetes.Client  // etcd v3 客户端
    codec              runtime.Codec      // 编解码器
    versioner          storage.Versioner  // 版本管理器
    transformer        value.Transformer // 值转换器
    pathPrefix         string           // 路径前缀
    groupResource      schema.GroupResource // 组资源
    watcher            *watcher         // Watcher
    leaseManager       *leaseManager    // 租约管理器
    decoder            Decoder           // 解码器
    listErrAggrFactory func() ListErrorAggregator

    resourcePrefix string
    newListFunc    func() runtime.Object
    compactor      Compactor         // 压缩器

    collectorMux          sync.RWMutex
    resourceSizeEstimator *resourceSizeEstimator
}
```

### 核心操作

#### 1. Get（读取对象）

```go
func (s *store) Get(ctx context.Context, key string, opts storage.GetOptions, out runtime.Object) error {
    // 1. 从 etcd 读取 key
    getResp, err := s.client.Get(ctx, key, opts.ResourceVersion...)

    // 2. 解码对象
    data, _, err := s.transformer.TransformToStorage(data)
    if err != nil {
        return err
    }

    // 3. 验证数据完整性
    objState, err := s.getStateFromObject(out)
    if err != nil {
        return err
    }

    // 4. 反序列化
    return s.decoder.Decode(data, out, s.versioner)
}
```

**关键特性：**
- 支持资源版本过滤
- 数据完整性验证
- 值转换和解码
- 错误处理和重试

---

#### 2. Create（创建对象）

```go
func (s *store) Create(ctx context.Context, key string, obj, out runtime.Object, ttl uint64) error {
    // 1. 序列化对象
    data, err := runtime.Encode(s.codec, obj)
    if err != nil {
        return err
    }

    // 2. 值转换（加密等）
    data, err := s.transformer.TransformToStorage(data)
    if err != nil {
        return err
    }

    // 3. 获取租约
    leaseID, err := s.leaseManager.GetLease(ctx, ttl)
    if err != nil {
        return err
    }

    // 4. 创建事务
    txn := s.client.KV.Txn(ctx)
    txn.Then(
        clientv3.OpPut(key, string(data), clientv3.WithLease(leaseID)),
    )

    // 5. 提交事务
    resp, err := txn.Commit()
    if err != nil {
        return err
    }

    // 6. 更新资源版本
    out.(*unstructured.Unstructured).SetResourceVersion(
        strconv.FormatUint(resp.Header.Revision, 10),
    )

    return nil
}
```

**关键特性：**
- 原子操作
- 自动租约管理
- 事务保证
- 资源版本更新

---

#### 3. Update（更新对象）

```go
func (s *store) ConditionalUpdate(
    ctx context.Context,
    key string,
    dest runtime.Object,
    f storage.UpdateFunc,
    ignoreNotFound bool,
    cachedExistingObject runtime.Object,
    preconditions *storage.Preconditions,
) (int64, runtime.Object, error) {
    // 1. 获取当前状态
    currState, err := s.getState(ctx, key, ignoreNotFound)
    if err != nil {
        return 0, nil, err
    }

    // 2. 验证前置条件
    if preconditions != nil {
        if preconditions.UID != nil {
            if currState.obj.(*unstructured.Unstructured).GetUID() != *preconditions.UID {
                return 0, nil, apierrors.NewConflict(...)
            }
        }
    }

    // 3. 应用更新函数
    userUpdate := func() (runtime.Object, error) {
        return f(currState.obj)
    }
    updatedObj, rev, err := s.updateState(currState, userUpdate)

    // 4. 序列化并转换
    data, err := runtime.Encode(s.codec, updatedObj)
    data, err = s.transformer.TransformToStorage(data)

    // 5. 条件更新事务
    txn := s.client.KV.Txn(ctx)
    txn.If(
        clientv3.Compare(clientv3.ModRevision(key), "=", currState.rev),
    ).Then(
        clientv3.OpPut(key, string(data), clientv3.WithLease(leaseID)),
    )

    // 6. 提交事务
    resp, err := txn.Commit()
    if err != nil {
        return 0, nil, err
    }

    return resp.Header.Revision, updatedObj, nil
}
```

**关键特性：**
- 乐观并发控制（Compare-and-Set）
- 前置条件验证
- 版本检查
- 条件更新

---

#### 4. Delete（删除对象）

```go
func (s *store) Delete(
    ctx context.Context,
    key string,
    out runtime.Object,
    preconditions *storage.Preconditions,
    validateDeletion storage.ValidateObjectFunc,
    cachedExistingObject runtime.Object,
    options storage.DeleteOptions,
) error {
    // 1. 获取当前状态
    currentState, err := s.getState(ctx, key, false)
    if err != nil {
        return err
    }

    // 2. 验证删除条件
    if preconditions != nil {
        if preconditions.UID != nil {
            if currentState.obj.(*unstructured.Unstructured).GetUID() != *preconditions.UID {
                return apierrors.NewConflict(...)
            }
        }
    }

    // 3. 自定义验证
    if validateDeletion != nil {
        if err := validateDeletion(currentState.obj); err != nil {
            return err
        }
    }

    // 4. 删除事务
    txn := s.client.KV.Txn(ctx)
    txn.If(
        clientv3.Compare(clientv3.ModRevision(key), "=", currentState.rev),
    ).Then(
        clientv3.OpDelete(key),
    )

    // 5. 提交事务
    resp, err := txn.Commit()
    if err != nil {
        return err
    }

    return nil
}
```

**关键特性：**
- 乐观删除（版本检查）
- 前置条件验证
- 自定义验证钩子
- 级联删除支持

---

#### 5. List（列表对象）

```go
func (s *store) GetList(ctx context.Context, key string, opts storage.ListOptions, listObj runtime.Object) error {
    // 1. 计算前缀
    keyPrefix := key
    if !strings.HasSuffix(keyPrefix, "/") {
        keyPrefix = keyPrefix + "/"
    }

    // 2. 递归查询 etcd
    listOpts := kubernetes.ListOptions{
        Prefix:    keyPrefix,
        SortOrder: kubernetes.SortByKey,
        Limit:     opts.Limit,
        Continue:  opts.Continue,
        Revision:  opts.ResourceVersion,
    }

    resp, err := s.client.Get(ctx, listOpts...)
    if err != nil {
        return err
    }

    // 3. 批量解码
    listPtr, err := s.newListFunc()
    for _, kv := range resp.Kvs {
        data, _, err := s.transformer.TransformFromStorage(kv.Value)
        if err != nil {
            s.listErrAggrFactory().Aggregate(string(kv.Key), err)
            continue
        }

        obj, err := s.decoder.Decode(data, s.versioner)
        if err != nil {
            s.listErrAggrFactory().Aggregate(string(kv.Key), err)
            continue
        }

        appendList(listPtr, obj)
    }

    // 4. 设置分页信息
    setContinue(listPtr, resp.Header.Revision, resp.More)

    return s.listErrAggrFactory().Err()
}
```

**关键特性：**
- 递归查询
- 分页支持（Limit、Continue）
- 排序支持
- 错误聚合

---

## Watch 机制

**位置**: `watcher.go`

### 核心概念

Watch 允许客户端监听数据变化，实现事件驱动架构：

```
etcd 状态变化
    ↓
Watcher
    ↓
事件流（ADDED、MODIFIED、DELETED）
    ↓
API Server / Controller
```

### Watcher 接口

```go
type watcher struct {
    client                   *clientv3.Client
    codec                    runtime.Codec
    newFunc                  func() runtime.Object
    objectType               string
    groupResource            schema.GroupResource
    versioner                storage.Versioner
    transformer              value.Transformer
    getCurrentStorageRV      func(context.Context) (uint64, error)
    getResourceSizeEstimator func() *resourceSizeEstimator
}
```

### Watch 流程

```go
func (w *watcher) Watch(ctx context.Context, key string, rev int64, opts storage.ListOptions) (watch.Interface, error) {
    // 1. 确定起始版本
    startWatchRV, err := w.getStartWatchResourceVersion(ctx, rev, opts)

    // 2. 创建 Watch Channel
    wc := w.createWatchChan(
        ctx,
        key,
        startWatchRV,
        opts.Recursive,
        opts.ProgressNotify,
        opts.Predicate,
    )

    // 3. 启动事件处理循环
    go wc.run(isInitialEventsEndBookmarkRequired, areInitialEventsRequired)

    // 4. 通知初始化完成
    utilflowcontrol.WatchInitialized(ctx)

    return wc, nil
}
```

### 事件类型

```go
type event struct {
    key              string     // 对象的 etcd key
    value            []byte     // 当前值
    prevValue        []byte     // 前一个值
    rev              int64      // etcd 修订号
    isDeleted        bool       // 是否删除事件
    isCreated        bool       // 是否创建事件
    isProgressNotify bool       // 是否进度通知
    isInitialEventsEndBookmark bool // 初始事件结束标记
}
```

**事件转换：**
```go
func parseEvent(e *clientv3.Event) (*event, error) {
    ret := &event{
        key:       string(e.Kv.Key),
        value:     e.Kv.Value,
        rev:       e.Kv.ModRevision,
        isDeleted: e.Type == clientv3.EventTypeDelete,
        isCreated: e.IsCreate(),
    }
    if e.PrevKv != nil {
        ret.prevValue = e.PrevKv.Value
    }
    return ret, nil
}
```

### 事件处理循环

```go
func (wc *watchChan) run(sendInitialEventsEndBookmark, sendInitialEvents) {
    defer close(wc.resultChan)
    defer wc.cancel()

    // 1. 初始同步
    if sendInitialEvents {
        wc.syncInitialEvents()
    }

    // 2. 持续监听
    for {
        select {
        case <-wc.ctx.Done():
            return

        case e := <-wc.incomingEventChan:
            wc.processEvent(e)
        }
    }
}

func (wc *watchChan) processEvent(e *event) {
    // 1. 解码对象
    obj, err := wc.decode(e.value)
    if err != nil {
        return
    }

    // 2. 应用谓词过滤
    if !wc.internalPred.Matches(obj) {
        return
    }

    // 3. 转换为 watch.Event
    watchEvent := watch.Event{
        Type:   wc.getEventType(e),
        Object: obj,
    }

    // 4. 发送到结果 Channel
    wc.resultChan <- watchEvent
}
```

**性能优化：**
```go
const (
    incomingBufSize         = 100   // 输入缓冲区大小
    outgoingBufSize         = 100   // 输出缓冲区大小
    processEventConcurrency = 10    // 事件处理并发度
)
```

---

## 租约管理（Lease Manager）

**位置**: `lease_manager.go`

### 租约机制

etcd 租约用于管理对象的 TTL（生存时间）：

```
对象创建 → 获取租约 → 定期续期 → 对象删除
```

### 租约管理器

```go
type leaseManager struct {
    client                  *clientv3.Client

    leaseMu                 sync.Mutex
    prevLeaseID             clientv3.LeaseID
    prevLeaseExpirationTime time.Time

    // 租约重用配置
    leaseReuseDurationSeconds   int64
    leaseReuseDurationPercent   float64
    leaseMaxAttachedObjectCount int64
    leaseAttachedObjectCount    int64
}
```

### 租约获取

```go
func (l *leaseManager) GetLease(ctx context.Context, ttl int64) (clientv3.LeaseID, error) {
    now := time.Now()

    // 1. 检查前一个租约是否可重用
    reuseDurationSeconds := l.getReuseDurationSecondsLocked(ttl)
    valid := now.Add(time.Duration(ttl)).Before(l.prevLeaseExpirationTime)
    sufficient := now.Add(time.Duration(ttl+reuseDurationSeconds)).After(l.prevLeaseExpirationTime)

    if valid && sufficient && l.leaseAttachedObjectCount <= l.leaseMaxAttachedObjectCount {
        // 重用前一个租约
        return l.prevLeaseID, nil
    }

    // 2. 从 etcd 请求新租约
    ttl += reuseDurationSeconds  // 添加额外时间
    lcr, err := l.client.Lease.Grant(ctx, ttl)
    if err != nil {
        return clientv3.LeaseID(0), err
    }

    // 3. 缓存新租约 ID
    l.prevLeaseID = lcr.ID
    l.prevLeaseExpirationTime = now.Add(time.Duration(ttl) * time.Second)
    l.leaseAttachedObjectCount = 1

    return lcr.ID, nil
}
```

**租约重用策略：**
```go
const (
    defaultLeaseReuseDurationSeconds = 60    // 默认重用 60 秒
    defaultLeaseMaxObjectCount       = 1000 // 最多绑定 1000 个对象
)

// 重用条件：
// 1. 前一个租约仍然有效（valid）
// 2. 新对象请求的 TTL 在前一个租约的合理范围内（sufficient）
// 3. 附加对象数未超过限制
```

**好处：**
- 减少 etcd 租约操作（开销大）
- 提高性能
- 自动管理

---

## 数据压缩（Compaction）

**位置**: `compact.go`

### 压缩机制

etcd 保存所有历史版本，需要定期压缩以释放空间：

```
写入 v1 → v2 → v3 → v4 → v5
                      ↓
压缩到 v5（删除 v1-v4）
```

### 压缩器

```go
type compactor struct {
    client  *clientv3.Client

    compactRevision int64     // 当前压缩版本
    interval        time.Duration  // 压缩间隔（默认 5 分钟）
}
```

### 压缩算法

```go
// 压缩协调算法（基于租约）
func (c *compactor) runCompactLoop(stopCh chan struct{}) {
    for {
        select {
        case <-time.After(c.interval):
        case <-ctx.Done():
            return
        }

        // 1. 获取当前压缩版本
        compactTime, rev, compactRev, err := Compact(
            ctx,
            c.client,
            compactTime,
            rev,
        )

        if compactRev != 0 {
            // 2. 更新压缩版本
            c.UpdateCompactRevision(compactRev)
        }
    }
}
```

### 压缩实现

```go
func Compact(ctx context.Context, client *clientv3.Client, expectVersion, rev int64) (currentVersion, currentRev, compactRev int64, err error) {
    // 1. 条件更新压缩版本（CAS）
    resp, err := client.KV.Txn(ctx).If(
        clientv3.Compare(clientv3.Version(compactRevKey), "=", expectVersion),
    ).Then(
        clientv3.OpPut(compactRevKey, strconv.FormatInt(rev, 10)),
    ).Else(
        clientv3.OpGet(compactRevKey),
    ).Commit()

    if err != nil {
        return expectVersion, rev, 0, err
    }

    currentRev = resp.Header.Revision

    if !resp.Succeeded {
        // 读取当前版本
        currentVersion = resp.Responses[0].GetResponseRange().Kvs[0].Version
        compactRev, err = strconv.ParseInt(string(resp.Responses[0].GetResponseRange().Kvs[0].Value), 10, 64)
        return currentVersion, currentRev, compactRev, nil
    }

    // 2. 更新版本
    currentVersion = expectVersion + 1

    // 3. 执行压缩
    if rev == 0 {
        // 首次启动，不压缩
        return currentVersion, currentRev, 0, nil
    }

    if _, err = client.Compact(ctx, rev); err != nil {
        return currentVersion, currentRev, 0, err
    }

    return currentVersion, currentRev, rev, nil
}
```

**压缩协调：**
- 使用 `compact_rev_key` 作为协调点
- 基于 Compare-and-Swap (CAS) 保证原子性
- 多 API Server 实例自动协调
- 默认间隔 5 分钟

**压缩保证：**
- 不会丢失数据（只压缩旧版本）
- 正常情况下 5 分钟一次
- 故障转移时 <10 分钟

---

## 乐观并发控制

### 版本检查

```go
// 前置条件
type Preconditions struct {
    UID              *types.UID
    ResourceVersion *string
}

// 条件更新
txn.If(
    clientv3.Compare(clientv3.ModRevision(key), "=", currentRev),
).Then(
    clientv3.OpPut(key, newData),
).Commit()
```

**工作原理：**
```
1. 读取对象和版本（rev = 10）
2. 客户端修改对象
3. 提交时检查版本（mod_rev == 10）
4. 如果版本匹配，提交成功
5. 如果版本不匹配（rev = 11），返回 Conflict 错误
```

### 冲突处理

```go
if apierrors.IsConflict(err) {
    // 版本冲突，重试
    return RetryOnConflict(...)
}
```

---

## 事务支持

```go
// 多操作事务
txn := s.client.KV.Txn(ctx)

txn.If(
    clientv3.Compare(key1, "=", value1),
    clientv3.Compare(key2, "=", value2),
).Then(
    clientv3.OpPut(key1, newData1),
    clientv3.OpPut(key2, newData2),
).Commit()
```

**事务特性：**
- 原子性（全部成功或全部失败）
- 多条件检查
- 多操作批量提交

---

## 资源版本管理

```go
// 资源版本是 etcd 的修订号
type ResourceVersion string

// 获取当前资源版本
func (s *store) GetCurrentResourceVersion(ctx context.Context) (uint64, error) {
    resp, err := s.client.Get(ctx, "compact_rev_key")
    if err != nil {
        return 0, err
    }
    return resp.Header.Revision, nil
}

// 转换修订号为资源版本
strconv.FormatUint(rev, 10)
```

**资源版本用途：**
- 版本控制
- 乐观并发检查
- Watch 起始点
- 列表分页

---

## 数据转换（Transformer）

```go
// 值转换器接口
type Transformer interface {
    TransformToStorage(data []byte) ([]byte, error)
    TransformFromStorage(data []byte) ([]byte, error)
}

// 使用场景：
// 1. 加密/解密
// 2. 压缩/解压
// 3. 数据验证

// 加密转换器示例
type encryptedTransformer struct {
    encryptor encryption.Encryptor
}

func (t *encryptedTransformer) TransformToStorage(data []byte) ([]byte, error) {
    return t.encryptor.Encrypt(data)
}

func (t *encryptedTransformer) TransformFromStorage(data []byte) ([]byte, error) {
    return t.encryptor.Decrypt(data)
}
```

---

## 延迟跟踪

**位置**: `latency_tracker.go`

跟踪 etcd 操作延迟：

```go
type latencyTracker struct {
    tracker   *metrics.DelayTracker
    operation  string
    suffix     string
}

// 记录操作延迟
func (l *latencyTracker) Record(op operation, start time.Time) {
    duration := time.Since(start)
    l.tracker.RecordDuration(op, duration)
}
```

**监控指标：**
```go
// etcd 读延迟
etcd_request_duration_seconds{operation="get",quantile="0.5|0.9|0.99"}

// etcd 写延迟
etcd_request_duration_seconds{operation="put",quantile="0.5|0.9|0.99"}

// etcd Watch 延迟
etcd_request_duration_seconds{operation="watch",quantile="0.5|0.9|0.99"}
```

---

## 统计信息

**位置**: `stats.go`

收集 etcd 存储统计：

```go
type Stats struct {
    Size int64

    // 对象数量统计
    ObjectCount int

    // 按资源类型统计
    ResourceStats map[string]ResourceStats
}
```

**用途：**
- 监控存储使用
- 容量规划
- 性能分析

---

## 健康检查

**位置**: `healthcheck.go`

检查 etcd 集群健康：

```go
type HealthChecker interface {
    Check(ctx context.Context) error
}

// 检查项目：
// 1. 连接性
// 2. 响应性
// 3. 数据一致性
```

---

## 性能优化

### 1. 租约重用

```go
// 减少租约操作开销
if leaseManager.CanReuse(prevLease) {
    return prevLeaseID
}
```

### 2. 批量读取

```go
// 使用 Range API 批量读取
resp, err := s.client.Get(ctx,
    clientv3.WithPrefix(key),
    clientv3.WithSort(clientv3.SortByKey),
    clientv3.WithLimit(10000),
)
```

### 3. 并发 Watch

```go
// 多个 Watcher 并发运行
const processEventConcurrency = 10

for i := 0; i < processEventConcurrency; i++ {
    go wc.processEvent()
}
```

### 4. 连接池

```go
// etcd 客户端连接池
client, err := clientv3.New(
    clientv3.Config{
        Endpoints:            endpoints,
        AutoSyncInterval:     30 * time.Second,
        DialTimeout:          5 * time.Second,
        DialKeepAliveTime:    30 * time.Second,
        DialKeepAliveTimeout: 5 * time.Second,
        MaxCallSendMsgSize:  10 * 1024 * 1024, // 10MB
        MaxCallRecvMsgSize:  10 * 1024 * 1024,
    },
)
```

---

## 总结

**etcd 集成核心特点：**
1. **强一致性** - 乐观并发控制 + 事务
2. **事件驱动** - Watch 机制支持
3. **高可用性** - 多副本 Raft 共识
4. **持久化** - 持久化存储所有状态
5. **版本控制** - 资源版本支持
6. **自动管理** - 租约、压缩、清理

**设计优势：**
- 简单的 KV 接口
- 事务支持
- Watch 机制
- 高性能

**关键优化：**
- 租约重用减少开销
- 定期压缩释放空间
- 批量操作提升性能
- 并发处理提高吞吐

---

## 下一步分析

1. **网络模型** - Service、Ingress、CNI
2. **存储机制** - PV/PVC、StorageClass、CSI
3. **API 设计** - CRD、Conversion Webhook
4. **测试策略** - 单元测试、集成测试、E2E

---

**分析完成时间**: 2026-02-10
**分析人员**: 小宝
**下一步**: 分析网络模型
