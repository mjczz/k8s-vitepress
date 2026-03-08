# Kubernetes 项目分析 - 02: API Server 架构

**项目路径**: `~/work/todo/kubernetes`
**分析日期**: 2026-02-09
**组件**: kube-apiserver
**位置**: `cmd/kube-apiserver/`

---

## API Server 概述

API Server 是 Kubernetes 控制平面的核心组件，作为集群的统一入口点处理所有 REST 操作。

**核心职责：**
1. 提供集群状态的 RESTful API
2. 处理认证、授权、准入控制
3. 验证和配置数据
4. 与 etcd 交互（状态存储）
5. 处理 watch 机制（事件通知）

---

## 目录结构

```
cmd/kube-apiserver/
└── app/                    # API Server 应用逻辑
    ├── server.go          # 主入口和服务器启动
    ├── options.go         # 命令行选项
    └── config.go         # 配置管理
```

---

## 核心代码分析

### 1. 主入口 (server.go)

`kube-apiserver` 的主入口在 `cmd/kube-apiserver/app/server.go`:

```go
// 创建并运行 API Server
func Run(completeOptions completedServerRunOptions, stopCh <-chan struct{}) error {
    // 1. 创建服务器链
    server, err := CreateServerChain(completeOptions, stopCh)
    if err != nil {
        return err
    }

    // 2. 准备运行
    prepared, err := server.PrepareRun()
    if err != nil {
        return err
    }

    // 3. 运行服务器
    return prepared.Run(stopCh)
}
```

**关键步骤：**
1. 创建服务器链（API Server、API Extensions Server）
2. 准备运行环境
3. 启动 HTTP 服务器

---

## API Server 链

Kubernetes API Server 实际上是一个"服务器链"：

```
API Server Chain
├── API Extensions Server
│   └── 处理 CRD 和自定义资源
├── Core API Server
│   └── 处理核心资源 (Pod, Service, etc.)
├── Aggregated API Server
│   └── 聚合 API (Metrics Server, etc.)
└── 通用逻辑
    ├── 认证 (Authentication)
    ├── 授权 (Authorization)
    ├── 准入控制 (Admission Control)
    └── 审计 (Auditing)
```

---

## 核心模块

### 1. 认证 (Authentication)

**位置**: `pkg/apiserver/authentication/`

认证流程：
```
请求 → 认证器链 → 用户身份 → 传递给授权器
```

**支持的认证方式：**
- X.509 客户端证书
- Bearer Token (ServiceAccount)
- OpenID Connect (OIDC)
- Webhook 认证
- Basic Auth (不推荐)

**认证器接口：**
```go
type Request interface {
    // 获取用户信息
    GetUser() user.Info
}

type Authenticator interface {
    AuthenticateRequest(req Request) (*Response, bool, error)
}
```

---

### 2. 授权 (Authorization)

**位置**: `pkg/apiserver/authorization/`

授权流程：
```
请求 → 授权器 → 允许/拒绝
```

**支持的授权方式：**
- **ABAC** (基于属性的访问控制) - 已弃用
- **RBAC** (基于角色的访问控制) - 推荐
- **Webhook** - 外部授权服务

**RBAC 资源：**
- Role (角色)
- ClusterRole (集群角色)
- RoleBinding (角色绑定)
- ClusterRoleBinding (集群角色绑定)

**授权流程：**
```go
type Authorizer interface {
    Authorize(a Attributes) (authorized Decision, reason string, err error)
}

type Decision int

const (
    DecisionDeny  Decision = iota
    DecisionAllow
    DecisionNoOpinion
)
```

---

### 3. 准入控制 (Admission Control)

**位置**: `pkg/apiserver/admission/`

准入控制是请求的最后"关卡"：
```
请求 → 认证 → 授权 → 准入控制 → etcd
```

**两种类型：**
1. **MutatingAdmissionWebhook** - 修改请求
2. **ValidatingAdmissionWebhook** - 验证请求

**内置准入插件：**
- `NamespaceLifecycle` - 命名空间生命周期
- `LimitRanger` - 资源限制
- `ResourceQuota` - 资源配额
- `ServiceAccount` - ServiceAccount 管理
- `PodSecurityPolicy` - Pod 安全策略
- `NodeRestriction` - 节点限制
- `Priority` - 优先级管理

**Webhook 接口：**
```go
type Webhook interface {
    // 评估请求
    Admit(ctx Context, a AdmissionAttributes) Object
    // 验证配置
    ValidateInitialization() error
}
```

---

## 请求处理流程

完整的请求处理流程：

```
1. HTTP 请求
   ↓
2. TLS 终止
   ↓
3. 认证 (Authentication)
   - 验证用户身份
   - 提取用户信息
   ↓
4. 授权 (Authorization)
   - 检查权限 (RBAC)
   - 允许/拒绝
   ↓
5. 准入控制 (Admission Control)
   - Mutating Webhooks (修改)
   - Validating Webhooks (验证)
   ↓
6. 对象验证
   - Schema 验证
   - 默认值填充
   ↓
7. 存储到 etcd
   - 乐观并发控制
   - 版本管理
   ↓
8. 响应返回
   ↓
9. 触发 Watch 事件
   - 通知监听者
```

---

