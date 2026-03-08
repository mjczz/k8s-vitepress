# Kubernetes 项目分析 - 10: API 设计

**项目路径**: `~/work/todo/kubernetes`
**分析日期**: 2026-02-10
**主题**: API 组、CRD、Conversion Webhook

---

## API 概述

Kubernetes API 采用声明式设计，遵循 RESTful 原则和版本控制策略。

---

## API 组结构

### API 版本策略

```
API 版本层级：
Alpha (v1alpha1) → Beta (v1beta1, v2beta1) → Stable (v1)
```

**版本控制原则：**
- API 必须向后兼容
- 废弃前经过 3 个版本周期
- 同一版本内的 API 一起废弃

### API 组示例

```
k8s.io/api/core/v1           # 核心资源（Pod, Service, Node 等）
k8s.io/api/apps/v1           # 应用资源（Deployment, StatefulSet 等）
k8s.io/api/batch/v1          # 批处理资源（Job, CronJob）
k8s.io/api/networking.k8s.io/v1  # 网络资源（Ingress, NetworkPolicy）
k8s.io/api/storage.k8s.io/v1     # 存储资源（PV, PVC, StorageClass）
k8s.io/api/authentication.k8s.io/v1  # 认证资源
k8s.io/api/authorization.k8s.io/v1   # 授权资源
k8s.io/api/rbac.authorization.k8s.io/v1  # RBAC 资源
```

---

## CRD（自定义资源定义）

### CRD 概述

CRD 允许用户扩展 Kubernetes API：

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: crontabs.stable.example.com
spec:
  group: stable.example.com
  versions:
  - name: v1
    served: true
    storage: true
  scope: Namespaced
  names:
    plural: crontabs
    singular: crontab
    kind: CronTab
    shortNames:
    - ct
```

### CRD 生命周期

```
1. 创建 CRD → 2. API Server 注册 CRD → 3. 用户可以创建自定义资源
```

### CRD Controller

监听自定义资源：

```go
// 控制器示例
type CronTabController struct {
    kubeClient clientset.Interface
    crdLister  crdv1.CronTabLister
}

func (c *CronTabController) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    // 1. 获取 CronTab
    crontab := &crdv1.CronTab{}
    if err := c.Get(ctx, req.NamespacedName, crontab); err != nil {
        return ctrl.Result{}, err
    }

    // 2. 处理 CronTab
    return c.handleCronTab(crontab)
}
```

---

## Conversion Webhook

### 概述

Conversion Webhook 处理 API 版本转换：

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
webhooks:
- name: webhook.example.com
  rules:
  - apiGroups:   ["*"]
    apiVersions: ["*"]
    operations:   ["CREATE", "UPDATE"]
    resources:   ["*/cronabs"]
  clientConfig:
    service:
      name: webhook-service
      namespace: default
      path: /convert
```

### Conversion Webhook 实现

```go
func (w *Webhook) Handle(ctx context.Context, req admission.Request) admission.Response {
    // 1. 反序列化请求
    obj := &unstructured.Unstructured{}
    if err := json.Unmarshal(req.Object.Raw, obj); err != nil {
        return admission.Errored(http.StatusBadRequest, err.Error())
    }

    // 2. 转换对象
    converted, err := w.convert(obj, req.RequestKind)
    if err != nil {
        return admission.Errored(http.StatusBadRequest, err.Error())
    }

    // 3. 返回转换后的对象
    return admission.ValidationResponse(true, converted)
}
```

---

## API 安全机制

### 认证

```yaml
# 使用 ServiceAccount Token
apiVersion: v1
kind: Pod
metadata:
  name: my-pod
spec:
  serviceAccountName: my-sa
```

### 授权（RBAC）

```yaml
# Role 定义权限
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: default
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "create"]

# RoleBinding 绑定 Role 到 ServiceAccount
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-rolebinding
subjects:
- kind: ServiceAccount
  name: my-sa
roleRef:
  kind: Role
  name: my-role
```

### 准入控制

#### Mutating Webhook

修改对象：

```go
func (m *MutatingWebhook) Mutate(ctx context.Context, req admission.Request) admission.Response {
    // 1. 深拷贝对象
    copy := req.Object.DeepCopyObject()

    // 2. 修改对象
    obj := copy.(*v1.Pod)
    obj.Labels["added-by"] = "mutating-webhook"

    // 3. 返回修改后的对象
    return admission.ValidationResponse(true, obj)
}
```

#### Validating Webhook

验证对象：

```go
func (v *ValidatingWebhook) Validate(ctx context.Context, req admission.Request) admission.Response {
    // 1. 反序列化
    obj := &v1.Pod{}
    if err := json.Unmarshal(req.Object.Raw, obj); err != nil {
        return admission.Errored(http.StatusBadRequest, err.Error())
    }

    // 2. 验证对象
    if obj.Labels["required"] == "" {
        return admission.Denied("Missing required label")
    }

    return admission.ValidationResponse(true, nil)
}
```

---

## 总结

**Kubernetes API 设计核心特点：**
1. **声明式 API** - 期望状态驱动
2. **RESTful 设计** - 标准 HTTP 动词
3. **版本控制** - Alpha → Beta → Stable
4. **扩展性** - CRD + Webhook
5. **安全性** - 认证、授权、准入控制
6. **向后兼容** - 保证不破坏现有客户端

**分析完成时间**: 2026-02-10
**分析人员**: 小宝
**下一步**: 分析安全机制
