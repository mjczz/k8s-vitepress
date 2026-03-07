# Operator Framework (kubebuilder) 深度分析

> 本文档深入分析 Kubernetes Operator Framework 和 kubebuilder 工具，包括控制器运行时、Webhook 配置、CRD 管理和最佳实践。

---

## Operator Framework 概述

### Operator 的作用

Operator 是 Kubernetes 中用于扩展 Kubernetes API 的模式，用于管理自定义资源：

```
┌─────────────────────────────────────────────────┐
│                  Kubernetes                   │
│  ┌─────────────┐      ┌───────────────┐  │
│  │ Custom      │      │ Built-in      │  │
│  │ Resources   │◄────►│ Resources     │  │
│  └─────────────┘      └───────────────┘  │
│         ▲                    ▲           │
│         │                    │           │
│  ┌──────┴─────┐      ┌───────┴──────┐ │
│  │   Operator  │      │   Kubernetes  │ │
│  │   Logic     │      │   Controller │ │
│  └────────────┘      └───────────────┘ │
└─────────────────────────────────────────────────┘
```

### Operator 的核心组件

| 组件 | 说明 |
|------|------|
| **CRD** | 自定义资源定义 |
| **Controller** | 控制器逻辑 |
| **Webhook** | 准入和验证 Webhook |
| **Reconciler** | 协调逻辑 |
| **Finalizer** | 清理逻辑 |

### Operator 的价值

- **自动化**：自动化复杂的应用部署和管理
- **声明式**：通过声明式 API 管理应用
- **自愈**：自动检测和修复应用状态
- **扩展性**：扩展 Kubernetes API

---

## kubebuilder 架构

### 整体架构

```go
// Kubebuilder 项目结构
.
├── cmd/
│   └── main.go              // 主入口
├── api/
│   └── v1/
│       ├── groupversion_info.go
│       ├── myapp_types.go   // CRD 定义
│       └── myapp_types_test.go
├── config/
│   ├── crd/
│   │   └── bases/
│   │       └── myapp.mygroup.k8s.io.yaml
│   ├── rbac/
│   │   └── role.yaml
│   └── manager/
│       └── manager.yaml
├── controllers/
│   └── myapp_controller.go  // 控制器实现
├── hack/
│   └── boilerplate.go
├── go.mod
├── go.sum
└── Makefile
```

### 初始化项目

```bash
# 1. 初始化项目
kubebuilder init --domain my.domain --repo myrepo/myoperator

# 2. 创建 API
kubebuilder create api --group mygroup --version v1 --kind MyApp

# 3. 创建 Controller
kubebuilder create controller --kind=MyApp

# 4. 运行
make run
```

---

## 控制器运行时（controller-runtime）

### 核心接口

**位置**：`sigs.k8s.io/controller-runtime/pkg/runtime/controller.go`

```go
// Controller 控制器接口
type Controller interface {
    // Reconciler Reconciler
    Reconcile(context.Context, reconcile.Request) (reconcile.Result, error)

    // Name Name
    Name() string

    // Start Start
    Start(context.Context) error
}

// Reconciler Reconciler 接口
type Reconciler interface {
    // Reconcile 协调
    Reconcile(context.Context, reconcile.Request) (reconcile.Result, error)
}
```

### Reconciler 实现

**位置**：`controllers/myapp_controller.go`

