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
      { text: '核心组件', link: '/deep-dive/api-server-deep-dive' },
      { text: 'GitHub', link: 'https://github.com/kubernetes/kubernetes' }
    ],

    sidebar: [
      {
        text: '开始',
        items: [
          { text: '首页', link: '/' },
          { text: '分析计划', link: '/deep-dive/ANALYSIS_TODO' }
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
          { text: 'Service Account 和 Token 管理', link: '/deep-dive/serviceaccount-token-deep-dive' }
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
