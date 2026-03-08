import { defineConfig } from 'vitepress'
import { createMarkdownRenderer } from 'vitepress'
import { withMermaid } from "vitepress-plugin-mermaid";



// https://vitepress.vuejs.org/config/app-configs
const a =  defineConfig({
  title: 'Kubernetes 深度分析',
  description: '深入理解 Kubernetes 核心机制与源码实现',
  base: '/',

  // Markdown 配置
  markdown: {
    // 配置代码块行号
    lineNumbers: true,
    // 配置代码块主题
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    }
  },

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '深度分析', link: '/deep-dive/' },
      { text: '项目源码分析', link: '/deep-dive/kubernetes-analysis-01-overview' },
      { text: '学习路径', link: '/deep-dive/kubernetes-study-tasks' },
      { text: 'GitHub', link: 'https://github.com/kubernetes/kubernetes' }
    ],

    sidebar: [
      {
        text: '开始',
        items: [
          { text: '首页', link: '/' },
          { text: '文档索引', link: '/deep-dive/' },
          { text: '更新日志', link: '/deep-dive/changelog' },
          { text: '学习路径', link: '/deep-dive/kubernetes-study-tasks' }
        ]
      },
      {
        text: '核心控制平面',
        items: [
          { text: 'API Server 深度分析', link: '/deep-dive/api-server-deep-dive' },
          { text: 'Controller Manager 深度分析', link: '/deep-dive/controller-manager-deep-dive' },
          { text: 'Scheduler 深度分析', link: '/deep-dive/scheduler-deep-dive' },
          { text: '调度算法深度分析', link: '/deep-dive/scheduling-algorithm-deep-dive' }
        ]
      },
      {
        text: '资源管理',
        items: [
          { text: '生命周期管理深度分析', link: '/deep-dive/lifecycle-management-deep-dive' },
          { text: '资源管理器深度分析', link: '/deep-dive/resource-manager-deep-dive' },
          { text: 'Pod Worker 深度分析', link: '/deep-dive/pod-worker-deep-dive' },
          { text: 'PLEG 深度分析', link: '/deep-dive/pleg-deep-dive' }
        ]
      },
      {
        text: '容器运行时',
        items: [
          { text: 'CRI 运行时深度分析', link: '/deep-dive/cri-runtime-deep-dive' },
          { text: 'HPA 扩缩容机制', link: '/deep-dive/hpa-scaling-mechanism-deep-dive' },
          { text: 'CRD Operator 深度分析', link: '/deep-dive/crd-operator-deep-dive' }
        ]
      },
      {
        text: '存储与卷',
        items: [
          { text: '存储机制深度分析', link: '/deep-dive/storage-mechanism-deep-dive' },
          { text: 'PV/PVC 绑定机制', link: '/deep-dive/k8s-pv-pvc-binding-mechanism-deep-dive' },
          { text: 'CSI Volume Manager', link: '/deep-dive/csi-volume-manager-deep-dive' },
          { text: 'Volume Manager 深度分析', link: '/deep-dive/volume-manager-deep-dive' }
        ]
      },
      {
        text: '网络',
        items: [
          { text: 'CNI 插件机制', link: '/deep-dive/k8s-cni-plugin-mechanism-deep-dive' },
          { text: '服务网络深度分析', link: '/deep-dive/k8s-service-network-deep-dive' },
          { text: 'Kube Proxy 源码分析', link: '/deep-dive/kube-proxy-source-code-deep-dive' },
          { text: '网络策略实现', link: '/deep-dive/network-policy-implementation-deep-dive' },
          { text: '网络策略深度分析', link: '/deep-dive/k8s-network-policy-deep-dive' },
          { text: 'Ingress Controller', link: '/deep-dive/k8s-ingress-controller-deep-dive' }
        ]
      },
      {
        text: '安全',
        items: [
          { text: '安全机制深度分析', link: '/deep-dive/security-deep-dive' },
          { text: '准入控制深度分析', link: '/deep-dive/admission-control-deep-dive' },
          { text: 'Pod Security Admission', link: '/deep-dive/pod-security-admission-deep-dive' }
        ]
      },
      {
        text: '监控与扩展',
        items: [
          { text: '监控指标深度分析', link: '/deep-dive/monitoring-metrics-deep-dive' },
          { text: '集群自动伸缩', link: '/deep-dive/cluster-autoscaler-deep-dive' },
          { text: '领导选举机制', link: '/deep-dive/leader-election-deep-dive' },
          { text: '资源配额限制', link: '/deep-dive/resource-quota-limits-deep-dive' }
        ]
      },
      {
        text: '高级特性',
        items: [
          { text: 'Device Manager 深度分析', link: '/deep-dive/device-manager-deep-dive' }
        ]
      },
      {
        text: '扩展主题',
        items: [
          { text: 'Service Account 和 Token 管理', link: '/deep-dive/serviceaccount-token-deep-dive' },
          { text: 'Operator Framework', link: '/deep-dive/operator-framework-deep-dive' },
          { text: 'Prometheus Adapter', link: '/deep-dive/prometheus-adapter-deep-dive' },
          { text: 'Metrics Server', link: '/deep-dive/metrics-server-deep-dive' },
          { text: 'Kubernetes Dashboard', link: '/deep-dive/kubernetes-dashboard-deep-dive' }
        ]
      },
      {
        text: 'Kubernetes 项目源码分析',
        items: [
          { text: '项目概览', link: '/deep-dive/kubernetes-analysis-01-overview' },
          { text: '学习任务列表', link: '/deep-dive/kubernetes-study-tasks' },
          { text: 'API Server 架构', link: '/deep-dive/kubernetes-analysis-02-apiserver' },
          { text: 'Controller Manager', link: '/deep-dive/kubernetes-analysis-03-controller-manager' },
          { text: 'Scheduler', link: '/deep-dive/kubernetes-analysis-04-scheduler' },
          { text: 'Kubelet', link: '/deep-dive/kubernetes-analysis-05-kubelet' },
          { text: 'Kube-proxy', link: '/deep-dive/kubernetes-analysis-05-kube-proxy' },
          { text: 'etcd 集成', link: '/deep-dive/kubernetes-analysis-07-etcd-integration' },
          { text: '网络模型', link: '/deep-dive/kubernetes-analysis-08-network' },
          { text: '存储系统', link: '/deep-dive/kubernetes-analysis-09-storage' },
          { text: 'API 设计', link: '/deep-dive/kubernetes-analysis-10-api-design' },
          { text: '安全机制', link: '/deep-dive/kubernetes-analysis-11-security' },
          { text: '测试策略', link: '/deep-dive/kubernetes-analysis-12-testing-strategy' },
          { text: '构建和发布', link: '/deep-dive/kubernetes-analysis-13-build-and-release' },
          { text: '分析进度', link: '/deep-dive/kubernetes-analysis-progress-final' }
        ]
      },
      {
        text: 'Kubernetes 高级分析',
        items: [
          { text: 'kubeadm 集群引导工具', link: '/deep-dive/kubernetes-advanced-analysis-01-kubeadm' },
          { text: 'Garbage Collector', link: '/deep-dive/kubernetes-advanced-analysis-02-garbage-collector' },
          { text: 'Kube-Aggregator', link: '/deep-dive/kubernetes-advanced-analysis-03-kube-aggregator' },
          { text: 'Cloud Controller Manager', link: '/deep-dive/kubernetes-advanced-analysis-04-cloud-controller-manager' },
          { text: 'Pod Autoscaler', link: '/deep-dive/kubernetes-advanced-analysis-10-pod-autoscaler' },
          { text: '项目总结', link: '/deep-dive/kubernetes-advanced-project-summary' }
        ]
      },
      {
        text: '工作负载控制器',
        items: [
          { text: 'Deployment Controller', link: '/deep-dive/deployment-controller-deep-dive' },
          { text: 'StatefulSet Controller', link: '/deep-dive/statefulset-controller-deep-dive' },
          { text: 'ReplicaSet Controller', link: '/deep-dive/replicaset-controller-deep-dive' },
          { text: 'DaemonSet Controller', link: '/deep-dive/daemonset-controller-deep-dive' },
          { text: 'Job Controller', link: '/deep-dive/job-controller-deep-dive' }
        ]
      },
      {
        text: '节点与设备管理',
        items: [
          { text: 'Node Lifecycle Controller', link: '/deep-dive/node-lifecycle-controller-deep-dive' },
          { text: 'EndpointSlice Controller', link: '/deep-dive/endpointslice-controller-deep-dive' },
          { text: 'CSI 驱动机制', link: '/deep-dive/csi-driver-deep-dive' },
          { text: 'Device Manager 深度分析', link: '/deep-dive/device-manager-deep-dive' }
        ]
      },
      {
        text: 'Kubernetes 专家路径',
        items: [
          { text: 'Etcd 深度分析', link: '/deep-dive/etcd-deep-dive' },
          { text: 'Containerd 深度分析', link: '/deep-dive/containerd-deep-dive' },
          { text: 'Service Mesh (Istio) 深度分析', link: '/deep-dive/service-mesh-istio-deep-dive' },
          { text: 'Multi-Cluster (karmada/vcluster) 深度分析', link: '/deep-dive/multi-cluster-deep-dive' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/kubernetes/kubernetes' }
    ],

    footer: {
      message: '基于 CC BY-NC-SA 4.0 许可',
      copyright: 'Copyright © 2026'
    },

    // 搜索配置
    search: {
      provider: 'local'
    }
  }
})


export default withMermaid({
    ...a,
    // your existing vitepress config...
    // optionally, you can pass MermaidConfig
    mermaid: {
      // refer https://mermaid.js.org/config/setup/modules/mermaidAPI.html#mermaidapi-configuration-defaults for options
    },
    // optionally set additional config for plugin itself with MermaidPluginConfig
    mermaidPlugin: {
      class: "mermaid my-class", // set additional css classes for parent container 
    },
});