## Watch 机制

**位置**: `pkg/watch/`

Watch 是 Kubernetes 的核心机制，允许客户端监听资源变化：

```go
// Watch 接口
type Watcher interface {
    Watch(ctx context.Context, opts ListOptions) (watch.Interface, error)
}

// Watch 事件类型
type EventType string

const (
    Added    EventType = "ADDED"
    Modified EventType = "MODIFIED"
    Deleted  EventType = "DELETED"
    Error    EventType = "ERROR"
)

// Watch 事件
type Event struct {
    Type EventType
    Object runtime.Object
}
```

**Watch 实现机制：**
1. etcd watch 流
2. 事件过滤和转换
3. 版本管理
4. 缓存同步

---

## HTTP 路由

**位置**: `pkg/apiserver/server/`

API Server 使用 mux (多路复用器) 处理路由：

```go
// 路由组
type APIServerHandler struct {
    FullHandlerChain http.Handler
    GoRestfulContainer *restful.Container
    NonGoRestfulMux    *mux.PathRecorderMux
}
```

**路由前缀：**
- `/api/v1` - 核心 API
- `/apis/apps/v1` - Apps API
- `/apis/batch/v1` - Batch API
- `/apis/{group}/{version}` - 其他 API 组

---

## etcd 集成

**位置**: `pkg/storage/`

etcd 是 Kubernetes 的状态存储后端：

```go
// 存储接口
type Interface interface {
    // 获取对象
    Get(ctx context.Context, key string, opts GetOptions) (*Object, error)
    // 列出对象
    List(ctx context.Context, key string, opts ListOptions) (*List, error)
    // 创建对象
    Create(ctx context.Context, obj Object) (*Object, error)
    // 更新对象
    Update(ctx context.Context, obj Object) (*Object, error)
    // 删除对象
    Delete(ctx context.Context, key string, opts DeleteOptions) error
    // Watch 变化
    Watch(ctx context.Context, key string, opts ListOptions) (watch.Interface, error)
}
```

**存储特点：**
- 乐观并发控制 (ResourceVersion)
- 事务支持
- 分布式锁
- 前置条件检查

---

## API 版本控制

Kubernetes 支持多版本 API：

```
API 版本策略
├── Alpha (v1alpha1)
│   - 实验性
│   - 可能被移除
│   - 不保证向后兼容
│
├── Beta (v1beta1, v2beta1)
│   - 测试中
│   - 功能完整
│   - 可能变化
│
└── Stable (v1, v2)
    - 生产就绪
    - 保证向后兼容
    - 长期支持
```

**版本转换：**
```go
// 转换接口
type Conversion interface {
    Convert(in, out interface{}, scope ConversionScope) error
}

// 版本兼容性矩阵
v1alpha1 ←→ v1beta1 ←→ v1
```

---

## 性能优化

### 1. 缓存

**位置**: `pkg/kubeapiserver/`

```
缓存层次
├── Informer Cache (本地缓存)
│   - 反应式缓存
│   - Watch 驱动
│   - 自动同步
│
└── etcd (真相源)
```

### 2. 长连接

```go
// 长连接优化
- Keep-alive 连接
- HTTP/2 支持
- gRPC 支持
```

### 3. 请求限流

**位置**: `pkg/apiserver/server/`

```go
// 限流器
type FlowControl interface {
    Handle(ctx context.Context, request Request) func()
}

// 限流策略
- API 优先级
- 请求优先级
- 公平调度
```

---

## 审计 (Auditing)

**位置**: `pkg/apiserver/audit/`

记录所有 API 请求：

```go
// 审计事件
type Event struct {
    Level Level
    Timestamp metav1.Time
    AuditID types.UID
    RequestURI string
    Verb string
    User user.Info
    ObjectRef *ObjectReference
    ResponseStatus *metav1.Status
    RequestObject runtime.Object
    ResponseObject runtime.Object
}
```

**审计级别：**
- `None` - 不记录
- `Metadata` - 仅元数据
- `Request` - 记录请求体
- `RequestResponse` - 记录请求和响应

---

## 配置选项

**位置**: `cmd/kube-apiserver/app/options.go`

关键配置：
```go
type ServerRunOptions struct {
    GenericServerRunOptions
    EtcdOptions
    SecureServingOptions
    AuthenticationOptions
    AuthorizationOptions
    AuditOptions
    AdmissionOptions
    APIEnablementOptions
}
```

---

## 总结

**API Server 核心特点：**
1. **统一入口** - 所有操作的唯一入口
2. **声明式 API** - 期望状态 vs 实际状态
3. **可扩展** - CRD、Webhook、聚合 API
4. **安全** - 认证、授权、审计
5. **高性能** - 缓存、长连接、限流
6. **一致性** - etcd 事务、乐观并发控制

**架构优势：**
- 清晰的分层架构
- 插件化设计
- 可扩展性强
- 安全性高

---

## 下一步分析

1. **Controller Manager** - 控制器框架和实现
2. **Scheduler** - 调度算法和策略
3. **Kubelet** - Pod 生命周期管理
4. **etcd 集成** - 状态存储和一致性

---

**分析完成时间**: 2026-02-09
**分析人员**: 小宝
**下一步**: 分析 Controller Manager
