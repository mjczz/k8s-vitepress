# Kubernetes 项目分析 - 05: Kube-proxy

**项目路径**: `~/work/todo/kubernetes`
**分析日期**: 2026-02-09
**组件**: kube-proxy
**位置**: `cmd/kube-proxy/` 和 `pkg/proxy/`

---

## Kube-proxy 概述

Kube-proxy 是 Kubernetes 的网络代理组件，运行在每个节点上，负责实现 Service 的负载均衡和网络代理。

**核心职责：**
1. 监听 Service 和 EndpointSlice 变化
2. 更新节点上的网络规则
3. 实现 Service 负载均衡
4. 处理 NodePort、ClusterIP、LoadBalancer 类型
5. 支持多种代理模式

---

## 目录结构

```
cmd/kube-proxy/
├── app/
│   ├── server.go           # 主入口和服务器逻辑
│   ├── options.go         # 命令行选项
│   ├── server_linux.go    # Linux 特定实现
│   ├── server_windows.go  # Windows 特定实现
│   └── proxy.go          # 代理器创建
└── config/

pkg/proxy/
├── metaproxier/              # 元代理器（双栈支持）
├── iptables/                # iptables 代理模式
├── ipvs/                   # IPVS 代理模式
│   ├── ipset/             # IPSet 集成
│   └── util/              # IPVS 工具
├── nftables/               # nftables 代理模式（最新）
├── winkernel/               # Windows 内核代理
├── conntrack/              # 连接跟踪
├── healthcheck/             # 健康检查
├── config/                 # 配置管理
├── metrics/                # 指标收集
├── util/                   # 工具函数
│   └── nfacct/           # nfacct 计数器
└── apis/
    └── config/            # 配置 API
```

---

## 代理模式

Kube-proxy 支持三种主要的代理模式：

### 1. iptables 模式

**位置**: `pkg/proxy/iptables/proxier.go`

**特点：**
- 基于 iptables 规则
- 使用链式规则处理流量
- 适用于中小规模集群
- 容易调试

**核心链：**
```go
const (
    // KUBE-SERVICES: 服务链
    kubeServicesChain = "KUBE-SERVICES"

    // KUBE-EXTERNAL-SERVICES: 外部服务链
    kubeExternalServicesChain = "KUBE-EXTERNAL-SERVICES"

    // KUBE-NODEPORTS: NodePort 链
    kubeNodePortsChain = "KUBE-NODEPORTS"

    // KUBE-POSTROUTING: POSTROUTING 链
    kubePostroutingChain = "KUBE-POSTROUTING"

    // KUBE-FORWARD: FORWARD 链
    kubeForwardChain = "KUBE-FORWARD"

    // KUBE-PROXY-FIREWALL: 防火墙链
    kubeProxyFirewallChain = "KUBE-PROXY-FIREWALL"
)
```

**工作流程：**
```
1. 监听 Service 和 EndpointSlice 变化
2. 计算期望的 iptables 规则
3. 生成 iptables 规则脚本
4. 使用 iptables-restore 批量加载
5. 定期同步（默认 30 秒）
```

**核心数据结构：**
```go
type Proxier struct {
    ipFamily v1.IPFamily

    // 变化跟踪
    endpointsChanges *proxy.EndpointsChangeTracker
    serviceChanges   *proxy.ServiceChangeTracker

    // 服务和端点映射
    svcPortMap   proxy.ServicePortMap
    endpointsMap proxy.EndpointsMap

    // 同步控制
    mu             sync.Mutex
    syncRunner     *runner.BoundedFrequencyRunner
    syncPeriod     time.Duration
    lastFullSync   time.Time

    // iptables 接口
    iptables utiliptables.Interface

    // 性能优化
    largeClusterMode bool
    precomputedProbabilities []string

    // 连接跟踪
    conntrack conntrack.Interface
}
```

**同步流程：**
```go
func (proxier *Proxier) syncProxyRules() {
    // 1. 计算期望的服务映射
    svcMap := proxier.svcPortMap

    // 2. 生成 iptables 规则
    proxier.iptablesData.Reset()
    proxier.generateFilterRules(svcMap)
    proxier.generateNatRules(svcMap)

    // 3. 执行 iptables-restore
    proxier.iptables.Restore(proxier.iptablesData.Bytes())

    // 4. 清理连接跟踪
    proxier.conntrack.ClearEntriesForIP(svcIPs)
}
```