```go
// MyAppReconciler MyApp Reconciler
type MyAppReconciler struct {
    client.Client
    Scheme *runtime.Scheme
}

// +kubebuilder:rbac:groups=mygroup.my.domain,resources=myapps,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=mygroup.my.domain,resources=myapps/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=mygroup.my.domain,resources=myapps/finalizers,verbs=update

func (r *MyAppReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    log := log.FromContext(ctx)

    // 1. 获取 MyApp 实例
    myapp := &mygroupv1.MyApp{}
    if err := r.Get(ctx, req.NamespacedName, myapp); err != nil {
        if errors.IsNotFound(err) {
            // MyApp 已删除
            return ctrl.Result{}, nil
        }
        return ctrl.Result{}, err
    }

    // 2. 获取关联的 Deployment
    deployment := &appsv1.Deployment{}
    if err := r.Get(ctx, req.NamespacedName, deployment); err != nil {
        if errors.IsNotFound(err) {
            // Deployment 不存在，创建
            deployment = r.newDeploymentForCR(myapp)
            if err := r.Create(ctx, deployment); err != nil {
                return ctrl.Result{}, err
            }
        } else {
            return ctrl.Result{}, err
        }
    }

    // 3. 更新 Deployment 规范
    if !metav1.IsControlledBy(deployment, myapp) {
        return ctrl.Result{}, fmt.Errorf("Deployment not controlled by MyApp")
    }

    deployment.Spec.Replicas = myapp.Spec.Replicas
    if err := r.Update(ctx, deployment); err != nil {
        return ctrl.Result{}, err
    }

    // 4. 更新 MyApp 状态
    myapp.Status.AvailableReplicas = deployment.Status.AvailableReplicas
    myapp.Status.ReadyReplicas = deployment.Status.ReadyReplicas
    if err := r.Status().Update(ctx, myapp); err != nil {
        return ctrl.Result{}, err
    }

    return ctrl.Result{}, nil
}

// newDeploymentForCR 创建 Deployment
func (r *MyAppReconciler) newDeploymentForCR(cr *mygroupv1.MyApp) *appsv1.Deployment {
    labels := map[string]string{
        "app": cr.Name,
    }

    return &appsv1.Deployment{
        ObjectMeta: metav1.ObjectMeta{
            Name:      cr.Name,
            Namespace: cr.Namespace,
            Labels:    labels,
        },
        Spec: appsv1.DeploymentSpec{
            Replicas: cr.Spec.Replicas,
            Selector: &metav1.LabelSelector{
                MatchLabels: labels,
            },
            Template: corev1.PodTemplateSpec{
                ObjectMeta: metav1.ObjectMeta{
                    Labels: labels,
                },
                Spec: corev1.PodSpec{
                    Containers: []corev1.Container{
                        {
                            Name:  "myapp",
                            Image: cr.Spec.Image,
                        },
                    },
                },
            },
        },
    },
}
}
```

### SetupWithManager

**位置**：`main.go`

```go
func main() {
    // 1. 设置 Scheme
    scheme := runtime.NewScheme()

    utilruntime.Must(mygroupv1.AddToScheme(scheme))
    utilruntime.Must(corev1.AddToScheme(scheme))
    utilruntime.Must(appsv1.AddToScheme(scheme))

    // 2. 创建 Manager
    mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), ctrl.Options{
        Scheme:             scheme,
        MetricsBindAddress: metricsAddr,
        Port:               9443,
    })
    if err != nil {
        setupLog.Error(err, "unable to start manager")
        os.Exit(1)
    }

    // 3. 注册 Controller
    if err := ctrl.NewControllerManagedBy(mgr).
        For(&mygroupv1.MyApp{}).
        Owns(&appsv1.Deployment{}).
        Complete(&MyAppReconciler{
            Client: mgr.GetClient(),
            Scheme: mgr.GetScheme(),
        }); err != nil {
        setupLog.Error(err, "unable to create controller")
        os.Exit(1)
    }

    // 4. 启动 Manager
    if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
        setupLog.Error(err, "problem running manager")
        os.Exit(1)
    }
}
```

---

## Webhook 配置

### ValidatingWebhook

**位置**：`api/v1/myapp_webhook.go`

```go
// MyAppCustomDefaulter 默认值 Webhook
type MyAppCustomDefaulter struct {
    Client  client.Client
    Decoder *admission.Decoder
}

// Default 实施
func (wh *MyAppCustomDefaulter) Default(ctx context.Context, obj runtime.Object) error {
    myapp, ok := obj.(*mygroupv1.MyApp)
    if !ok {
        return nil
    }

    // 设置默认值
    if myapp.Spec.Replicas == 0 {
        myapp.Spec.Replicas = 1
    }

    if myapp.Spec.Image == "" {
        myapp.Spec.Image = "nginx:latest"
    }

    return nil
}

// +kubebuilder:webhook:path=/mutate-mygroup-my-domain-v1-myapp,mutating=true,failurePolicy=fail,sideEffects=None,groups=mygroup.my.domain,resources=myapps,verbs=create;update,versions=v1,name=mmyapp.kb.io
// +kubebuilder:webhook:verbs=create;update,path=/validate-mygroup-my-domain-v1-myapp,mutating=false,failurePolicy=fail,sideEffects=None,groups=mygroup.my.domain,resources=myapps,versions=v1,name=vmyapp.kb.io
```

