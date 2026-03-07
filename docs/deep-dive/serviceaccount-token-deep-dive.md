# Service Account 和 Token 管理深度分析

> 本文档深入分析 Kubernetes 的 Service Account 和 Token 管理机制。

---

## Service Account 概述

Service Account 是 Kubernetes 中为 Pod 中的进程提供身份标识的机制。

### 核心职责

- 为 Pod 提供唯一的身份标识
- 控制 Pod 对 Kubernetes API 的访问权限
- 自动管理 Token 生命周期
- 与 RBAC 集成实现最小权限原则
- 支持 OIDC 身份验证

### ServiceAccount 示例

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-service-account
  namespace: default
automountServiceAccountToken: true
```

---

## Token 机制

### Token 类型

Kubernetes 支持三种 Token 类型：

1. Legacy Token（不推荐）：永不过期，安全性低
2. Bound Token（推荐）：可以设置过期时间
3. Projected Token（推荐）：自动轮换，安全性最高

### Legacy Token（不推荐）

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-service-account-token
  annotations:
    kubernetes.io/service-account.name: my-service-account
type: kubernetes.io/service-account-token
```

### Bound Token（推荐）

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-service-account-token
  annotations:
    kubernetes.io/service-account.name: my-service-account
type: kubernetes.io/service-account-token
```

### Projected Token（推荐）

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: projected-token-pod
spec:
  serviceAccountName: my-service-account
  containers:
  - name: container
    image: busybox
    command: ["/bin/sh", "-c", "cat /var/run/secrets/kubernetes.io/serviceaccount/token"]
    volumeMounts:
    - name: token
      mountPath: /var/run/secrets/kubernetes.io/serviceaccount
      readOnly: true
  volumes:
  - name: token
    projected:
      sources:
      - serviceAccountToken:
          path: token
          expirationSeconds: 3600
```

---

## Token 轮换机制

### TokenRequest API

TokenRequest API 用于请求 ServiceAccount Token：

```go
type TokenRequest struct {
    Spec TokenRequestSpec
    Status TokenRequestStatus
}

type TokenRequestSpec struct {
    ExpirationSeconds *int64
    BoundObjectRef   *BoundObjectReference
}

type TokenRequestStatus struct {
    Token                 string
    ExpirationTimestamp    metav1.Time
}
```

### Token 轮换流程

1. Pod 创建时，Kubelet 创建 TokenRequest
2. API Server 生成 Bound Token
3. Token 写入到 Pod 的文件系统
4. Token 过期后自动轮换

---

## Token 注入

### 自动挂载

Kubernetes 自动挂载 ServiceAccount Token 到 Pod：

```
/var/run/secrets/kubernetes.io/serviceaccount/
├── token
├── ca.crt
└── namespace
```

### 禁用自动挂载

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: no-auto-mount-pod
spec:
  automountServiceAccountToken: false
  containers:
  - name: container
    image: busybox
```

### Projected Volume 注入

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: projected-pod
spec:
  serviceAccountName: my-service-account
  containers:
  - name: container
    image: busybox
    volumeMounts:
    - name: secrets
      mountPath: /var/run/secrets
      readOnly: true
  volumes:
  - name: secrets
    projected:
      sources:
      - serviceAccountToken:
          path: token
          expirationSeconds: 3600
      - configMap:
          name: my-config
```

---

## OIDC 集成

### 配置 API Server

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: kube-apiserver
spec:
  containers:
  - name: kube-apiserver
    image: k8s.gcr.io/kube-apiserver:v1.25.0
    command:
    - kube-apiserver
    - --oidc-issuer-url=https://oidc.example.com
    - --oidc-client-id=kubernetes
    - --oidc-username-claim=email
    - --oidc-groups-claim=groups
```

### OIDC 登录流程

1. 用户访问 Kubernetes Dashboard
2. 重定向到 OIDC Provider
3. 用户在 OIDC Provider 登录
4. 重定向回 Kubernetes 并获取 ID Token
5. Kubernetes 验证 Token 并授权访问

---

## 审计追踪

### 配置审计日志

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: audit-policy
data:
  audit-policy.yaml: |
    apiVersion: audit.k8s.io/v1
    kind: Policy
    rules:
    - level: RequestResponse
      verbs: ["create", "delete"]
      resources:
      - group: ""
        resources: ["pods"]
```