---

### 2. IPVS 模式

**位置**: `pkg/proxy/ipvs/proxier.go`

**特点：**
- 基于内核级负载均衡
- 高性能
- 支持多种调度算法
- 适用于大规模集群

**核心组件：**
- IPVS（内核模块）
- IPSet（地址集合）
- iptables（过滤规则）

**IPVS 调度算法：**
```go
const (
    // 默认调度算法
    defaultScheduler = "rr"  // 轮询
)

// 支持的调度算法：
// - rr: 轮询
// - lc: 最少连接
// - dh: 目标哈希
// - sh: 源哈希
// - sed: 最短预期延迟
// - nq: 不排队
```

**核心数据结构：**
```go
type Proxier struct {
    ipFamily v1.IPFamily

    // IPVS 接口
    ipvs utilipvs.Interface
    ipset utilipset.Interface
    iptables utiliptables.Interface

    // 服务和端点映射
    serviceMap   proxy.ServiceMap
    endpointsMap proxy.EndpointsMap

    // 同步控制
    syncRunner *runner.BoundedFrequencyRunner
    syncPeriod time.Duration

    // IPSet 管理
    serviceIPSet      utilipset.Set
    endpointIPSet     utilipset.Set
    nodePortIPSet    utilipset.Set
}
```

**同步流程：**
```go
func (proxier *Proxier) syncProxyRules() {
    // 1. 计算期望的 IPVS 服务
    services := proxier.calculateIPVSServices()

    // 2. 创建/更新 IPVS 服务
    for _, svc := range services {
        proxier.ipvs.AddService(svc)
    }

    // 3. 创建/更新 IPSet
    proxier.ipset.AddEntry(serviceIPs, svc.IP)

    // 4. 设置 iptables 规则（仅用于过滤）
    proxier.setupIPTablesRules()

    // 5. 清理过期服务
    proxier.cleanupStaleServices()
}
```

**IPVS 服务定义：**
```go
type Service struct {
    // VIP（虚拟 IP）
    Address  string
    Port     uint16
    Protocol string

    // 调度参数
    Scheduler string  // rr, lc, dh, sh, sed, nq
    Flags     uint16
    Timeout   uint32

    // 真实服务器
    Destinations []Destination
}

type Destination struct {
    Address string
    Port    uint16
    Weight  uint32
}
```

---

### 3. nftables 模式

**位置**: `pkg/proxy/nftables/proxier.go`

**特点：**
- 基于 nftables（iptables 的继任者）
- 更现代化的设计
- 更好的性能
- 支持原子更新

**核心表：**
```go
const (
    kubeProxyTable = "kube-proxy"

    // 过滤器链
    filterPreroutingPreDNATChain = "filter-prerouting-pre-dnat"
    filterOutputPreDNATChain     = "filter-output-pre-dnat"
    filterInputChain             = "filter-input"
    filterForwardChain           = "filter-forward"
    filterOutputChain            = "filter-output"

    // NAT 链
    natPreroutingChain  = "nat-prerouting"
    natOutputChain       = "nat-output"
    natPostroutingChain = "nat-postrouting"

    // 服务链
    servicesChain       = "services"
    serviceIPsMap       = "service-ips"
    serviceNodePortsMap = "service-nodeports"
)
```

**核心数据结构：**
```go
type Proxier struct {
    ipFamily v1.IPFamily

    // nftables 接口
    nft *knfables.Nftables

    // 服务和端点映射
    svcPortMap   proxy.ServicePortMap
    endpointsMap proxy.EndpointsMap

    // 同步控制
    syncRunner *runner.BoundedFrequencyRunner
    syncPeriod time.Duration

    // 连接跟踪
    conntrack conntrack.Interface
}
```

**同步流程：**
```go
func (proxier *Proxier) syncProxyRules() {
    // 1. 创建 nftables 表
    table := proxier.nft.NewTable(kubeProxyTable)

    // 2. 添加链和规则
    proxier.addServiceChains(table)
    proxier.addServiceMaps(table)

    // 3. 原子更新
    proxier.nft.Add(table)

    // 4. 清理连接跟踪
    proxier.conntrack.ClearEntriesForIP(svcIPs)
}
```

---

## 元代理器（Meta Proxier）

**位置**: `pkg/proxy/metaproxier/meta_proxier.go`

Meta Proxier 提供双栈支持，将 IPv4 和 IPv6 请求分别派发：

