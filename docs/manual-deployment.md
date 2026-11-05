# 将公开 GitHub 仓库手动部署到 Azure Container Apps

本文把本项目的手动发布过程整理为可复用指南。命令使用 **Azure Cloud Shell / PowerShell 7.4+**；
资料核对日期为 **2026-11-05 UTC**。不会自动创建、删除 Azure 资源或修改组织策略。

```text
公开 GitHub 仓库
  -> Cloud Shell 拉取源码
  -> ACR Tasks 根据 Dockerfile 构建并保存镜像
  -> ACA 使用 UAMI 拉取镜像
  -> 新 revision 就绪
  -> 从公网验证实际运行版本
```

不需要本机 Docker、GitHub Actions、GitHub Environment、GitHub FIC 或 ACR admin 密码。
操作 Azure 用的是你自己的登录身份；运行时拉镜像用的是 ACA 的 UAMI。
手动部署仍受 Azure RBAC、网络配置和组织策略约束，并不是绕过策略。
**公开源码不等于公开镜像仓库**：ACR 可以继续要求身份认证。

## 适用范围与一次性准备

本指南更新**已有的、同一订阅内的单容器 ACA 应用**，不覆盖私有网络拓扑或完整资源创建流程。
第一次使用时，先在 Portal 准备以下资源；已有资源不要重复创建。

| 项目 | 本项目要求 |
| --- | --- |
| GitHub 仓库 | 可匿名 clone，包含 Dockerfile 和适当的 `.dockerignore` |
| ACR | 已创建；Cloud Shell、构建服务和 ACA 能访问；保持 admin user 关闭 |
| ACA Environment | ACA 的运行环境，必须保留；不是 GitHub Environment |
| Container App | 单容器，Single revision mode，external HTTP ingress，target port `8080` |
| UAMI | 已创建，并添加到 **Container App → Identity → User assigned** |
| 镜像 | 本项目构建 Linux/amd64，容器内监听 `8080`，使用非 root 用户 |

本项目 Dockerfile 位于 `aca-presentation\Dockerfile`，**构建上下文是 `aca-presentation`**，
不是仓库根目录。换成其他公开项目时，需要相应调整 Dockerfile、构建上下文、监听端口、
启动所需配置及健康验证，不能直接把任意源码 ZIP 上传给 ACA。

### 谁需要什么权限

先在 **ACR → Properties → Role assignment permissions mode** 查看现有模式，按模式授权，
不要为了照抄本指南切换一个已有 ACR 的权限模式。

| 身份 / 用途 | 普通 RBAC 模式 | RBAC + ABAC 模式 |
| --- | --- | --- |
| 你的用户：镜像读写 | `AcrPush` 或等效权限 | `Container Registry Repository Writer`，覆盖目标镜像仓库 |
| ACA 的 UAMI：拉取镜像 | `AcrPull` | `Container Registry Repository Reader`，覆盖目标镜像仓库 |

你的用户还需要读取资源、运行 ACR Tasks、更新该 ACA，以及关联 UAMI 所需的权限。
镜像读写角色本身不等于管理面权限；例如 `Container Registry Tasks Contributor` 提供构建任务权限，
但不代替镜像读写权限。已有等效授权无需重复添加。

在 **ACR → Access control (IAM)** 中，把拉取角色授予**实际选择的 UAMI**，不是操作人的账号，
也不是另一份系统分配身份。角色范围限定在目标 ACR；ABAC 可进一步限制目标仓库。
执行角色分配需要相应的角色分配权限，不能假定 Contributor 足够。

UAMI 和 SAMI 都是 ACA 支持的方式，本指南统一选择 UAMI。
`registry set --identity` 要的是 **UAMI Resource ID**，不是 Client ID 或 Principal/Object ID。

## 1. 打开 Cloud Shell，设置参数

在你的 Azure Portal 中切换到目标目录和订阅，打开 **Cloud Shell → PowerShell**。
首次使用可选择 **No storage account required**；临时会话结束后文件和变量可能丢失，
但已推入 ACR 的镜像和已部署的 ACA 不依赖这个终端继续运行。

