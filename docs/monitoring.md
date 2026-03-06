# Kubernetes 监控深度分析

## 概述

Kubernetes 提供了完整的监控生态体系，从基础指标到自定义监控，从内置工具到第三方集成。本文档全面梳理 K8s 监控的各个层面。

## 监控架构

```
┌─────────────────────────────────────────────────────────┐
│                    监控数据采集层                         │
├─────────────────────────────────────────────────────────┤
│  kubelet (cAdvisor) → kube-state-metrics → node-exporter│
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                    时序数据库层                           │
├─────────────────────────────────────────────────────────┤
│                      Prometheus                         │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                    可视化与告警层                         │
├─────────────────────────────────────────────────────────┤
│  Grafana | AlertManager | 自定义 Dashboard              │
└─────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. Metrics Server

**作用**: 提供基础的资源使用指标（CPU、内存）

**采集流程**:
```
kubelet (Summary API)
    ↓
Metrics Server (聚合)
    ↓
API Server (metrics.k8s.io)
    ↓
kubectl top / HPA / VPA
```

**关键配置**:
```yaml
# metrics-server deployment
containers:
  - name: metrics-server
    args:
      - --kubelet-insecure-tls
      - --kubelet-preferred-address-types=InternalIP
```

### 2. Prometheus Operator

**优势**:
- 声明式配置管理
- 自动监控目标发现
- 内置告警规则管理

**核心 CRDs**:
- `Prometheus` - Prometheus 实例
- `ServiceMonitor` - 监控目标配置
- `PodMonitor` - Pod 级别监控
- `AlertmanagerConfig` - 告警路由

### 3. kube-state-metrics

**作用**: 监控 K8s 对象状态

**采集指标**:
- Pod 状态: `kube_pod_status_phase`
- Deployment 状态: `kube_deployment_status_replicas`
- PVC 状态: `kube_persistentvolumeclaim_status_phase`

## 监控指标分类

### 基础指标

| 指标类型 | 说明 | 示例 |
|---------|------|------|
| CPU | 容器 CPU 使用率 | `container_cpu_usage_seconds_total` |
| Memory | 容器内存使用量 | `container_memory_working_set_bytes` |
| Network | 网络流量 | `container_network_receive_bytes_total` |
| Disk | 磁盘 I/O | `container_fs_reads_bytes_total` |

### 业务指标

通过自定义采集和 Exporter 获取：

```yaml
# 自定义指标示例
apiVersion: v1
kind: Service
metadata:
  name: my-app-metrics
spec:
  selector:
    app: my-app
  ports:
  - name: metrics
    port: 9090
    targetPort: 9090
```

## 告警最佳实践

### 告警分级

```yaml
groups:
- name: critical
  rules:
  # P0 - 严重告警
  - alert: PodCrashLooping
    expr: rate(kube_pod_container_status_restarts_total[15m]) > 0
    labels:
      severity: critical
  
  # P1 - 重要告警
  - alert: HighMemoryUsage
    expr: container_memory_usage_bytes / container_spec_memory_limit_bytes > 0.9
    labels:
      severity: warning
  
  # P2 - 一般告警
  - alert: DiskSpaceLow
    expr: node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.1
    labels:
      severity: info
```

### 告警抑制

避免告警风暴的关键：

```yaml
inhibit_rules:
  - source_match:
      alertname: 'PodCrashLooping'
    target_match_re:
      alertname: '.*Down.*'
    equal: ['namespace', 'pod']
```

## 监控数据可视化

### Grafana Dashboard 推荐模板

- **Kubernetes Cluster Overview** - 集群整体状态
- **Kubernetes Pod Monitoring** - Pod 级别监控
- **Kubernetes Node Exporter** - 节点资源监控

### 自定义 Panel 配置

```json
{
  "targets": [{
    "expr": "sum(container_memory_working_set_bytes{container!=\"\"}) by (pod)",
    "legendFormat": "{{pod}}"
  }],
  "fieldConfig": {
    "defaults": {
      "unit": "bytes",
      "color": {"mode": "thresholds"}
    }
  }
}
```

## 性能优化

### Prometheus 性能调优

```yaml
global:
  scrape_interval: 30s  # 生产环境建议 30-60s
  evaluation_interval: 30s

storage:
  tsdb:
    retention.time: 30d  # 数据保留时间
    
# 限制采样数量
limits:
  - match_all: true
    series_limit: 1000000
```

### 高可用部署

```yaml
# Prometheus HA + Thanos 方案
- Prometheus 集群采集
- Thanos Sidecar 上传到对象存储
- Thanos Querier 统一查询
```

## 故障排查

### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| Metrics Server 数据不准 | cAdvisor 未启用 | 确保 kubelet 启用 `--enable-controller-attach-detach` |
| Prometheus 采集延迟 | 目标过多 | 调整 scrape_interval，使用 relabel 过滤 |
| 告警重复 | 没有配置抑制规则 | 添加 inhibit_rules |

## 总结

K8s 监控体系的成功关键：

1. **分层次监控** - 从基础设施到应用层的全方位覆盖
2. **合理设置告警** - 避免告警疲劳，确保关键问题及时响应
3. **数据可视化** - 通过 Dashboard 直观展示系统状态
4. **持续优化** - 根据实际使用情况不断调整采集策略

---

::: tip 相关资源
- [Prometheus 官方文档](https://prometheus.io/docs/)
- [Grafana 官方站点](https://grafana.com/)
- [Kubernetes 监控最佳实践](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-usage-monitoring/)
:::