```go
type metaProxier struct {
    ipv4Proxier proxy.Provider
    ipv6Proxier proxy.Provider
}

func (proxier *metaProxier) OnServiceAdd(service *v1.Service) {
    proxier.ipv4Proxier.OnServiceAdd(service)
    proxier.ipv6Proxier.OnServiceAdd(service)
}

func (proxier *metaProxier) OnEndpointSliceAdd(endpointSlice *discovery.EndpointSlice) {
    switch endpointSlice.AddressType {
    case discovery.AddressTypeIPv4:
        proxier.ipv4Proxier.OnEndpointSliceAdd(endpointSlice)
    case discovery.AddressTypeIPv6:
        proxier.ipv6Proxier.OnEndpointSliceAdd(endpointSlice)
    }
}
```

---

## Service 类型处理

### 1. ClusterIP

默认的 Service 类型，提供集群内部访问：

```
客户端 → Service(ClusterIP) → DNAT → Pod
```

**实现：**
- iptables: NAT 规则将 ClusterIP DNAT 到 Pod IP
- IPVS: 虚拟服务指向真实服务器
- nftables: NAT 映射

---

### 2. NodePort

通过节点的 IP 和端口访问服务：

```
客户端 → NodeIP:NodePort → DNAT → ClusterIP → Pod
```

**实现：**
- iptables: PREROUTING 链规则
- IPVS: 特殊的服务类型
- 本地访问支持（`--iptables-localhost-nodeports`）

---

### 3. LoadBalancer

通过云提供商的负载均衡器访问：

```
客户端 → LB:Port → NodeIP:NodePort → ClusterIP → Pod
```

**实现：**
- NodePort 的扩展
- LoadBalancer IP 的特殊处理
- LoadBalancerSourceRanges 过滤

---

### 4. ExternalName

DNS 别名，无负载均衡功能：

```
客户端 → DNS 查询 ExternalName → 外部域名
```

**实现：**
- 不创建任何网络规则
- 仅 DNS CNAME

---

## 端点切片（EndpointSlices）

EndpointSlices 是 Endpoints 的优化版本：

```go
type EndpointSlice struct {
    AddressType AddressType  // IPv4, IPv6, FQDN
    Endpoints   []Endpoint
    Ports       []Port
}

type Endpoint struct {
    Addresses []string
    Conditions EndpointConditions
    TargetRef *ObjectReference
}
```

**优点：**
- 按 IP 族分片（IPv4/IPv6 分离）
- 减少 etcd 压力
- 更好的扩展性
- 自动缩放

**大集群模式优化：**
```go
const largeClusterEndpointsThreshold = 1000

// 当端点数超过 1000 时启用大集群模式
// 优化性能，牺牲可调试性
proxier.largeClusterMode = len(endpoints) > largeClusterEndpointsThreshold
```

---

## 健康检查

**位置**: `pkg/proxy/healthcheck/`

HealthChecker 定期检查端点健康：

```go
type HealthChecker interface {
    // 开始检查
    Start()

    // 停止检查
    Stop()

    // 更新服务
    Sync(services []string, endpoints []Endpoint)
}
```

**检查方法：**
- HTTP/HTTPS 检查
- TCP 检查
- gRPC 检查

**配置：**
```yaml
apiVersion: v1
kind: Service
spec:
  healthCheckNodePort: 30080
  healthCheckProtocol: HTTP
  healthCheckPath: /healthz
```

---

## 连接跟踪（Conntrack）

**位置**: `pkg/proxy/conntrack/`

管理内核连接跟踪表：

```go
type Interface interface {
    // 清理指定 IP 的条目
    ClearEntriesForIP(ip string) error

    // 清理所有条目
    ClearAll() error

    // 删除过期的连接
    DeleteConn(conn Connection) error
}
```

**场景：**
1. 服务 IP 变化
2. 端点变化
3. Service 删除
4. 节点关闭

**优化：**
```go
// TCP liberal 模式
// "Be conservative in what you do, be liberal in what you accept from others"
sysctl nf_conntrack_tcp_be_liberal=1
```

---

## 性能优化

### 1. 批量更新

```go
// 使用 iptables-restore 批量加载
iptables.Restore(rules)

// 使用 nftables 原子更新
nftables.Add(table)
```

### 2. 增量同步

```go
// 仅同步变化的规则
if proxier.serviceChanges.IsEmpty() {
    return
}

proxier.updateServices(proxier.serviceChanges.Updates)
```