先替换所有 `<...>` 参数。下面各段在**同一个会话中按顺序整段执行**；
上一段成功后再执行下一段。代码使用 `. { ... }` 保留当前会话变量，
同时让错误终止当前代码块。不要把它改成会创建子作用域的 `& { ... }` 后再期待变量跨段保留。

```powershell
. {
    $ErrorActionPreference = "Stop"
    if ($PSVersionTable.PSVersion -lt [version]"7.4") {
        throw "Use PowerShell 7.4 or later."
    }
    $PSNativeCommandUseErrorActionPreference = $true

    $subscriptionId = "<subscription-id>"
    $rg = "<container-app-resource-group>"
    $app = "<container-app-name>"
    $acr = "<acr-name>"
    $uamiRg = "<uami-resource-group>"
    $uamiName = "<uami-name>"

    $repoUrl = "https://github.com/alex031029/aca-sharing-demo.git"
    $repoRef = "main"
    $buildContext = "aca-presentation"
    $imageRepo = "sharing-presentation"
    $appVersion = "v1"

    if (@($subscriptionId, $rg, $app, $acr, $uamiRg, $uamiName) -match "<") {
        throw "Replace all configuration placeholders first."
    }

    az account set --subscription $subscriptionId
    az account show --query "{subscription:name,id:id,tenant:tenantId}" --output table
}
```

确认显示的是目标订阅。参数只保留在自己的会话中，不要把订阅 ID、身份 ID 或凭据填入公开仓库。

## 2. 查询身份、权限模式和 ACA 配置

以下只读取配置。UAMI 必须先在 Portal 中关联好；保存 Identity 后不要同时从多个终端更新 ACA。
如果当前状态是 `InProgress`，先按后面的故障处理等待；如果是 `Failed`，先查具体错误，
处理原因后可以提交新的部署，不必等失败状态自行变成 `Succeeded`。

```powershell
. {
    $acrInfo = az acr show --name $acr --output json | ConvertFrom-Json
    $registry = $acrInfo.loginServer
    $buildAuthArgs = @()
    switch ($acrInfo.roleAssignmentMode) {
        "LegacyRegistryPermissions" { $pullRole = "AcrPull" }
        "AbacRepositoryPermissions" {
            $pullRole = "Container Registry Repository Reader"
            $buildAuthArgs = @("--source-acr-auth-id", "[caller]")
        }
        default { throw "Unknown ACR role mode. Check ACR Properties and your CLI version." }
    }
    "Required UAMI pull role: $pullRole"

    $armAuth = az acr config authentication-as-arm show --registry $acr --query status --output tsv
    if ($armAuth -ne "enabled") {
        throw "Managed-identity image pull requires ARM audience tokens. Review the approved ACR configuration."
    }

    $uamiId = az identity show --name $uamiName --resource-group $uamiRg --query id --output tsv
    $target = az containerapp show --name $app --resource-group $rg --output json | ConvertFrom-Json
    $appId = $target.id
    if ($target.properties.configuration.activeRevisionsMode -ne "Single" -or
        $target.properties.configuration.ingress.external -ne $true -or
        $target.properties.configuration.ingress.targetPort -ne 8080 -or
        @($target.properties.template.containers).Count -ne 1) {
        throw "This guide expects one container, Single revision mode and external ingress on port 8080."
    }
    if ($target.identity.userAssignedIdentities.PSObject.Properties.Name -notcontains $uamiId) {
        throw "Attach this UAMI in Container App > Identity > User assigned first."
    }
    $target.properties.provisioningState
}
```

`$uamiId` 应形如：

```text
/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.ManagedIdentity/userAssignedIdentities/<uami-name>
```

上面的配置查询不代替 RBAC 授权检查；请完成前面的一次性授权。
ACR 需要允许 ARM audience token 才能使用这条托管身份拉取路径；
如果检查失败，先按组织允许的配置处理，不要盲目开启认证选项或调整策略。

