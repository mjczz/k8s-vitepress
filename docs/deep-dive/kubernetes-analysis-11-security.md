# Kubernetes 项目分析 - 11: 安全机制

**项目路径**: `~/work/todo/kubernetes`
**分析日期**: 2026-02-10
**主题**: RBAC、Secret、ServiceAccount、准入控制

---

## 安全架构概述

Kubernetes 采用多层次的安全模型：

```
认证 → 授权 → 准入控制 → 审计
```

---

## ServiceAccount

### 概述

ServiceAccount 为 Pod 提供身份标识：

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-service-account
automountServiceAccountToken: false
secrets:
- name: my-secret
```

### SA Token

自动挂载到 Pod：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-pod
spec:
  serviceAccountName: my-service-account
  volumes:
  - name: service-account-token
    secret:
      secretName: my-service-account-token-xxxxx
```

---

## RBAC（基于角色的访问控制）

### Role

定义权限规则：

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: default
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
```

### ClusterRole

集群级权限：

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: node-admin
rules:
- apiGroups: [""]
  resources: ["nodes"]
  verbs: ["get", "list", "watch", "create", "delete"]
```

### RoleBinding

绑定 Role 到 Subject：

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: binding
  namespace: default
subjects:
- kind: ServiceAccount
  name: my-sa
roleRef:
  kind: Role
  name: pod-reader
```

---

## Secret

### Secret 类型

```yaml
# Opaque（通用）
apiVersion: v1
kind: Secret
type: Opaque
stringData:
  username: admin
  password: secret

# Service Account Token
apiVersion: v1
kind: Secret
type: kubernetes.io/service-account-token
annotations:
  kubernetes.io/service-account.name: my-sa
data:
  token: base64-encoded-token

# Docker Registry
apiVersion: v1
kind: Secret
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: base64-encoded-config
```

### Secret 管理

```go
// 创建 Secret
func (s *SecretController) reconcileSecret(ctx context.Context, secret *v1.Secret) error {
    // 1. 从 Vault 加密获取
    data, err := s.vault.Get(secret.Spec.Vault)
    if err != nil {
        return err
    }

    // 2. 创建 Secret
    newSecret := &v1.Secret{
        ObjectMeta: metav1.ObjectMeta{
            Name:      secret.Name,
            Namespace: secret.Namespace,
        },
        Data: data,
    }

    _, err = s.kubeClient.CoreV1().Secrets(secret.Namespace).Create(ctx, newSecret)
    return err
}
```

---

## 准入控制

### Mutating Webhook

修改对象示例：

```go
func (m *MutatingWebhook) Mutate(ctx context.Context, req admission.Request) admission.Response {
    // 1. 深拷贝对象
    copy := req.Object.DeepCopyObject()

    // 2. 注入 Sidecar
    obj := copy.(*v1.Pod)
    obj.Spec.Containers = append(obj.Spec.Containers, v1.Container{
        Name:  "sidecar",
        Image: "proxy:latest",
    })

    // 3. 添加注解
    obj.Annotations["injected-by"] = "mutating-webhook"

    return admission.ValidationResponse(true, obj)
}
```

### Validating Webhook

验证对象示例：

```go
func (v *ValidatingWebhook) Validate(ctx context.Context, req admission.Request) admission.Response {
    // 1. 反序列化
    obj := &v1.Pod{}
    if err := json.Unmarshal(req.Object.Raw, obj); err != nil {
        return admission.Errored(http.StatusBadRequest, err.Error())
    }

    // 2. 验证 Pod 名称
    if !isValidPodName(obj.Name) {
        return admission.Denied("Invalid pod name")
    }

    // 3. 验证镜像引用
    if !isValidImageRef(obj.Spec.Containers[0].Image) {
        return admission.Denied("Invalid image reference")
    }

    return admission.ValidationResponse(true, nil)
}
```

---

## Pod Security Policy

### Pod Security Context

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  securityContext:
    runAsUser: 1000
    runAsGroup: 3000
    fsGroup: 2000
    seLinuxOptions:
      level: "s0:c23,c25,c10"
  containers:
  - name: my-container
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop:
        - ALL
        add:
        - NET_BIND_SERVICE
```

### Security Context 字段

- **runAsUser/runAsGroup** - 运行用户/组
- **fsGroup** - 文件系统组
- **seLinuxOptions** - SELinux 配置
- **capabilities** - Linux 能力
- **privileged** - 特权模式

---

## Network Policy

### 网络隔离

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
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

---

## 审计

### 审计事件

```go
type Event struct {
    Level      Level
    Timestamp  metav1.Time
    Verb       string
    RequestURI string
    User       string
    ObjectRef  *v1.ObjectReference
}

type Level string

const (
    LevelMetadata   = "Metadata"
    LevelRequest   = "Request"
)

func (a *Auditor) logAudit(e Event) {
    // 1. 记录到日志
    klog.InfoS("audit", "verb", e.Verb, "user", e.User, "object", e.ObjectRef)

    // 2. 发送到审计后端
    a.backend.Log(e)
}
```

---

## 总结

**Kubernetes 安全核心特点：**
1. **多层次安全** - 认证、授权、准入、审计
2. **最小权限原则** - 仅授予必要权限
3. **ServiceAccount** - Pod 身份标识
4. **RBAC** - 基于角色的访问控制
5. **Secret** - 敏感数据管理
6. **准入控制** - 对象验证和修改
7. **Pod Security** - 容器安全隔离
8. **Network Policy** - 网络流量控制
9. **审计日志** - 完整的操作记录

**分析完成时间**: 2026-02-10
**分析人员**: 小宝
**下一步**: 提交所有分析到仓库
