# Kubernetes 项目分析 - 08: 网络模型

**项目路径**: `~/work/todo/kubernetes`
**分析日期**: 2026-02-10
**主题**: Service、Ingress、CNI、Network Policy

---

## 网络模型概述

Kubernetes 网络模型是声明式的，通过资源定义网络行为：

**核心资源：**
1. **Service** - 服务发现和负载均衡
2. **Ingress** - HTTP(S) 路由规则
3. **NetworkPolicy** - 网络隔离策略
4. **EndpointSlice** - 服务端点管理

---

## Service 模型

### Service 类型

#### 1. ClusterIP

默认的 Service 类型，提供集群内部访问：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  selector:
    app: my-app
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP
```

**访问方式：**
```
Pod → Service(ClusterIP) → Pod
```

**特点：**
- 仅集群内部可访问
- 自动分配 ClusterIP
- 支持负载均衡

---

#### 2. NodePort

通过节点的 IP 和端口访问服务：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  selector:
    app: my-app
  ports:
  - port: 80
    nodePort: 30080
    targetPort: 8080
  type: NodePort
```

**访问方式：**
```
外部 → NodeIP:NodePort → ClusterIP → Pod
```

**特点：**
- 节点级别暴露
- 自动分配 NodePort（30000-32767）
- 支持 `--nodeport-addresses` 配置

---

#### 3. LoadBalancer

通过云提供商的负载均衡器访问：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  selector:
    app: my-app
  ports:
  - port: 80
    targetPort: 8080
  type: LoadBalancer
```

**访问方式：**
```
外部 → LB:Port → NodeIP:NodePort → ClusterIP → Pod
```

**特点：**
- 云提供商自动分配外部 IP
- 健康检查集成
- 支持 LoadBalancerSourceRanges

---

#### 4. ExternalName

DNS 别名，无负载均衡功能：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  type: ExternalName
  externalName: example.com
```

**特点：**
- 仅 DNS CNAME
- 不创建任何网络规则
- 用于引用外部服务

---

## Service 会话保持

### ClientIP Affinity

基于客户端 IP 的会话保持：

```yaml
apiVersion: v1
kind: Service
spec:
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10800
```

**实现机制：**
- iptables: 使用 MARK 和 CONNMARK
- IPVS: 使用持久的连接跟踪
- 保存客户端 → 服务器的映射关系

---

## EndpointSlice

### 为什么需要 EndpointSlice？

传统的 Endpoints 资源有扩展性问题：

```
问题：
- 单个对象，所有端点都在一个资源中
- 大集群时对象巨大（> 1MB）
- 频繁更新，etcd 压力大
- 跨 API 服务器复制困难

解决方案：
- 按 IP 族分片（IPv4/IPv6 分离）
- 每个片独立更新
- 自动缩放，减少 etcd 压力
```

### EndpointSlice 结构

```go
type EndpointSlice struct {
    AddressType AddressType  // IPv4, IPv6, FQDN
    Endpoints   []Endpoint
    Ports       []Port
    EndpointsMap map[string]Endpoint
}

type Endpoint struct {
    Addresses []string
    Conditions EndpointConditions
    TargetRef *ObjectReference
    Hostname *string
    Zone *string
}

type EndpointConditions struct {
    Ready      *ConditionStatus
    Serving    *ConditionStatus
    Terminating *ConditionStatus
}
```

### EndpointSlice Controller

**位置**: `pkg/controller/endpointslice/`

**职责：**
- 监听 Service 变化
- 监听 Pod 变化
- 管理 EndpointSlice 创建/更新/删除
- 按 Topology Zones 组织

**工作流程：**
```
1. Service 创建/更新
    ↓
2. 查找匹配的 Pod
    ↓
3. 创建/更新 EndpointSlice
    ↓
4. 按 Zone 分片（如果启用）
    ↓
5. 设置 Service 的 EndpointSlice 列表
```

### 端点发现