### MutatingWebhook

**位置**：`api/v1/myapp_webhook.go`

```go
// MyAppValidator 验证 Webhook
type MyAppValidator struct {
    Client  client.Client
    Decoder *admission.Decoder
}

// ValidateCreate 创建验证
func (wh *MyAppValidator) ValidateCreate(ctx context.Context, obj runtime.Object) (admission.Warnings, error) {
    myapp, ok := obj.(*mygroupv1.MyApp)
    if !ok {
        return nil, nil
    }

    // 验证 Replicas
    if myapp.Spec.Replicas < 1 || myapp.Spec.Replicas > 10 {
        return nil, field.Error(
            field.NewPath("spec", "replicas"),
            "replicas must be between 1 and 10",
        )
    }

    // 验证 Image
    if myapp.Spec.Image == "" {
        return nil, field.Error(
            field.NewPath("spec", "image"),
            "image is required",
        )
    }

    return nil, nil
}

// ValidateUpdate 更新验证
func (wh *MyAppValidator) ValidateUpdate(ctx context.Context, oldObj, newObj runtime.Object) (admission.Warnings, error) {
    oldMyApp := oldObj.(*mygroupv1.MyApp)
    newMyApp := newObj.(*mygroupv1.MyApp)

    // 验证不可变字段
    if oldMyApp.Spec.Image != newMyApp.Spec.Image {
        return nil, field.Error(
            field.NewPath("spec", "image"),
            "field is immutable",
        )
    }

    return nil, nil
}
```

---

## CRD 定义

### CRD 结构

**位置**：`api/v1/myapp_types.go`

```go
// MyAppSpec MyApp 规范
type MyAppSpec struct {
    // Replicas 副本数
    Replicas int32 `json:"replicas"`

    // Image 容器镜像
    Image string `json:"image"`
}

// MyAppStatus MyApp 状态
type MyAppStatus struct {
    // AvailableReplicas 可用副本数
    AvailableReplicas int32 `json:"availableReplicas"`

    // ReadyReplicas 就绪副本数
    ReadyReplicas int32 `json:"readyReplicas"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:path=myapps,shortName=ma
// +kubebuilder:printcolumn:name=.metadata.name,type=string,JSONPath=`.metadata.name`
// +kubebuilder:printcolumn:name=.spec.replicas,type=integer,JSONPath=`.spec.replicas`
// +kubebuilder:printcolumn:name=.status.availableReplicas,type=integer,JSONPath=`.status.availableReplicas`
type MyApp struct {
    metav1.TypeMeta   `json:",inline"`
    metav1.ObjectMeta `json:"metadata,omitempty"`

    Spec   MyAppSpec   `json:"spec,omitempty"`
    Status MyAppStatus `json:"status,omitempty"`
}
```

### CRD YAML

**位置**：`config/crd/bases/myapp.mygroup.k8s.io.yaml`

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: myapps.mygroup.k8s.io
spec:
  group: mygroup.k8s.io
  names:
    kind: MyApp
    listKind: MyAppList
    plural: myapps
    singular: myapp
    shortNames:
    - ma
  scope: Namespaced
  versions:
  - name: v1
    schema:
      openAPIV3Schema:
        type: object
        properties:
          spec:
            type: object
            properties:
              replicas:
                type: integer
                minimum: 1
                maximum: 10
              image:
                type: string
          status:
            type: object
            properties:
              availableReplicas:
                type: integer
              readyReplicas:
                type: integer
    served: true
    storage: true
    subresources:
      status: {}
```

---

## 最佳实践

### 1. 使用 RBAC

```go
// +kubebuilder:rbac:groups=mygroup.my.domain,resources=myapps,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=mygroup.my.domain,resources=myapps/status,verbs=get;update;patch
// +kubebuilder:rbac:groups="",resources=events,verbs=create;patch
```

### 2. 设置 Finalizer