### 审计日志示例

```json
{
  "kind": "Event",
  "level": "RequestResponse",
  "verb": "create",
  "user": {
    "username": "system:serviceaccount:default:my-service-account"
  },
  "objectRef": {
    "resource": "pods",
    "namespace": "default",
    "name": "my-pod"
  }
}
```

---

## 安全最佳实践

### 1. 使用 Projected Token

```yaml
apiVersion: v1
kind: Pod
spec:
  serviceAccountName: my-service-account
  automountServiceAccountToken: false
  containers:
  - name: container
    image: busybox
    volumeMounts:
    - name: token
      mountPath: /var/run/secrets
  volumes:
  - name: token
    projected:
      sources:
      - serviceAccountToken:
          path: token
          expirationSeconds: 3600
```

### 2. 限制 ServiceAccount 权限

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: my-role
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list"]
```

### 3. 定期轮换 Token

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: container
    image: busybox
    volumeMounts:
    - name: token
      mountPath: /var/run/secrets
  volumes:
  - name: token
    projected:
      sources:
      - serviceAccountToken:
          path: token
          expirationSeconds: 1800
```

### 4. 配置审计日志

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: kube-apiserver
spec:
  containers:
  - name: kube-apiserver
    command:
    - kube-apiserver
    - --audit-log-path=/var/log/kube-audit/audit.log
    - --audit-policy-file=/etc/kubernetes/audit-policy.yaml
```

---

## 故障排查

### 问题 1：Token 无效

```bash
# 查看 Pod 日志
kubectl logs <pod-name>

# 查看 ServiceAccount
kubectl get sa <service-account-name> -o yaml

# 验证 Token
kubectl auth can-i get pods --as=system:serviceaccount:<namespace>:<sa-name>
```

### 问题 2：Token 过期

```bash
# 查看 Token 过期时间
kubectl get secret <token-name> -o yaml

# 查看审计日志
grep "TokenExpired" /var/log/kube-audit/audit.log
```

### 问题 3：OIDC 认证失败

```bash
# 检查 API Server 配置
kubectl get pods -n kube-system kube-apiserver -o yaml | grep oidc

# 测试 OIDC Provider
curl https://oidc.example.com/.well-known/openid-configuration
```

---

## 总结

### 关键要点

1. ServiceAccount 为 Pod 提供统一的身份标识
2. Kubernetes 自动管理 Token 生命周期
3. 支持自动 Token 轮换和过期
4. 与 RBAC 集成实现最小权限原则
5. 支持 OIDC 身份验证
6. 提供完整的 API 访问审计日志

### 源码位置

| 组件 | 位置 |
|------|------|
| ServiceAccount Controller | `pkg/controller/serviceaccount/` |
| Token Controller | `pkg/controller/serviceaccount/tokens_controller.go` |
| Kubelet ServiceAccount | `pkg/kubelet/serviceaccount/` |
| TokenRequest API | `pkg/apis/authentication/v1/` |

### 相关资源

- [Kubernetes ServiceAccount 文档](https://kubernetes.io/docs/concepts/security/service-accounts/)
- [Kubernetes TokenRequest API](https://kubernetes.io/docs/reference/kubernetes-api/authentication/token-request/)
- [Kubernetes OIDC 认证](https://kubernetes.io/docs/reference/access-authn-authz/authentication/#openid-connect-tokens)
- [Kubernetes RBAC 文档](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)

---

::: tip 最佳实践
1. 使用 Bound Token 和 Projected Token
2. 限制 ServiceAccount 权限（最小权限原则）
3. 设置合理的 Token 过期时间
4. 启用 OIDC 集成（企业环境）
5. 配置审计日志（合规需求）
:::

::: warning 注意事项
- Legacy Token 已弃用，应使用 Bound Token 或 Projected Token
- 自动挂载的 Token 权限可能过大，应禁用自动挂载
- Token 过期时间应合理设置（太短影响体验，太长存在安全风险）
- OIDC 集成需要额外的配置和维护
:::
