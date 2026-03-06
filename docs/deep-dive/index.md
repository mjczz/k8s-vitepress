# Kubernetes 深度分析文档

本站收录了 Kubernetes 核心机制的深度分析文档，涵盖源码解析、架构设计、最佳实践等内容。

## 📚 文档分类

### 核心控制平面

- [API Server 深度分析](api-server-deep-dive.md) - API 服务器的架构和实现
- [Controller Manager 深度分析](controller-manager-deep-dive.md) - 控制器管理器的核心机制
- [Scheduler 深度分析](scheduler-deep-dive.md) - 调度器的工作原理
- [调度算法深度分析](scheduling-algorithm-deep-dive.md) - 调度算法详解

### 资源管理

- [生命周期管理深度分析](lifecycle-management-deep-dive.md) - Pod 和容器的生命周期
- [资源管理器深度分析](resource-manager-deep-dive.md) - CPU、内存、拓扑管理
- [Pod Worker 深度分析](pod-worker-deep-dive.md) - Pod 调度和同步机制
- [PLEG 深度分析](pleg-deep-dive.md) - Pod 生命周期事件生成器

### 容器运行时

- [CRI 运行时深度分析](cri-runtime-deep-dive.md) - 容器运行时接口详解
- [HPA 扩缩容机制](hpa-scaling-mechanism-deep-dive.md) - 水平 Pod 自动伸缩
- [CRD Operator 深度分析](crd-operator-deep-dive.md) - 自定义资源和 Operator 模式

### 存储与卷

- [存储机制深度分析](storage-mechanism-deep-dive.md) - 存储系统架构
- [PV/PVC 绑定机制](k8s-pv-pvc-binding-mechanism-deep-dive.md) - 持久化卷绑定流程
- [CSI Volume Manager](csi-volume-manager-deep-dive.md) - 容器存储接口实现

### 网络

- [CNI 插件机制](k8s-cni-plugin-mechanism-deep-dive.md) - 容器网络接口
- [服务网络深度分析](k8s-service-network-deep-dive.md) - Service 网络实现
- [Kube Proxy 源码分析](kube-proxy-source-code-deep-dive.md) - 网络代理实现
- [网络策略实现](network-policy-implementation-deep-dive.md) - Network Policy 机制
- [网络策略深度分析](k8s-network-policy-deep-dive.md) - 网络策略详解
- [Ingress Controller](k8s-ingress-controller-deep-dive.md) - 入口控制器

### 安全

- [安全机制深度分析](security-deep-dive.md) - Kubernetes 安全体系
- [准入控制深度分析](admission-control-deep-dive.md) - Admission Controller 机制
- [Pod Security Admission](pod-security-admission-deep-dive.md) - Pod 安全准入

### 监控与扩展

- [监控指标深度分析](monitoring-metrics-deep-dive.md) - Metrics API 和监控体系
- [集群自动伸缩](cluster-autoscaler-deep-dive.md) - 集群级别的自动伸缩
- [领导选举机制](leader-election-deep-dive.md) - Leader Election 实现
- [资源配额限制](resource-quota-limits-deep-dive.md) - ResourceQuota 和 LimitRange

## 📊 统计信息

- **文档总数**: 28 篇
- **总字数**: 约 60 万字
- **涵盖组件**: 30+ 核心组件和机制
- **分析深度**: 源码级 + 架构级 + 实践级

## 🎯 阅读建议

### 入门路径

如果你刚开始学习 Kubernetes，建议按以下顺序阅读：

1. **基础概念**: API Server → Controller Manager → Scheduler
2. **核心机制**: 生命周期管理 → 资源管理 → 调度算法
3. **高级主题**: 存储、网络、安全、监控

### 进阶路径

如果你已经熟悉 Kubernetes 基础，可以直接跳转到感兴趣的章节：

- **深度调试**: 监控指标 → 生命周期管理 → PLEG
- **性能优化**: 调度算法 → 资源管理器 → 网络策略
- **安全加固**: 安全机制 → 准入控制 → Pod Security Admission

### 源码研究者

如果你要深入研究源码：

1. 先读架构分析文档（如 API Server 深度分析）
2. 结合 K8s 官方文档理解设计意图
3. 阅读对应源码文件（文档中已标注关键代码位置）
4. 实践：搭建本地环境、添加日志、调试运行

## 📝 文档特点

- **源码级分析**: 基于官方源码，深入关键实现
- **架构视角**: 从整体架构到具体组件的层次分析
- **流程图解**: 使用 Mermaid 绘制核心流程图
- **最佳实践**: 生产环境的经验和建议
- **故障排查**: 常见问题和排查思路

## 🔧 工具链

- **文档生成**: 基于 AI 辅助分析
- **流程图**: Mermaid
- **文档站点**: VitePress
- **代码示例**: Go 1.25.0

## 📄 许可

本文档基于 CC BY-NC-SA 4.0 许可协议，你可以自由地：
- 分享 - 在任何媒介以任何形式复制、发行本作品
- 演绎 - 修改、转换或以本作品为基础进行创作

## 🙏 致谢

感谢 Kubernetes 社区的贡献，以及所有为云原生技术做出贡献的开发者。