## 3. 拉取源码，让 ACR 构建并上传

`az acr build` 会上传构建上下文并在 Azure 构建、推送镜像；不需要再执行本地 `docker push`。
ABAC 模式额外使用调用者身份访问仓库，`$buildAuthArgs` 已在上一步设置。

```powershell
. {
    $workDir = Join-Path $HOME ("aca-manual-$(Get-Date -Format yyyyMMddHHmmss)")
    git clone --depth 1 --branch $repoRef $repoUrl $workDir
    Set-Location (Join-Path $workDir $buildContext)
    if (-not (Test-Path -LiteralPath "Dockerfile")) {
        throw "Dockerfile not found in the selected build context."
    }

    $commit = git rev-parse --short=12 HEAD
    $imageTag = "manual-${commit}-$(Get-Date -Format yyyyMMddHHmmss)"
    az acr build --registry $acr --image "${imageRepo}:${imageTag}" `
        --platform linux/amd64 --file Dockerfile @buildAuthArgs .

    az acr repository show --name $acr --image "${imageRepo}:${imageTag}" --query digest --output tsv
    $deployImage = "${registry}/${imageRepo}:${imageTag}"
    "Source commit: $commit"
    "Built image: $deployImage"
}
```

等构建成功并查到 digest 后再继续。每次改代码使用新 tag，不覆盖旧 tag 或依赖 `latest`。
保存本次的 commit、image tag；后面确认上线后再把它记为“验证成功的版本”。
源码未改、只是重试部署或切换 `APP_VERSION` 时，可以复用已存在的镜像。

## 4. 配置 UAMI 拉取，并创建新 revision

把 **image tag** 和 **revision suffix** 分开：前者必须对应实际存在的镜像，
后者用于创建这次部署的新 revision。仅改变 suffix 不会构建任何镜像。

每次执行本节都会提交一次新的发布。不要在另一个终端或 Portal 同时保存该 ACA。
代码不改变 ingress、CPU、内存或副本上下限，也不删除应用。

```powershell
. {
    $state = az containerapp show --name $app --resource-group $rg --query properties.provisioningState --output tsv
    if ($state -eq "InProgress") {
        throw "Another provisioning operation is active. Wait before submitting a new update."
    }
    az acr repository show --name $acr --image "${imageRepo}:${imageTag}" --query digest --output tsv
    $deployImage = "${registry}/${imageRepo}:${imageTag}"

    $configuredIdentity = az containerapp registry list --name $app --resource-group $rg `
        --query "[?server=='$registry'].identity | [0]" --output tsv
    if ($configuredIdentity -ne $uamiId) {
        az containerapp registry set --name $app --resource-group $rg `
            --server $registry --identity $uamiId --output none
        $configuredIdentity = az containerapp registry show --name $app --resource-group $rg `
            --server $registry --query identity --output tsv
        if ($configuredIdentity -ne $uamiId) {
            throw "Registry identity does not match the selected UAMI."
        }

        az resource wait --ids $appId --custom "properties.provisioningState!='InProgress'" --interval 10 --timeout 600
        $state = az containerapp show --name $app --resource-group $rg --query properties.provisioningState --output tsv
        if ($state -ne "Succeeded") {
            throw "Registry provisioning ended in state '$state'. Inspect the error before deploying an image."
        }
    }

    $revisionSuffix = "manual-$(Get-Date -Format yyyyMMddHHmmss)"
    $expectedRevision = "${app}--${revisionSuffix}"
    az containerapp update --name $app --resource-group $rg `
        --image $deployImage --set-env-vars "APP_VERSION=$appVersion" `
        --revision-suffix $revisionSuffix `
        --query "{state:properties.provisioningState,latest:properties.latestRevisionName,ready:properties.latestReadyRevisionName}" `
        --output table
    "Expected revision: $expectedRevision"
}
```

某条命令失败就停在该处，保留原始错误；不要因为看到了 `Updating existing registry`
或 `already assigned` 就判断成功。前者是进度提示，后者只是说明身份已关联。
已指向目标 UAMI 时，不重复写入 registry 配置。
需要修改时，会先等待该次配置退出 `InProgress` 并确认 `Succeeded`，再提交镜像更新；
如果变成 `Failed`，会明确停止，而不是再与失败中的操作竞争。
`--identity system` 是 SAMI 的写法，本指南必须传 `$uamiId`。

## 5. 验证公网实际返回的新版本

Single 模式的新 revision 就绪前，旧 revision 可能继续服务。
因此“网址能打开”或“HTTP 200”不够：本项目还要核对真实 API 的版本和 revision。
如果本节因冷启动或尚未就绪失败，先查看状态，再重试**本节**，不要直接重复发布。

```powershell
. {
    $fqdn = az containerapp show --name $app --resource-group $rg --query properties.configuration.ingress.fqdn --output tsv
    $health = Invoke-RestMethod "https://$fqdn/healthz" -TimeoutSec 60
    $runtime = Invoke-RestMethod "https://$fqdn/api/info" -TimeoutSec 60

    $runtime | Select-Object version, environment, appName, revision, replica
    if ($health.status -ne "ok" -or
        $runtime.environment -ne "azure-container-apps" -or
        $runtime.version -ne $appVersion -or
        $runtime.revision -ne $expectedRevision) {
        throw "The public endpoint has not served the expected healthy version and revision."
    }
    "Verified presentation: https://$fqdn/"
    "Verified image: $deployImage"
    "Verified revision: $expectedRevision"
}
```

浏览器再打开首页和 `#runtime`，点击“发送真实请求”。这一步检查网页交互，
不是把模拟 cloud lab 当作真实 ACA 扩缩容。
`/healthz`、`/api/info` 和返回字段属于本项目；其他公开 repo 必须换成自己的验证方式。

## 再发布、演示 v2、回退

| 场景 | 操作 |
| --- | --- |
| 修改 HTML、CSS、JS 或后端 | 先把代码推到公开 repo，再执行第 3～5 节；仅在本地改文件不会影响云端镜像 |
| 只演示版本变化 | 保留已构建的 `$imageTag`，设置 `$appVersion = "v2"`，再执行第 4～5 节 |
| 失败后重试 | 先查错误并处理原因；复用存在的 `$imageTag`，第 4 节会生成新的 suffix |
| 回到上次好版本 | 把 `$imageTag`、`$appVersion` 改为上次**验证成功**的值，再执行第 4～5 节 |

这里的回退是用旧镜像创建新 revision，适用于本指南只改镜像和 `APP_VERSION` 的情况；
若另外改过端口、secret、网络或其他配置，需要一起评估恢复。
不要把最新的失败 revision 或时间最近的镜像自动当作“上次好版本”，也不要急着删除旧镜像。

新开 Cloud Shell 后，先重做第 1～2 节恢复变量，再查询已有 tag：

```powershell
az acr repository show-tags --name $acr --repository $imageRepo --orderby time_desc --top 10 --output table
```

选择确切的已知 tag，设置 `$imageTag`、`$appVersion` 后从第 4 节继续，无需重新 clone/build。
在新会话核对一次已知部署时，还需把 `$expectedRevision` 设置为记录中的确切 revision。

## 常见问题与故障处理

| 现象 | 含义与处理 |
| --- | --- |
| `ContainerAppOperationInProgress` / `InProgress` | 仍有控制面操作进行中。停止重复写入，用下面的有超时等待；不要同时在 Portal 保存 |
| `Failed` | 操作已经失败，不是让你无限等。查看 Activity log 和系统日志，再处理原因、重新发布 |
| `already assigned` | UAMI 已挂载，不是失败原因，也不证明镜像拉取权限正确 |
| `NativeCommandExitException` | PowerShell 在报告 `az` 非零退出；真正原因在前面的 Azure 错误 |
| 找不到镜像 / manifest | 核对 registry、repository、image tag 和构建结果；新 suffix 不等于新镜像 tag |
| 拉取镜像鉴权失败 | 核对 registry identity、UAMI 关联、ACR 权限模式与对应角色、ARM audience、网络可达性 |
| API 仍返回旧 revision | 旧版本可能还在服务；检查新 revision 状态，不把旧版本的 200 当作上线成功 |
| GitHub FIC / Environment 未配置 | 本手动路径不使用它们；不要误删 Azure 的 ACA Environment |

`Failed` 本身不能证明 SAMI 不支持或 UAMI 配错；需要具体错误证据。
如果出现 `RequestDisallowedByPolicy`，查看被拒绝的配置并按组织允许的流程处理，
不要通过换身份、开密码等方式试图绕过明确的策略拒绝。

**只在操作仍进行中时等待**，每 10 秒查询，最多 10 分钟：

```powershell
az containerapp show --name $app --resource-group $rg --query properties.provisioningState --output tsv
az resource wait --ids $appId --updated --interval 10 --timeout 600
```

`--updated` 等的是 `provisioningState == Succeeded`，不会提交新部署。
如果已经 `Failed`，不要继续等这个条件；如果等待超时或成功后仍有相同冲突，
先停止写入，查看该 ACA 的 **Activity log** 及下面的只读诊断，保留错误中的 OperationId。
不要把 OperationId 和 Activity log 的 CorrelationId 当成必然相同的 ID。

```powershell
az containerapp revision list --name $app --resource-group $rg `
    --query "[].{revision:name,active:properties.active,health:properties.healthState,provisioning:properties.provisioningState}" --output table

az containerapp logs show --name $app --resource-group $rg --type system --tail 50 --format text

az monitor activity-log list --resource-id $appId --offset 1h --max-events 20 `
    --query "[].{time:eventTimestamp,operation:operationName.localizedValue,status:status.localizedValue,correlation:correlationId}" --output table
```

诊断表用于定位时间和操作，具体失败原因查看 Portal 的事件详情/JSON 及系统日志。
重试一次仍失败时，保留具体错误继续排查，不要循环重新部署或重建应用。

## 和仓库内 GitHub Actions 的区别

手动流程没有使用 `.github\workflows\deploy.yml`，也不需要配置 GitHub Environment 的 secrets。
现有工作流是另一条预留路径：GitHub 通过 UAMI + OIDC 登录，ACA 则按工作流要求用
**系统分配身份**拉取镜像。当前手动部署选择的是 **用户分配身份**拉取镜像，两者并未自动对齐。
恢复 Actions 前，需要同时核对它的身份信任、权限、运行时拉取身份和资源前置条件；
不能因为手动发布成功就认为 Actions 已可运行。

## 官方参考

- [Cloud Shell 临时会话](https://learn.microsoft.com/azure/cloud-shell/get-started/ephemeral)
- [ACR 云端构建](https://learn.microsoft.com/azure/container-registry/container-registry-quickstart-task-cli)
- [ACR 角色与权限](https://learn.microsoft.com/azure/container-registry/container-registry-rbac-built-in-roles-overview)
- [ABAC 模式与 Quick Build 的 caller identity](https://learn.microsoft.com/azure/container-registry/container-registry-rbac-abac-repository-permissions)
- [ACA 使用托管身份拉取镜像](https://learn.microsoft.com/azure/container-apps/managed-identity-image-pull)
- [ACA registry 命令](https://learn.microsoft.com/cli/azure/containerapp/registry)
- [ACA 更新命令](https://learn.microsoft.com/cli/azure/containerapp)
- [ACR 镜像与 tag 查询](https://learn.microsoft.com/cli/azure/acr/repository)
- [ACA revision](https://learn.microsoft.com/azure/container-apps/revisions)
- [资源状态等待](https://learn.microsoft.com/cli/azure/resource#az-resource-wait)
- [ACA 日志](https://learn.microsoft.com/cli/azure/containerapp/logs)
- [Activity log 查询](https://learn.microsoft.com/cli/azure/monitor/activity-log)
- [PowerShell 错误偏好](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_preference_variables)
- [PowerShell 作用域](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_scopes)