```go
// 获取服务的所有端点
func (e *EndpointSliceController) getPodsForService(svc *v1.Service) ([]*v1.Pod, error) {
    selector := labels.Set(svc.Spec.Selector)
    pods, err := e.podLister.Pods(namespace).List(selector)
    return pods, err
}

// 创建 EndpointSlice
func (e *EndpointSliceController) createEndpointSlice(svc *v1.Pod) *discovery.EndpointSlice {
    return &discovery.EndpointSlice{
        ObjectMeta: metav1.ObjectMeta{
            Name:      svc.Name,
            Namespace: svc.Namespace,
            Labels:    svc.Labels,
        },
        AddressType: e.getAddressType(pods),
        Endpoints: e.buildEndpoints(pods),
        Ports:      e.buildPorts(svc),
    }
}
```

---

## Ingress 模型

### Ingress 资源

Ingress 提供 HTTP(S) 路由规则：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  rules:
  - host: example.com
    http:
      paths:
      - path: /app
        pathType: Prefix
        backend:
          service:
            name: my-service
            port:
              number: 80
  ingressClassName: nginx
```

### Ingress Controller

Ingress Controller 监听 Ingress 资源并配置负载均衡器：

**流行控制器：**
1. **NGINX Ingress Controller** - 最流行
2. **Traefik** - 现代化路由
3. **HAProxy** - 传统方案
4. **Envoy** - 高性能

**工作流程：**
```
1. 监听 Ingress 资源
    ↓
2. 解析路由规则
    ↓
3. 生成负载均衡器配置
    ↓
4. 应用配置
    ↓
5. 重新加载（热更新）
```

**NGINX Controller 示例：**
```go
// 监听 Ingress
ingressLister := informers.Networking().V1().Ingresses().Informer()
ingressLister.AddEventHandler(cache.ResourceEventHandlerFuncs{
    AddFunc: func(obj interface{}) {
        ingress := obj.(*networking.Ingress)
        c.updateIngress(ingress)
    },
    UpdateFunc: func(old, new interface{}) {
        ingress := new.(*networking.Ingress)
        c.updateIngress(ingress)
    },
})

// 更新 NGINX 配置
func (c *Controller) updateIngress(ingress *networking.Ingress) {
    // 1. 解析 Ingress 规则
    servers := c.parseIngress(ingress)

    // 2. 生成 NGINX 配置
    config := c.generateNginxConfig(servers)

    // 3. 写入配置文件
    ioutil.WriteFile("/etc/nginx/nginx.conf", config)

    // 4. 重新加载 NGINX
    exec.Command("nginx", "-s", "reload").Run()
}
```

---

## CNI（容器网络接口）

### CNI 概述

CNI (Container Network Interface) 是 Kubernetes 的网络插件标准：

```
Kubelet
    ↓
调用 CNI 插件
    ↓
CNI 插件
    ↓
配置容器网络
    ↓
返回网络配置
```

### CNI 接口

**位置**: `pkg/kubelet/network/`

```go
type CNI interface {
    // 添加网络到容器
    AddNetwork(netconf []byte, ifName string, nsPath string) (types.Result, error)

    // 删除容器的网络
    DelNetwork(netconf []byte, ifName string, nsPath string) error

    // 检查网络状态
    CheckNetwork(netconf []byte, ifName string) error

    // 获取网络状态
    Status() (types.Result, error)
}
```

### Kubelet CNI 集成

```go
// Kubelet 网络插件管理器
type NetworkPluginManager struct {
    cniPlugins []CNIPlugin
    sync.Mutex  sync.Mutex
}

// 同步 Pod 网络
func (m *NetworkPluginManager) SetUpPod(pod *v1.Pod) error {
    // 1. 准备网络配置
    netconf := m.generateNetworkConfig(pod)

    // 2. 调用 CNI 插件
    result, err := m.cniPlugin.AddNetwork(netconf, ifName, nsPath)
    if err != nil {
        return err
    }

    // 3. 应用网络配置
    err = m.applyNetworkConfig(result, pod)
    return err
}

// 清理 Pod 网络
func (m *NetworkPluginManager) TearDownPod(pod *v1.Pod) error {
    netconf := m.generateNetworkConfig(pod)
    return m.cniPlugin.DelNetwork(netconf, ifName, nsPath)
}
```

### 流行 CNI 插件

1. **Flannel** - Overlay 网络（VXLAN）
2. **Calico** - BGP + Network Policy
3. **Cilium** - eBPF + Service Mesh
4. **Weave Net** - Overlay（TCP）
5. **Canal** - Flannel + Calico 组合

---

## Network Policy

### NetworkPolicy 资源

Network Policy 实现网络隔离：

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: database
    ports:
    - protocol: TCP
      port: 3306
```