### 3. 限频同步

```go
// 限制同步频率，避免频繁更新
syncRunner := runner.NewBoundedFrequencyRunner(
    "sync-runner",
    syncPeriod,      // 最小间隔
    minSyncPeriod,  // 限频间隔
)
```

### 4. 内存重用

```go
// 重用缓冲区，减少内存分配
type Proxier struct {
    iptablesData             *bytes.Buffer
    existingFilterChainsData *bytes.Buffer
    filterChains             proxyutil.LineBuffer
    filterRules              proxyutil.LineBuffer
}
```

---

## IPSet

IPSet 是 iptables/IPVS 的扩展，用于高效管理 IP 地址集合：

```go
type Set struct {
    Name    string
    Type    Type    // hash:ip, hash:net, etc.
    Options []Option
}

type Type string

const (
    TypeHashIP       Type = "hash:ip"
    TypeHashIPPort   Type = "hash:ip,port"
    TypeHashNet      Type = "hash:net"
)
```

**用途：**
1. 存储服务 IP 集合
2. 存储端点 IP 集合
3. 存储节点 IP 集合
4. 过滤规则优化

**示例：**
```bash
# 创建 IPSet
ipset create kube-cluster-ips hash:ip

# 添加 IP
ipset add kube-cluster-ips 10.96.0.1
ipset add kube-cluster-ips 10.96.0.2

# 在 iptables 中使用
iptables -A KUBE-SERVICES -m set --match-set kube-cluster-ips src -j ACCEPT
```

---

## 指标和监控

**位置**: `pkg/proxy/metrics/`

Kube-proxy 提供丰富的指标：

```
# 同步延迟
kubeproxy_sync_latency_seconds{quantile="0.5|0.9|0.99"}

# 同步次数
kubeproxy_sync_total{result="success|error"}

# 端点数量
kubeproxy_sync_endpoints_total

# 服务数量
kubeproxy_sync_services_total

# 编程时间
kubeproxy_programming_duration_seconds
```

---

## 配置选项

**命令行选项：**
```bash
--proxy-mode              # 代理模式：iptables, ipvs, nftables
--iptables-sync-period    # iptables 同步周期（默认 30s）
--ipvs-sync-period        # IPVS 同步周期（默认 30s）
--masquerade-all         # 是否对所有流量进行伪装
--cluster-cidr           # 集群 CIDR
--hostname-override       # 覆盖节点主机名
--nodeport-addresses     # NodePort 监听地址
```

**配置文件：**
```yaml
apiVersion: kubeproxy.config.k8s.io/v1alpha1
kind: KubeProxyConfiguration
bindAddress: 0.0.0.0
clusterCIDR: "10.244.0.0/16"
healthzBindAddress: 0.0.0.0:10256
metricsBindAddress: 127.0.0.1:10249
mode: "iptables"
nodePortAddresses: []
oomScoreAdj: -999
syncPeriod: 30s
```

---

## Session Affinity（会话亲和）

支持基于客户端 IP 的会话保持：

```yaml
apiVersion: v1
kind: Service
spec:
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10800
```

**实现：**
- iptables: 使用 MARK 和 CONNMARK
- IPVS: 使用持久的连接跟踪

---

## Windows 支持

**位置**: `pkg/proxy/winkernel/`

Windows 特定实现：
- HNS（Host Network Service）
- VFP（Virtual Filtering Platform）
- 原生 Windows 网络栈

---

## 总结

**Kube-proxy 核心特点：**
1. **多模式支持** - iptables、IPVS、nftables
2. **双栈支持** - IPv4 和 IPv6 同时工作
3. **高性能** - 内核级负载均衡（IPVS）
4. **自动发现** - 监听 Service 和 EndpointSlice
5. **健康检查** - 主动检测端点健康
6. **会话保持** - 支持客户端 IP 亲和性

**设计优势：**
- 模块化设计，易于扩展
- 多种代理模式适应不同场景
- 完整的监控和指标
- 良好的性能优化

---

## 下一步分析

1. **etcd 集成** - 状态存储和一致性
2. **网络模型** - Service、Ingress、CNI
3. **存储机制** - PV/PVC、StorageClass、CSI
4. **CNI 插件** - 容器网络接口

---

**分析完成时间**: 2026-02-09
**分析人员**: 小宝
**下一步**: 分析 etcd 集成
