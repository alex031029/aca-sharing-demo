# 这份 Presentation 不在 localhost

**访问网页：[打开 ACA 网站 ↗](https://yansh-sharing-demo.calmdune-96af11d5.eastus.azurecontainerapps.io/)**

> 当前部署状态（2026-11-04）：该地址暂时运行微软 .NET 示例，本仓库的 presentation 尚未部署。

一个 ASP.NET Core 10 应用，同时提供 HTML 讲义和真实运行信息 API。
运行服务只需要 .NET 10 SDK；Node.js 仅用于浏览器测试。

公开源码：[alex031029/aca-sharing-demo](https://github.com/alex031029/aca-sharing-demo)。
Cloud lab 中的扩缩容和分流是明确标注的解释模型；运行卡片使用真实后端响应。

## 本地运行

克隆仓库后，在仓库根目录执行：

```powershell
dotnet run --project .\aca-presentation
```

打开 `http://localhost:5080`。用左右方向键翻页，`Home` / `End` 跳转，
`F` 切换全屏。运行卡片只在点击时调用 API，不自动轮询。

| 路径 | 用途 |
| --- | --- |
| `/` | 七页 HTML 讲义，包括可交互的本地 cloud lab |
| `/api/info` | 版本、真实 ACA 元数据或本地主机、UTC 时间、uptime、request ID |
| `/healthz` | 健康检查 |

本地不会伪造 ACA revision/replica。`aca-presentation\wwwroot\index.html` 也可以直接打开，
作为离线讲义；需要保留同目录 CSS/JS 文件。离线模式不能调用 API。

### 本地演练版本变化

先请求一次 v1，保持浏览器打开。在终端停止服务，然后用相同端口重新启动：

```powershell
$env:APP_VERSION = "v2"
dotnet run --project .\aca-presentation
```

再次点击运行卡片，能看到 `v1 → v2`。这是后端环境变量变化，不是前端模拟；
本地重启不等同于 ACA revision 发布。浏览器保留讲义，不需要刷新整页。
恢复默认版本时，在启动服务前运行 `Remove-Item Env:\APP_VERSION`。

## 检查

以下是已附带的可选开发检查，不影响 POC 的启动。

```powershell
dotnet test .\Sharing.sln
Push-Location .\aca-presentation
npm ci
npx playwright install chromium --only-shell
npm run check
Pop-Location
```

集成测试覆盖 API 元数据、请求 ID、健康检查和非公开文件边界。
浏览器测试覆盖真实请求、版本变化、失败状态、离线讲义、翻页和手机宽度。
当前服务没有第三方 NuGet 运行时依赖；测试项目有独立测试依赖。

## 容器

Dockerfile 是多阶段 .NET 10 构建，最终镜像用非 root 用户监听 8080。
构建上下文是应用目录；`.dockerignore` 只允许发布所需文件进入镜像。

```powershell
docker build -t sharing-presentation:v1 .\aca-presentation
docker run --rm -p 8080:8080 -e APP_VERSION=v1 sharing-presentation:v1
```

打开 `http://localhost:8080`。无本地 Docker 时仍可运行 .NET 服务；
GitHub 工作流会执行 Linux 镜像构建和容器 smoke check。

## GitHub Actions 部署

工作流在仓库根目录 `.github\workflows\deploy.yml`，只接受手动触发。
它先检查 .NET、浏览器和 Linux 容器，再构建不可变镜像，部署并验证公网返回值。
只有 `main` 分支可以执行部署 job。工作流不会创建基础资源或隐式增加 Azure 权限。
当前使用 `azure/login@v3` 的 **UAMI + OIDC** 认证：
GitHub 用短期 OIDC token 换取专用 User-Assigned Managed Identity 的 Azure 访问令牌。
不需要 client secret、`AZURE_CREDENTIALS` 或开发者本机的 `az login` 会话。
GitHub-hosted runner 不能使用依赖 Azure VM 的 `auth-type: IDENTITY`；这里使用的是 OIDC。

### 首次使用前的准备

这是一条部署到**已有专用 demo 环境**的工作流，不会创建基础资源或权限。
首次部署前需要在选定的 Azure 订阅中准备：

1. 专用资源组、Azure Container Registry、ACA 环境和单容器 Container App。
2. Container App 使用 external ingress、target port `8080`、`Single` revision 模式。
3. Container App 开启 **System assigned identity**，为这个身份授予上述 ACR 的 `AcrPull`
   权限。工作流会自动配置 ACR 连接，使用该系统分配身份拉取镜像。
   使用启用了 ABAC 的 ACR 时，改用适用的 repository reader 角色。
4. GitHub 部署身份能更新该 app，并能推送到 ACR（传统 RBAC 模式为 `AcrPush`；
   ABAC 模式使用适用的 repository writer 角色）。还需要 ACR 管理面读取权限
   `Microsoft.ContainerRegistry/registries/read`，例如在 ACR 范围授予 `Reader`；
   如果已从资源组继承则无需重复授予。`AcrPush` 本身不包含此读取权限。
   不需要开启 ACR admin 密码。
5. 在 Azure Portal 的 **Managed Identities** 中创建 Sharing 专用的 UAMI，
   放到演示资源组中。记录它的 **Client ID**（不是 Object / Principal ID）。
   通过资源组 IAM 为该托管身份分配部署所需权限；独立演示资源组可使用仅限该组的
   `Contributor`，不要扩大到整个订阅，也不要复用其他业务的高权限身份。
6. 在该 UAMI 的 **Federated credentials → Add credential** 中配置信任。
   可以选择 **Other issuer** 手工填写，以免向导生成了与当前 GitHub token 不一致的 subject：

   | 字段 | 值 |
   | --- | --- |
   | Name | `github-sharing-aca` |
   | Issuer | `https://token.actions.githubusercontent.com` |
   | Audience | `api://AzureADTokenExchange` |
   | Subject identifier | 下方命令从实际仓库元数据生成的 subject |

   2026 年 7 月 15 日之后的新 GitHub.com 仓库默认使用包含不可变 ID 的 subject。
   本工作流绑定 `sharing-aca` Environment，所以 subject 的结尾是
   `environment:sharing-aca`，不是 `ref:refs/heads/main`。

   ```powershell
   $repo = gh api repos/alex031029/aca-sharing-demo | ConvertFrom-Json
   "repo:$($repo.owner.login)@$($repo.owner.id)/$($repo.name)@$($repo.id):environment:sharing-aca"
   ```

   对旧仓库、自定义 OIDC claims 或已重命名/转移的仓库，要核对实际签发的 subject。
   Issuer、audience、subject 必须精确匹配；不要使用通配符，也不要把完整身份令牌打印到日志。

在 GitHub 创建名为 `sharing-aca` 的 Environment，并配置：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret | `AZURE_CLIENT_ID` | 部署 UAMI 的 Client ID |
| Secret | `AZURE_TENANT_ID` | UAMI 所在 Directory (tenant) ID |
| Secret | `AZURE_SUBSCRIPTION_ID` | 目标 Azure subscription ID |
| Variable | `AZURE_RESOURCE_GROUP` | 专用 demo 资源组 |
| Variable | `AZURE_CONTAINER_APP` | 已有 Container App 名称 |
| Variable | `AZURE_ACR_NAME` | ACR 资源名称，不是带域名的 login server |

将该 Environment 的允许部署分支限制为 `main`。不要把 Azure 凭据、租户或订阅配置
写进公开源码；示例通过 Environment secrets / variables 接收部署配置。

三个 Secret 保存的是身份标识，不是密码；工作流不会读取 `AZURE_CREDENTIALS`。
部署 job 声明 `id-token: write` 来获取 GitHub OIDC token，这项权限本身不授予 Azure 权限。
GitHub 的 UAMI 负责推镜像和更新应用；ACA 自己的系统托管身份只负责拉镜像，两者不是同一身份。

在 Actions 中选择 **Deploy Sharing to ACA → Run workflow**，选择 `v1` 或 `v2`。
需要先将工作流提交并推送到 GitHub；首次手动触发通常需要该文件已存在于默认分支。
Fork 到其他账号时，需要配置自己的 UAMI、federated credential 和 GitHub Environment，
并重新获取实际 owner / repository ID；原仓库的信任关系不会自动复制。

镜像标签包含 commit SHA、run ID 和 attempt；revision suffix 包含 run ID 和 attempt。
v1/v2 是 API 展示的配置标签，不代表镜像内容必然不同。工作流验证**实际公网响应**
同时匹配版本标签和预期 revision，失败会明确报告，而不是只依赖 Azure 更新成功。

部署将设置 `0.25 vCPU / 0.5 GiB`、`minReplicas=1`、`maxReplicas=2`，用于稳定现场演示。
分享结束后按需调整副本或清理专用资源；ACR、日志等可能独立产生费用。
本项目不自动删除资源，也不假定 credit 可以支付任意 Marketplace 产品。

## 修改讲义

- `aca-presentation\wwwroot\index.html`：章节、文案和 demo 内容。
- `aca-presentation\wwwroot\styles.css`：桌面与手机布局。
- `aca-presentation\wwwroot\app.js`：翻页、真实请求、版本变化、错误展示。
- `aca-presentation\wwwroot\cloud-lab.js`：明确标注的本地扩缩容、冷启动和版本分流解释模型，不调用 Azure。
- `aca-presentation\Program.cs`：ASP.NET Core 服务和 API；只返回明确列出的运行元数据。
- `aca-presentation\tests\browser`：Playwright 测试；`aca-presentation.Tests`：.NET 集成测试。

公开讲义不应放入内部聊天、内部源码、订阅凭据或工作资料。当前页面仅包含通用技术内容。

## Cloud lab 演示顺序

1. 点击“突发流量”：观察目标容量、实际副本和请求积压，而不是瞬间出现全部容量。
2. 取消保留 warm replica，点击“让流量归零”，观察缩容冷却和最终缩到零。
3. 再给突发流量，观察模型中的冷启动与积压。保留 warm replica 再比较一次。
4. 右侧独立演示 10% canary、全部切换和流量回切；不声称请求样本来自 ACA。

每副本 6 req/s、最多 4 副本、3 秒冷启动等都是讲解用模型参数，
不是 ACA 默认值或性能承诺。模型有积压时至少保留一个副本，排空后才能缩到零。
实际 HTTP autoscaling 使用并发请求等指标，
multiple revision 模式下每个 revision 独立扩缩容。云平台并不让硬件限制消失，
而是将协调容量和版本的控制循环产品化。

## 官方参考

- [ACA 内置运行环境变量](https://learn.microsoft.com/azure/container-apps/environment-variables)
- [ACA revisions](https://learn.microsoft.com/azure/container-apps/revisions)
- [ACA 托管身份拉取镜像](https://learn.microsoft.com/azure/container-apps/managed-identity-image-pull)
- [Azure Login](https://github.com/Azure/login)
- [为 UAMI 配置 federated credential](https://learn.microsoft.com/entra/workload-id/workload-identity-federation-create-trust-user-assigned-managed-identity)
- [GitHub OIDC 不可变 subject](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims)
- [ACR RBAC 与 ABAC 角色](https://learn.microsoft.com/azure/container-registry/container-registry-rbac-built-in-roles-overview)