### NetworkPolicy Controller

**位置**: `pkg/controller/network/`

**职责：**
- 监听 NetworkPolicy 变化
- 配置网络隔离规则
- 支持复杂的选择器

**工作流程：**
```
1. 监听 NetworkPolicy
    ↓
2. 解析策略规则
    ↓
3. 配置 iptables/IPVS 规则
    ↓
4. 应用隔离策略
```

---

## DNS 服务

### CoreDNS

Kubernetes 使用 CoreDNS 作为集群 DNS 服务：

```
服务发现流程：
Pod → my-service → DNS 查询 → Service ClusterIP → Pod
```

### DNS 记录类型

```yaml
# Service DNS 记录
my-service.default.svc.cluster.local.    A 记录 → ClusterIP

# Headless Service DNS 记录
my-service.default.svc.cluster.local.    A 记录 → 每个 Pod 的 IP

# ExternalName Service DNS 记录
my-service.default.svc.cluster.local.    CNAME 记录 → 外部域名

# Pod DNS 记录
10-244-1-5.default.pod.cluster.local.  A 记录 → Pod IP
```

---

## Service Mesh

### 概述

Service Mesh 提供更高级的网络功能：

**特性：**
1. 流量管理
2. 可观测性
3. 安全（mTLS）
4. 故障注入
5. 流量镜像

**流行方案：**
1. **Istio** - 最流行
2. **Linkerd** - 轻量级
3. **Consul Connect** - 服务网格
4. **Cilium** - eBPF + Service Mesh

---

## 网络模式总结

| 组件 | 职责 | 实现位置 |
|--------|--------|-----------|
| **Service** | 服务发现和负载均衡 | API Server + Kube-proxy |
| **EndpointSlice** | 端点管理 | Controller Manager |
| **Ingress** | HTTP(S) 路由 | Ingress Controller |
| **NetworkPolicy** | 网络隔离 | NetworkPolicy Controller |
| **CNI** | 容器网络接口 | CNI 插件 |
| **DNS** | 名称解析 | CoreDNS |
| **Service Mesh** | 流量管理 | 外部方案 |

---

## 核心网络概念

### 1. Pod 网络

```
每个 Pod 有独立的 IP 地址
Pod 内容器共享网络命名空间
Pod 间通信通过 Overlay 或直接路由
```

### 2. Service 网络

```
Service 提供稳定的虚拟 IP
ClusterIP 在集群内部可路由
NodePort 暴露到外部
LoadBalancer 通过云 LB 暴露
```

### 3. 网络策略

```
NetworkPolicy 控制 Pod 间流量
基于 Label 选择器
支持 Ingress 和 Egress 规则
```

---

## 性能优化

### 1. EndpointSlice 分片

```go
// 按 IP 族分片，减少 etcd 压力
for _, pod := range pods {
    if isIPv4(pod.IP) {
        ipv4Slices = append(ipv4Slices, pod)
    } else {
        ipv6Slices = append(ipv6Slices, pod)
    }
}
```

### 2. IPTables vs IPVS

- **IPTables**: 中小集群，易调试
- **IPVS**: 大集群，高性能
- **nftables**: 现代化，原子更新

### 3. 连接复用

```go
// HTTP/1.1 连接复用
Connection: keep-alive
// 减少连接建立开销
```

---

## 总结

**Kubernetes 网络核心特点：**
1. **声明式网络** - 通过资源定义网络行为
2. **服务发现** - Service + DNS
3. **负载均衡** - Service 自动负载均衡
4. **网络隔离** - Network Policy 控制流量
5. **插件化** - CNI 标准化网络配置
6. **可扩展** - Ingress Controller、Service Mesh

**设计优势：**
- 解耦网络配置和应用
- 标准化接口（CNI）
- 灵活的路由规则
- 良好的可观测性

---

## 下一步分析

1. **存储机制** - PV/PVC、StorageClass、CSI
2. **API 设计** - CRD、Conversion Webhook
3. **安全机制** - RBAC、Secret、ServiceAccount
4. **测试策略** - 单元测试、集成测试、E2E

---

**分析完成时间**: 2026-02-10
**分析人员**: 小宝
**下一步**: 分析存储机制