```go
const myappFinalizer = "myapp.my.domain/finalizer"

func (r *MyAppReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    // 1. 获取 MyApp
    myapp := &mygroupv1.MyApp{}
    if err := r.Get(ctx, req.NamespacedName, myapp); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }

    // 2. 检查删除时间戳
    if !myapp.DeletionTimestamp.IsZero() {
        // 3. 执行清理逻辑
        if controllerutil.ContainsFinalizer(myapp, myappFinalizer) {
            if err := r.cleanupResources(ctx, myapp); err != nil {
                return ctrl.Result{}, err
            }

            // 4. 移除 Finalizer
            controllerutil.RemoveFinalizer(myapp, myappFinalizer)
            if err := r.Update(ctx, myapp); err != nil {
                return ctrl.Result{}, err
            }
        }
        return ctrl.Result{}, nil
    }

    // 5. 添加 Finalizer
    if !controllerutil.ContainsFinalizer(myapp, myappFinalizer) {
        controllerutil.AddFinalizer(myapp, myappFinalizer)
        if err := r.Update(ctx, myapp); err != nil {
            return ctrl.Result{}, err
        }
    }

    return ctrl.Result{}, nil
}
```

### 3. 使用 Reconcile Result

```go
func (r *MyAppReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    // 1. 正常重新协调
    if err := r.reconcile(ctx, req); err != nil {
        return ctrl.Result{RequeueAfter: 30 * time.Second}, err
    }

    // 2. 错误时重新协调
    return ctrl.Result{}, nil
}

func (r *MyAppReconciler) reconcile(ctx context.Context, req ctrl.Request) error {
    // 协调逻辑
    return nil
}
```

### 4. 使用 Status Conditions

```go
// MyAppStatus MyApp 状态
type MyAppStatus struct {
    // Conditions 状态条件
    Conditions []metav1.Condition `json:"conditions,omitempty"`
}

func (r *MyAppReconciler) updateStatus(ctx context.Context, myapp *mygroupv1.MyApp, conditionType string, status metav1.ConditionStatus, reason, message string) error {
    condition := metav1.Condition{
        Type:               conditionType,
        Status:             status,
        Reason:              reason,
        Message:             message,
        LastTransitionTime:  metav1.Now(),
    }

    myapp.Status.Conditions = append(myapp.Status.Conditions, condition)
    return r.Status().Update(ctx, myapp)
}
```

---

## 故障排查

### 问题 1：Reconcile 不触发

```bash
# 检查 CRD
kubectl get crd myapps.mygroup.k8s.io

# 检查 Operator 日志
kubectl logs -n my-operator-system deployment/my-operator-controller-manager

# 检查 Manager 状态
kubectl get deployment -n my-operator-system
```

### 问题 2：Webhook 超时

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: myapp-validating-webhook
webhooks:
- name: myapp.kb.io
  timeoutSeconds: 10  # 增加超时时间
  failurePolicy: Fail
  sideEffects: None
```

### 问题 3：CRD 创建失败

```bash
# 检查 CRD YAML
kubectl apply -f config/crd/bases/myapp.mygroup.k8s.io.yaml --dry-run=client

# 验证 OpenAPI Schema
kubectl get crd myapps.mygroup.k8s.io -o yaml | grep -A 20 openAPIV3Schema
```

---

## 总结

### 关键要点

1. **控制器模式**：通过控制器模式管理自定义资源
2. **Reconcile 循环**：持续协调期望状态和实际状态
3. **Webhook**：提供验证和修改能力
4. **CRD**：扩展 Kubernetes API
5. **RBAC**：最小权限原则
6. **Finalizer**：确保资源清理

### 源码位置

| 组件 | 位置 |
|------|------|
| controller-runtime | `sigs.k8s.io/controller-runtime/` |
| kubebuilder | `sigs.k8s.io/kubebuilder/` |
| controller-tools | `sigs.k8s.io/controller-tools/` |

### 相关资源

- [Kubebuilder 官方文档](https://book.kubebuilder.io/)
- [Controller Runtime 文档](https://pkg.go.dev/sigs.k8s.io/controller-runtime)
- [Operator 模式](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/)

---

::: tip 最佳实践
1. 使用 kubebuilder 快速创建 Operator
2. 遵循控制器模式和最佳实践
3. 使用 Finalizer 确保资源清理
4. 设置合理的 RBAC 权限
5. 使用 Status Conditions 报告状态
:::

::: warning 注意事项
- 避免在 Reconcile 中进行长时间运行的操作
- 正确处理错误和重新协调
- 避免循环依赖
- 测试 Webhook 的性能和可靠性
:::
