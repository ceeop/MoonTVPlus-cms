# MoonTVPlus

<div align="center">
  <img src="public/logo.png" alt="MoonTVPlus Logo" width="120">
</div>

> 🎬 **MoonTVPlus** 是基于 [MoonTV v100](https://github.com/MoonTechLab/LunaTV) 二次开发的增强版影视聚合播放器。它在原版基础上新增了外部播放器支持、视频超分、弹幕系统、评论抓取等实用功能，提供更强大的观影体验。

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-14-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-4.x-3178c6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)
![Docker Ready](https://img.shields.io/badge/Docker-ready-blue?logo=docker)

</div>


---

## 🎉 相对原版新增内容

- 🎮 **外部播放器跳转**：支持 PotPlayer、VLC、MPV、MX Player、nPlayer、IINA 等多种外部播放器
- ✨ **视频超分 (Anime4K)**：使用 WebGPU 技术实现实时视频画质增强（支持 1.5x/2x/3x/4x 超分）
- 💬 **弹幕系统**：完整的弹幕搜索、匹配、加载功能，支持弹幕设置持久化、弹幕屏蔽
- 📝 **豆瓣评论抓取**：自动抓取并展示豆瓣电影短评，支持分页加载
- 🧩 **视频源脚本**：支持通过脚本自定义视频源、搜索、详情与播放解析逻辑（实验性）
- 🪒**自定义去广告**：你可以自定义你的去广告代码，实现更强力的去广告功能
- 🚀 **更快更顺滑**：相较原版项目整体速度更快，交互体验更好
- 🧲 **磁力搜索**：聚合 Mikan、Nyaa、ACG.RIP、动漫花园等站点搜索资源，可对种子做健康检查，并推送至 OpenList 离线下载。
- 📺 **WebTV**：专为电视大屏设计的操作界面，电视上扫码即可登录，手机浏览器还能化身虚拟遥控器。
- 📡 **追番订阅**：订阅番剧自动追更，自动识别字幕组与集数，更新后自动入库或下载，还可收到提醒通知。
- 🎞️ **外挂字幕**：支持加载本地字幕文件，ASS/SSA 特效字幕、PGS 图像字幕均可正确渲染显示。
- 🤖 **AI 问片**：全站 AI 影视助手，聊着天就能让它帮你找片、查片信息，也有 AI 生成的影片评论可看。
- 🔔 **消息通知**：站内通知中心统一查看各类消息，追番更新、求片处理结果等还可通过邮件或浏览器推送提醒。
- 🎭 **观影室**：支持多人同步观影、进度同步、屏幕共享、实时聊天、语音通话等功能。
- 📥 **M3U8完整下载**：支持浏览器内合并 m3u8 片段下载，也支持下载到本地文件夹并无感播放本地视频。
- 💾 **服务器离线下载**：支持在服务器端下载视频文件，支持断点续传，提前下载到家秒加载 。
- 📚 **私人影库**：接入 OpenList、Emby 或小雅，可打造专属私人影库，亦可观看网盘资源。

## ✨ 功能特性

- **本地片库与海报墙**：后台分批采集标准 CMS 源，支持本地搜索、分类筛选、作品归并和多源播放。配置方法见下文“本地片库”。
- 🔍 **多源聚合搜索**：一次搜索立刻返回全源结果。
- 📄 **丰富详情页**：支持剧集列表、演员、年份、简介等完整信息展示。
- ▶️ **流畅在线播放**：集成 HLS.js & ArtPlayer。
- ❤️ **收藏 + 继续观看**：支持 Kvrocks/Redis/Upstash 存储，多端同步进度。
- 📱 **PWA**：离线缓存、安装到桌面/主屏，移动端原生体验。
- 🌗 **响应式布局**：桌面侧边栏 + 移动底部导航，自适应各种屏幕尺寸。
- 👿 **智能去广告**：自动跳过视频中的切片广告，更可以自定义你的去广告代码以增强去广告功能。

### 注意：部署后项目为空壳项目，无内置播放源和直播源，需要自行收集

## 本地片库

本地片库默认关闭。管理员进入 **管理后台 → 本地片库**，选择标准 CMS 采集源和默认源，检查系统分类及各源分类绑定，设置更新间隔后即可启用，设置会自动保存。启用时至少选择一个源，并为至少一个已启用的系统分类绑定源分类。首次建议选择 2–3 个稳定源，查看收录情况后再扩大范围。采集范围为北京时间当天 0 点起更新的资源。点击“立即同步”会执行一批任务，后台调度继续处理当天更新的剩余页面。“重新采集当天”会从当天更新的第一页开始。

默认源从已选采集源中选择，首次自动使用第一个源。选择或切换默认源时会同步它的分类和层级，保留已有分类的编辑与其他源绑定；新增采集源也会读取分类并按名称匹配。后台优先采集默认源，并优先下载它的海报。同一作品的海报墙卡片和详情默认使用该源的海报、简介及播放资源；缺少该源资源时由其他可访问源补充。取消勾选默认源后，自动改用剩余的第一个源。

进入 **管理后台 → 分类管理**，或访问 `/admin/catalog-taxonomy`，可维护分类和源分类绑定，支持搜索、状态筛选与分页。未生成分类时可以点击“从默认源生成分类”，已有分类可点击“更新源分类”。分类可新增、改名、调整上级、停用或删除；删除后解除相关源分类绑定，子分类移至原上级，原本被停用的子分类会继续保持停用。所有已确定的编辑、启停与绑定更改都会自动保存，保存失败时保留当前修改并提供重试；删除后仍可撤销，更新源分类不会重新创建已删除分类。绑定下拉框只显示可用分类，名称相同的分类会自动匹配，未匹配的分类默认为“不采集”。

采集范围与分类启停分开设置：“本地片库”只显示可用分类的勾选列表，取消采集不会停用分类。父分类勾选框可批量选择子分类；停用父分类会暂停整个分支。分类管理和采集范围分别自动保存，采集页保存时不会覆盖管理页更新过的名称或绑定。

保存后，片库搜索、海报墙、详情和在线补搜入库统一使用所选分类与绑定。前台只显示当前账号可访问且已有未过期资源的分类，未采集的空分类自动隐藏。改名立即生效，变更采集范围或映射后会自动重新采集当天更新；停用或删除全部分类后暂停采集，仍继续定期清理过期数据。

启用后，首页展示已收录影片的海报墙，也可以访问 `/catalog`。支持电影、电视剧、动漫、综艺分类，以及年份、地区和片名筛选。相同作品的多个源归并展示，详情页可以选择源和剧集；播放继续使用原来的源标识和影片 ID，兼容收藏与播放记录。片库查询时会归并完整片名、年份相同且类型兼容的记录，包括缺少豆瓣 ID 的资源。「第二季」「第2季」「第02季」等写法，以及核实过的片名别写，归为同一作品。片名里的不可见空格也会忽略。类型不明的记录可以归入唯一的已知类型，同一作品的可信豆瓣 ID 也可用于处理来源分类不一致的情况；有冲突的有效 ID 分开显示。已收录的资源会自动应用这些规则，使用已知占位 ID 错绑的记录也会重新归入各自的作品。海报会分批下载并保存在片库数据库，默认随 SQLite 保存在本地 `.data/moontv.db`；页面通过本站图片接口读取，队列尚未处理到的图片会在首次访问时下载保存，已有远程海报也会分批转存。相同图片地址复用一份数据；单张图片最大 1 MiB，只接受 JPEG、PNG、GIF、WebP、AVIF，失败后自动重试，期间显示占位图。

普通搜索和流式搜索默认查询片库，未收录的影片可以点击“在线补搜”；私人影库专用搜索保留现有方式。在线补搜、详情补取和手动刷新获得的标准源资源，会写入已启用采集的源。带时效的地址失效时，可在作品详情点击“刷新线路”，或在播放失败提示中点击“刷新播放地址”。当前片库面向具有直接媒体地址的标准 CMS 源，脚本源和需要网页解析的源继续通过在线搜索使用。

### 数据库存储

- SQLite/D1、PostgreSQL、Turso 部署复用当前 SQL 数据库；片库表首次使用时自动建立。
- Redis、Kvrocks、Upstash 配合常驻 Node 服务时，片库使用本地 SQLite，用户数据继续存放在原有数据库。
- SQLite 默认路径为 `.data/moontv.db`，可使用 `SQLITE_DB_PATH` 指定。Docker 需持久挂载 `/app/.data`。备份时应备份完整数据库，而非仅导出用户配置。
- 海报与片库元数据使用同一持久数据库；PostgreSQL、Turso、D1 部署也保存在对应数据库，不依赖临时文件系统。
- Vercel、Netlify、EdgeOne 等无持久本地磁盘的平台，需要使用 PostgreSQL 或 Turso；Cloudflare 使用 D1 或 Turso。片库不会写入临时磁盘冒充持久存储。

### 后台采集

使用 `node server.js` 或项目默认 Docker 启动方式时，服务每 15 秒检查一次任务。首次启用和后续每轮均采集北京时间当天更新的数据，完成后按后台设置的间隔从第 1 页重新检查更新。每批最多处理 3 页，保存当天进度和数据库任务锁，失败后等待重试；跨天自动从新一天的第 1 页开始。采集接口使用 `ac=videolist`、`pg` 和 `h` 更新窗口，按 `vod_time` 校验当天范围。源站更新列表应按更新时间从新到旧排列；遇到整页较早数据时结束本轮，缺少有效更新时间时显示错误并等待重试。

定时清理默认开启，每天执行一次。保留时长默认 **6 个自然月**，可在后台设置为 1–120 个月，按最近入库或更新的 `indexed_at` 计算。关闭开关后暂停自动清理，也可点击“立即清理”按当前保留时长手动执行。清理会同时移除无资源的作品、搜索索引和无引用海报。

Cloudflare 已增加每 5 分钟的片库调度，需设置一个非空的 `CRON_PASSWORD`。其他无常驻进程的平台，请用平台定时任务或外部调度器每 1–5 分钟调用：

```text
GET https://你的站点/api/cron/<CRON_PASSWORD>/catalog
```

该接口会等待本批任务结束再返回。不要在公开页面暴露此 URL 或密码。片库更新间隔决定内容的新鲜度，视频缓冲速度仍取决于视频源与播放网络。

<details>
  <summary>点击查看项目截图</summary>
  <img src="public/screenshot1.png" alt="项目截图" style="max-width:600px">
  <img src="public/screenshot2.png" alt="项目截图" style="max-width:600px">
  <img src="public/screenshot3.png" alt="项目截图" style="max-width:600px">
</details>


### 请不要在 B站、小红书、微信公众号、抖音、今日头条或其他中国大陆社交平台发布视频或文章宣传本项目，不授权任何“科技周刊/月刊”类项目或站点收录本项目。

## 🗺 目录

- [技术栈](#技术栈)
- [部署](#部署)
- [配置文件](#配置文件)
- [自动更新](#自动更新)
- [环境变量](#环境变量)
- [外部观影室服务器部署](#外部观影室服务器部署)
- [弹幕后端部署](#弹幕后端部署)
- [超分功能说明](#超分功能说明)
- [AndroidTV 使用](#androidtv-使用)
- [TVBOX 订阅功能](#tvbox-订阅功能)
- [安全与隐私提醒](#安全与隐私提醒)
- [License](#license)
- [致谢](#致谢)



## 技术栈

| 分类      | 主要依赖                                                     |
| --------- | ------------------------------------------------------------ |
| 前端框架  | [Next.js 14](https://nextjs.org/) · App Router               |
| UI & 样式 | [Tailwind&nbsp;CSS 3](https://tailwindcss.com/)              |
| 语言      | TypeScript 4                                                 |
| 播放器    | [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) · [HLS.js](https://github.com/video-dev/hls.js/) |
| 代码质量  | ESLint · Prettier · Jest                                     |
| 部署      | Docker · Vercel · Netlify · Cloudflare Workers · EdgeOne Pages |

## 部署

本项目**支持 Docker、Vercel、Netlify、Cloudflare Workers 和 EdgeOne Pages 平台** 部署。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/mtvpls/MoonTVPlus)

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/mtvpls/MoonTVPlus)

**一键部署到 Zeabur**

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/SCHCAY/deploy)

**一键部署到 Render**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/mtvpls/MoonTVPlus)



### Cloudflare Workers 部署（通过 GitHub Actions）

Cloudflare Workers 提供免费的边缘计算服务，通过 GitHub Actions 可以实现自动化部署。

#### 前置要求

1. 一个 Cloudflare 账号
2. Fork 本项目到你的 GitHub 账号
3. 准备一个 Upstash Redis 实例（推荐）

#### 配置步骤

**1. 获取 Cloudflare API Token 和 Account ID**

- 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/)
- 点击右上角头像 > My Profile > API Tokens
- 点击 "Create Token"，选择 "Edit Cloudflare Workers" 模板
- 或使用自定义 Token，需要以下权限：
  - Account - Cloudflare Workers Scripts - Edit
  - Account - D1 - Edit（仅在使用 D1 数据库时需要）
- 创建后复制生成的 API Token
- 在 Dashboard 首页右侧可以看到你的 Account ID

**2. 配置 GitHub Secrets**

进入你 Fork 的仓库，点击 Settings > Secrets and variables > Actions > New repository secret，添加以下必需的 Secrets：

**必需配置：**

| Secret 名称                | 说明                  | 示例值                   |
| -------------------------- | --------------------- | ------------------------ |
| `CLOUDFLARE_API_TOKEN`     | Cloudflare API Token  | `your_api_token_here`    |
| `CLOUDFLARE_ACCOUNT_ID`    | Cloudflare Account ID | `abc123def456`           |
| `USERNAME`                 | 站长账号              | `admin`                  |
| `PASSWORD`                 | 站长密码              | `your_secure_password`   |
| `NEXT_PUBLIC_STORAGE_TYPE` | 存储类型              | `upstash`                |
| `UPSTASH_URL`              | Upstash Redis URL     | `https://xxx.upstash.io` |
| `UPSTASH_TOKEN`            | Upstash Redis Token   | `your_upstash_token`     |

**3. 触发部署**

配置完成后，有两种方式触发部署：

**方式一：手动触发**

- 进入仓库的 Actions 页面
- 选择 "Deploy to Cloudflare" workflow
- 点击 "Run workflow" 按钮
- 选择分支（通常是 main 或 dev）
- 点击 "Run workflow" 开始部署

**方式二：自动触发（可选）**

如果想要在推送代码时自动部署，可以修改 `.github/workflows/cloudflare-deploy.yml` 文件：

```yaml
on:
  push:
    branches:
      - main  # 或你的主分支名称
  workflow_dispatch:
```

**4. 查看部署状态**

- 在 Actions 页面可以看到部署进度
- 部署成功后，访问 `https://your-project-name.your-account.workers.dev`
- 也可以在 Cloudflare Dashboard 的 Workers & Pages 中查看部署的应用

**5. 绑定自定义域名（可选）**

- 在 Cloudflare Dashboard 中进入你的 Worker
- 点击 Settings > Triggers > Custom Domains
- 添加你的自定义域名

**6. 使用 D1 数据库（可选）**

如果想使用 Cloudflare D1 数据库代替 Upstash Redis，需要进行以下配置：

1. 在 Cloudflare Dashboard 中创建一个 D1 数据库
2. 复制数据库 ID
3. 在 GitHub Secrets 中配置：
   - 将 `NEXT_PUBLIC_STORAGE_TYPE` 设置为 `d1`
   - 添加 `D1_DATABASE_ID` 并填入你的数据库 ID
   - 无需配置 `UPSTASH_URL` 和 `UPSTASH_TOKEN`

**7. 自定义 Wrangler 变量（可选）**

可通过 `VARS`（Repository secret 或 variable）把自定义变量写入 `wrangler.toml` 的 `[vars]`，每行一个 `KEY=VALUE`：

```
ENABLE_TVBOX_SUBSCRIBE=true
FOO=bar
```

部署后会追加到 `[vars]`：

```toml
ENABLE_TVBOX_SUBSCRIBE = "true"
FOO = "bar"
```

---

### EdgeOne Pages 部署（通过 GitHub Actions）

EdgeOne Pages/Makers 支持通过 API Token 在 GitHub Actions 中自动构建并部署，本项目已内置 `.github/workflows/edgeone-deploy.yml`。

#### 前置要求

1. 一个腾讯云 EdgeOne 账号
2. Fork 本项目到你的 GitHub 账号
3. 准备一个 Turso 数据库实例（推荐，免费 SQLite 云数据库）或 Upstash Redis 实例
4. 准备 EdgeOne API Token

#### 配置步骤

**1. 获取 EdgeOne API Token**

- 进入 EdgeOne Pages/Makers 控制台
- 在账号或 API Token 相关页面创建用于 CI/CD 的 Token
- 复制生成的 Token，后续填入 GitHub Secrets

**2. 配置 GitHub Secrets**

进入你 Fork 的仓库，点击 Settings > Secrets and variables > Actions > New repository secret，添加以下必需的 Secrets：

| Secret 名称                | 说明                | 示例值                   |
| -------------------------- | ------------------- | ------------------------ |
| `EDGEONE_API_TOKEN`        | EdgeOne API Token   | `your_edgeone_token`     |
| `USERNAME`                 | 站长账号            | `admin`                  |
| `PASSWORD`                 | 站长密码            | `your_secure_password`   |
| `NEXT_PUBLIC_STORAGE_TYPE` | 存储类型            | `turso` 或 `upstash`     |

**使用 Turso（推荐）：**

在 [Turso](https://turso.tech/) 注册账号并创建数据库，然后运行 `pnpm init:turso` 初始化表结构（需设置 TURSO_URL 和 TURSO_TOKEN 环境变量）。

| Secret 名称                | 说明                | 示例值                            |
| -------------------------- | ------------------- | --------------------------------- |
| `TURSO_URL`                | Turso 数据库 URL    | `libsql://your-db.turso.io`       |
| `TURSO_TOKEN`              | Turso 访问令牌      | `your_turso_token`                |

**使用 Upstash Redis：**

| Secret 名称                | 说明                | 示例值                   |
| -------------------------- | ------------------- | ------------------------ |
| `UPSTASH_URL`              | Upstash Redis URL   | `https://xxx.upstash.io` |
| `UPSTASH_TOKEN`            | Upstash Redis Token | `your_upstash_token`     |

其他可选环境变量可按需继续添加到 GitHub Secrets，工作流会自动同步已配置且非空的变量到 EdgeOne 项目环境变量中。

**3. 触发部署**

- 进入仓库的 Actions 页面
- 选择 "Deploy to EdgeOne" workflow
- 点击 "Run workflow"
- `project_name` 默认为 `moontvplus`
- `area` 默认为 `overseas`，即全球可用区（不含中国大陆）；如需全球可用区可选择 `global`
- `sync_environment` 默认开启，会在部署后同步环境变量并再次部署以确保新建项目也能读取环境变量


---

### Docker 部署

#### Kvrocks 存储（推荐）

```yml
services:
  moontv-core:
    image: ghcr.io/mtvpls/moontvplus:latest
    container_name: moontv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=kvrocks
      - KVROCKS_URL=redis://moontv-kvrocks:6666
    networks:
      - moontv-network
    depends_on:
      - moontv-kvrocks
  moontv-kvrocks:
    image: apache/kvrocks
    container_name: moontv-kvrocks
    restart: unless-stopped
    volumes:
      - kvrocks-data:/var/lib/kvrocks/db
    networks:
      - moontv-network
networks:
  moontv-network:
    driver: bridge
volumes:
  kvrocks-data:
```
（若指定kvrocks-data目录，需要将所挂载的数据目录权限调整为777否则会导致创建数据库失败）

### PostgreSQL 存储

支持标准 PostgreSQL 数据库。将下面的配置填入 `.env.local`，或设置为运行环境变量：

```dotenv
NEXT_PUBLIC_STORAGE_TYPE=postgres
DATABASE_URL=postgresql://数据库用户:数据库密码@数据库地址:5432/数据库名称
USERNAME=admin
PASSWORD=你的管理员密码
```

连接字符串也可以使用 `POSTGRES_URL`；两者同时配置时优先使用 `DATABASE_URL`。需要 TLS 时，请在连接字符串中使用数据库服务提供的 TLS 参数。密码中的特殊字符需要进行 URL 编码。可参考 [配置示例](.env.postgres.example)。

数据库本身需要预先存在，连接用户需要具有建表权限。使用 `pnpm dev`、`pnpm start` 或完整 Docker 镜像启动时，项目会自动执行建表和升级脚本，并创建管理员账号。已有账号不会被覆盖。使用其他启动方式前，先手动初始化：

```bash
pnpm init:postgres
```

用户、收藏、播放记录、配置以及片库均使用 PostgreSQL 存储；片库表会在首次使用时自动创建。可通过 `POSTGRES_POOL_MAX` 调整每个应用进程的连接池上限，默认 `10`。该连接方式用于 Node.js 运行环境。

### SQLite 存储

```yml
services:
  moontv-core:
    image: ghcr.io/mtvpls/moontvplus:latest
    container_name: moontv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=d1
      - SQLITE_DB_PATH=/app/.data/moontv.db
    volumes:
      - ./data:/app/.data
```


### Redis 存储（有一定的丢数据风险）

```yml
services:
  moontv-core:
    image: ghcr.io/mtvpls/moontvplus:latest
    container_name: moontv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=redis
      - REDIS_URL=redis://moontv-redis:6379
    networks:
      - moontv-network
    depends_on:
      - moontv-redis
  moontv-redis:
    image: redis:alpine
    container_name: moontv-redis
    restart: unless-stopped
    networks:
      - moontv-network
    # 请开启持久化，否则升级/重启后数据丢失
    volumes:
      - ./data:/data
networks:
  moontv-network:
    driver: bridge
```

### Upstash 存储

1. 在 [upstash](https://upstash.com/) 注册账号并新建一个 Redis 实例，名称任意。
2. 复制新数据库的 **HTTPS ENDPOINT 和 TOKEN**
3. 使用如下 docker compose

```yml
services:
  moontv-core:
    image: ghcr.io/mtvpls/moontvplus:latest
    container_name: moontv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=upstash
      - UPSTASH_URL=上面 https 开头的 HTTPS ENDPOINT
      - UPSTASH_TOKEN=上面的 TOKEN
```

#### Lite 镜像说明

`ghcr.io/mtvpls/moontvplus-lite:latest` 为更小的镜像，但不支持启动内置观影室服务，也不支持 SQLite（`NEXT_PUBLIC_STORAGE_TYPE=d1`）自动初始化方案。

示例：

```yml
services:
  moontv-core:
    image: ghcr.io/mtvpls/moontvplus-lite:latest
    container_name: moontv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=kvrocks
      - KVROCKS_URL=redis://moontv-kvrocks:6666
    networks:
      - moontv-network
    depends_on:
      - moontv-kvrocks
  moontv-kvrocks:
    image: apache/kvrocks
    container_name: moontv-kvrocks
    restart: unless-stopped
    volumes:
      - kvrocks-data:/var/lib/kvrocks/db
    networks:
      - moontv-network
networks:
  moontv-network:
    driver: bridge
volumes:
  kvrocks-data:
```
（若指定kvrocks-data目录，需要将所挂载的数据目录权限调整为777否则会导致创建数据库失败）

> **指定运行 UID/GID**：容器默认以 `1001:1001`（`nextjs` 用户）运行。可通过 `PUID` / `PGID` 环境变量指定容器进程运行时使用的用户/组 ID。挂载宿主机目录时建议将其设为宿主机目录的属主 UID/GID，容器启动时会自动调整进程属主并修正 `/data`、`/app/.data` 等数据目录的属主，避免权限问题。

## 配置文件

完成部署后为空壳应用，无播放源，需要站长在管理后台的配置文件设置中填写配置文件，本版本已不支持无数据库运行。

配置文件示例如下：

```json
{
  "cache_time": 7200,
  "api_site": {
    "dyttzy": {
      "api": "http://xxx.com/api.php/provide/vod",
      "name": "示例资源",
      "detail": "http://xxx.com"
    }
    // ...更多站点
  },
  "custom_category": [
    {
      "name": "华语",
      "type": "movie",
      "query": "华语"
    }
  ]
}
```

- `cache_time`：接口缓存时间（秒）。
- `api_site`：你可以增删或替换任何资源站，字段说明：
  - `key`：唯一标识，保持小写字母/数字。
  - `api`：资源站提供的 `vod` JSON API 根地址。
  - `name`：在人机界面中展示的名称。
  - `detail`：（可选）部分无法通过 API 获取剧集详情的站点，需要提供网页详情根 URL，用于爬取。
- `custom_category`：自定义分类配置，用于在导航中添加个性化的影视分类。以 type + query 作为唯一标识。支持以下字段：
  - `name`：分类显示名称（可选，如不提供则使用 query 作为显示名）
  - `type`：分类类型，支持 `movie`（电影）或 `tv`（电视剧）
  - `query`：搜索关键词，用于在豆瓣 API 中搜索相关内容

custom_category 支持的自定义分类已知如下：

- movie：热门、最新、经典、豆瓣高分、冷门佳片、华语、欧美、韩国、日本、动作、喜剧、爱情、科幻、悬疑、恐怖、治愈
- tv：热门、美剧、英剧、韩剧、日剧、国产剧、港剧、日本动画、综艺、纪录片

也可输入如 "哈利波特" 效果等同于豆瓣搜索

MoonTV 支持标准的苹果 CMS V10 API 格式。

## 自动更新

可借助 [watchtower](https://github.com/containrrr/watchtower) 自动更新镜像容器

dockge/komodo 等 docker compose UI 也有自动更新功能

## 环境变量

| 变量                                     | 说明                                                         | 可选值                      | 默认值                                                       |
| ---------------------------------------- | ------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------ |
| USERNAME                                 | 站长账号                                                     | 任意字符串                  | 无默认，必填字段                                             |
| PASSWORD                                 | 站长密码                                                     | 任意字符串                  | 无默认，必填字段                                             |
| CRON_PASSWORD                            | 定时任务 API 访问密码（用于保护 /api/cron 端点）             | 任意字符串                  | mtvpls                                                       |
| CRON_WAIT_FOR_COMPLETION                 | 定时任务接口是否等待任务完全结束后再返回响应（true 时返回 200，false 时立即返回 202）。部署在 serverless 平台（如 Vercel）时建议设置为 true，否则响应返回后异步执行可能会被平台杀后台导致任务中断 | true/false                  | false                                                        |
| CRON_USER_BATCH_SIZE                     | 定时任务用户批处理大小（控制并发处理的用户数量，影响播放记录和收藏更新任务的并发性能） | 正整数                      | 3                                                            |
| SITE_BASE                                | 站点 url                                                     | 形如 https://example.com    | 空                                                           |
| NEXT_PUBLIC_SITE_NAME                    | 站点名称                                                     | 任意字符串                  | MoonTV                                                       |
| ANNOUNCEMENT                             | 站点公告                                                     | 任意字符串                  | 本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。 |
| ANNOUNCEMENT_DISPLAY_MODE                | 公告显示模式                                                 | once、every                 | once                                                        |
| NEXT_PUBLIC_STORAGE_TYPE                 | 播放记录/收藏的存储方式                                      | redis、kvrocks、upstash、d1、turso、postgres | 无默认，必填字段                                             |
| DATABASE_URL                            | PostgreSQL 连接字符串（postgres 模式）                        | postgresql://user:password@host:5432/dbname | 空                                                     |
| POSTGRES_URL                            | PostgreSQL 连接字符串，兼容原有配置                           | 同 DATABASE_URL，优先级低于 DATABASE_URL | 空                                                      |
| POSTGRES_POOL_MAX                       | 每个应用进程的 PostgreSQL 最大连接数                         | 正整数                      | 10                                                           |
| KVROCKS_URL                              | kvrocks 连接 url                                             | 连接 url                    | 空                                                           |
| REDIS_URL                                | redis 连接 url                                               | 连接 url                    | 空                                                           |
| UPSTASH_URL                              | upstash redis 连接 url                                       | 连接 url                    | 空                                                           |
| UPSTASH_TOKEN                            | upstash redis 连接 token                                     | 连接 token                  | 空                                                           |
| TURSO_URL                                | Turso (libSQL) 数据库连接 url                                | libsql://xxx.turso.io       | 空                                                           |
| TURSO_TOKEN                              | Turso (libSQL) 数据库访问令牌                                | 访问令牌                    | 空                                                           |
| NEXT_PUBLIC_SEARCH_MAX_PAGE              | 搜索接口可拉取的最大页数                                     | 1-50                        | 5                                                            |
| NEXT_PUBLIC_DOUBAN_PROXY_TYPE            | 豆瓣数据源请求方式                                           | 见下方                      | direct                                                       |
| NEXT_PUBLIC_DOUBAN_PROXY                 | 自定义豆瓣数据代理 URL                                       | url prefix                  | (空)                                                         |
| NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE      | 豆瓣图片代理类型                                             | 见下方                      | direct                                                       |
| NEXT_PUBLIC_DOUBAN_IMAGE_PROXY           | 自定义豆瓣图片代理 URL                                       | url prefix                  | (空)                                                         |
| NEXT_PUBLIC_DISABLE_YELLOW_FILTER        | 关闭色情内容过滤                                             | true/false                  | false                                                        |
| NEXT_PUBLIC_FLUID_SEARCH                 | 是否开启搜索接口流式输出                                     | true/ false                 | true                                                         |
| NEXT_PUBLIC_PROXY_M3U8_TOKEN             | M3U8 代理 API 鉴权 Token（外部播放器跳转时的鉴权token，不填为无鉴权） | 任意字符串                  | (空)                                                         |
| NEXT_PUBLIC_DANMAKU_CACHE_EXPIRE_MINUTES | 弹幕缓存失效时间（分钟数，设为 0 时不缓存）                  | 0 或正整数                  | 4320（3天）                                                  |
| ENABLE_TV_MODE                           | 是否启用 TV 模式；设为 false 后 /tv 不可访问，且不启动电视遥控 Socket.IO 监听 | true/false                  | true                                                         |
| ENABLE_TVBOX_SUBSCRIBE                   | 是否启用 TVBOX 订阅功能                                      | true/false                  | false                                                        |
| TVBOX_SUBSCRIBE_TOKEN                    | TVBOX 订阅 API 访问 Token，如启用TVBOX功能必须设置该项       | 任意字符串                  | (空)                                                         |
| TVBOX_BLOCKED_SOURCES                    | TVBOX 订阅屏蔽源列表（多个源用逗号分隔，匹配视频源的 key）   | 逗号分隔的源 key            | (空)                                                         |
| WATCH_ROOM_ENABLED                       | 是否启用观影室功能（vercel部署不支持该功能，可使用外部服务器） | true/false                  | false                                                        |
| WATCH_ROOM_SERVER_TYPE                   | 观影室服务器类型                                             | internal/external           | internal                                                     |
| WATCH_ROOM_EXTERNAL_SERVER_URL           | 外部观影室服务器地址（当 SERVER_TYPE 为 external 时必填）    | WebSocket URL               | (空)                                                         |
| WATCH_ROOM_EXTERNAL_SERVER_AUTH          | 外部观影室服务器认证令牌（当 SERVER_TYPE 为 external 时必填） | 任意字符串                  | (空)                                                         |
| WATCH_ROOM_EXTERNAL_APP_ID               | 外部观影室应用隔离 ID（多个应用共用同一外部服务器时隔离房间，建议使用随机长字符串） | 任意字符串 | (空) |
| NEXT_PUBLIC_VOICE_CHAT_STRATEGY          | 观影室语音聊天策略                                           | webrtc-fallback/server-only | webrtc-fallback                                              |
| NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD      | 是否启用服务器离线下载功能（开启后也仅管理员和站长可用）     | true/false                  | false                                                        |
| OFFLINE_DOWNLOAD_DIR                     | 离线下载文件存储目录                                         | 任意有效路径                | /data                                                        |
| OFFLINE_DOWNLOAD_PROXY                   | 离线下载代理                                                 | http://host:port         | (空)                                                         |
| VIDEOINFO_CACHE_MINUTES                  | 私人影库视频信息在内存中的缓存时长（分钟）                   | 正整数                      | 1440（1天）                                                  |
| NEXT_PUBLIC_ENABLE_SOURCE_SEARCH         | 是否开启源站寻片功能                                         | true/false                  | true                                                         |
| MAX_PLAY_RECORDS_PER_USER                | 单个用户播放记录清理阈值（超过此数量将自动清理旧记录）       | 正整数                      | 100                                                          |
| MAX_MANGA_HISTORY_PER_USER              | 单个用户漫画阅读历史保留上限 | 正整数                      | 100                                                          |
| MAGNET_HEALTH_MAX_CONCURRENT             | 动漫磁力测活全站同时进行的最大任务数（进程内）               | 1-100                       | 10                                                           |
| INIT_CONFIG                              | 初始配置（JSON 格式，包含 api_site、custom_category、lives 等） | JSON 字符串                 | (空)                                                         |
| CONFIG_SUBSCRIPTION_URL                  | 配置订阅 URL（Base58 编码的配置文件地址，优先级高于 INIT_CONFIG） | URL                         | (空)                                                         |
| CONFIG_SUBSCRIPTION_PROXY                | 拉取配置代理（拉取配置订阅时使用的 HTTP 代理）               | URL                         | (空)                                                         |
| TMDB_API_KEY                             | TMDB API 密钥                                                | 任意字符串                  | (空)                                                         |
| TMDB_PROXY                               | TMDB 代理地址                                                | URL                         | (空)                                                         |
| TMDB_REVERSE_PROXY                       | TMDB 反向代理地址                                            | URL                         | (空)                                                         |
| DANMAKU_API_BASE                         | 弹幕 API 地址                                                | URL                         | http://localhost:9321                                        |
| DANMAKU_API_TOKEN                        | 弹幕 API Token                                               | 任意字符串                  | 87654321                                                     |
| DATA_MIGRATION_CHUNK_SIZE                | 数据迁移批处理大小（控制导入导出时每批处理的用户数量和数据条数） | 正整数                      | 10                                                           |
| QR_LOGIN_STORE_MODE                      | 电视端扫码登录状态存储模式；serverless环境下多节点内存状态不可靠。 | auto、memory、hybrid、shared | auto                                                         |
| WEB_PUSH_PROXY                           | Web Push 服务端发送代理地址，用于服务器访问 FCM 等 Push endpoint | HTTP/HTTPS 代理 URL          | (空)                                                         |
| WEB_PUSH_BASEURL                         | Web Push endpoint 反向代理 Base URL；支持 `{endpoint}`（URL编码）和 `{raw_endpoint}`（不编码）占位符 | URL                         | (空)                                                         |
| TELEGRAM_BOT_TOKEN                       | Telegram Bot Token，用于 Bot 登录、绑定和通知推送             | BotFather 生成的 token       | (空)                                                         |
| TELEGRAM_BOT_USERNAME                    | Telegram Bot 用户名（不含或包含 @ 均可）                      | bot username                | (空)                                                         |
| TELEGRAM_WEBHOOK_SECRET                  | Telegram Webhook Secret；Webhook 路径为 `/api/telegram/webhook/<secret>` | 随机长字符串                | (空)                                                         |
| TELEGRAM_API_PROXY                       | Telegram Bot API 系统代理（Node 部署可用，Cloudflare/Edge 会忽略） | HTTP/HTTPS 代理 URL         | (空)                                                         |
| TELEGRAM_API_BASE_URL                    | Telegram Bot API 反代 Base URL，用于替换 `https://api.telegram.org` | URL                         | (空)                                                         |
| TELEGRAM_LOGIN_ENABLED                   | 是否启用 Telegram 快捷登录                                    | true/false                  | true                                                         |
| TELEGRAM_BINDING_ENABLED                 | 是否启用 Telegram 账号绑定                                    | true/false                  | true                                                         |
| TELEGRAM_NOTIFICATIONS_ENABLED           | 是否启用 Telegram 通知推送                                    | true/false                  | true                                                         |
| TELEGRAM_DEFAULT_NOTIFICATIONS           | 新绑定 Telegram 用户是否默认开启通知                          | true/false                  | true                                                         |


### Telegram Bot 配置

1. 在 Telegram 通过 BotFather 创建 Bot，获取 `TELEGRAM_BOT_TOKEN` 和 Bot 用户名。
2. 设置 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_BOT_USERNAME`、`TELEGRAM_WEBHOOK_SECRET` 并重启服务。
3. 如服务器无法直连 Telegram，可选填 `TELEGRAM_API_PROXY`（系统代理）或 `TELEGRAM_API_BASE_URL`（反代 Base URL）。
4. 可在后台 Telegram Bot 配置页点击“一键设置 Webhook”，或手动将 Webhook 设置到：`https://你的域名/api/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>`。

可使用以下命令设置 Webhook：

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"   -d "url=https://你的域名/api/telegram/webhook/$TELEGRAM_WEBHOOK_SECRET"   -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

用户登录后可在“通知设置”中生成绑定码，也可在注册成功页直接绑定；绑定后可接收站内通知并使用 Telegram 确认登录。

NEXT_PUBLIC_DOUBAN_PROXY_TYPE 选项解释：

- direct: 由服务器直接请求豆瓣源站
- cors-proxy-zwei: 浏览器向 cors proxy 请求豆瓣数据，该 cors proxy 由 [Zwei](https://github.com/bestzwei) 搭建
- cmliussss-cdn-tencent: 浏览器向豆瓣 CDN 请求数据，该 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，并由腾讯云 cdn 提供加速
- cmliussss-cdn-ali: 浏览器向豆瓣 CDN 请求数据，该 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，并由阿里云 cdn 提供加速
- custom: 用户自定义 proxy，由 NEXT_PUBLIC_DOUBAN_PROXY 定义

NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE 选项解释：

- direct：由浏览器直接请求豆瓣分配的默认图片域名
- server：由服务器代理请求豆瓣分配的默认图片域名
- img3：由浏览器请求豆瓣官方的精品 cdn（阿里云）
- cmliussss-cdn-tencent：由浏览器请求豆瓣 CDN，该 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，并由腾讯云 cdn 提供加速
- cmliussss-cdn-ali：由浏览器请求豆瓣 CDN，该 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，并由阿里云 cdn 提供加速
- custom: 用户自定义 proxy，由 NEXT_PUBLIC_DOUBAN_IMAGE_PROXY 定义

NEXT_PUBLIC_VOICE_CHAT_STRATEGY 选项解释：

- webrtc-fallback：使用 WebRTC P2P 连接，失败时自动回退到服务器中转（推荐）
- server-only：仅使用服务器中转（适用于无法建立 P2P 连接的网络环境）

### 外部观影室服务器部署

如果您在 Vercel 等无法运行 WebSocket 服务器的平台部署，或希望将观影室服务器独立部署，可以使用外部观影室服务器。

推荐使用由 [tgs9915](https://github.com/tgs9915) 开发的 [watch-room-server](https://github.com/tgs9915/watch-room-server) 项目进行部署。

**配置步骤：**

1. 按照 [watch-room-server](https://github.com/tgs9915/watch-room-server) 的文档部署外部服务器

2. 在 MoonTVPlus 中设置以下环境变量：

   ```env
   WATCH_ROOM_ENABLED=true
   WATCH_ROOM_SERVER_TYPE=external
   WATCH_ROOM_EXTERNAL_SERVER_URL=wss://your-watch-room-server.com
   WATCH_ROOM_EXTERNAL_SERVER_AUTH=your_secure_token
   ```

3. （可选）如果多个应用共用同一个外部观影室服务器，为每个应用设置不同的隔离 ID（随机长字符串），使各应用的房间相互隔离：

   ```env
   WATCH_ROOM_EXTERNAL_APP_ID=your_random_app_id
   ```

4. 重启应用即可使用外部观影室服务器



## 弹幕后端部署

要使用弹幕功能，需要额外部署弹幕 API 后端服务。

### 部署步骤

1. 按照[danmu_api](https://github.com/huangxd-/danmu_api.git)教程部署后端
2. 建议配置SOURCE_ORDER或PLATFORM_ORDER环境变量，默认弹幕源很少
3. 在管理面板设置后端地址




##  超分功能说明

超分功能需要浏览器支持webgpu并且你的浏览器环境不能是http（如非要在http中使用，需要在浏览器端设置允许不安全的内容）




## AndroidTV 使用

目前该项目可以配合 [OrionTV](https://github.com/zimplexing/OrionTV) 在 Android TV 上使用，可以直接作为 OrionTV 后端

已实现播放记录和网页端同步

## TVBOX 订阅功能

本项目支持生成 TVBOX 格式的订阅链接，方便在 TVBOX 应用中使用。

### 配置步骤

1. 在环境变量中设置以下配置：

   ```env
   # 启用 TVBOX 订阅功能
   ENABLE_TVBOX_SUBSCRIBE=true
   # 设置订阅访问 Token（请使用强密码）
   TVBOX_SUBSCRIBE_TOKEN=your_secure_random_token
   # 可选：屏蔽特定视频源（多个源用逗号分隔，填写视频源的 key）
   TVBOX_BLOCKED_SOURCES=source1,source2
   ```

2. 重启应用后，登录网站，点击用户菜单中的"电视访问"按钮

3. 复制生成的订阅链接到 TVBOX 应用中使用

### 聚合片库首页与外部订阅

管理员进入 **用户菜单 → 电视访问 → TVBox 订阅**，展开面板下方的 **管理订阅与源文件**，管理电视端内容：

- **本地片库首页**：本地片库启用并采集内容后，本站订阅首个站点为“MoonTV · 聚合片库”。提供作品归并后的海报墙、分类、年份和地区筛选；影片详情按来源列出播放线路。海报使用订阅 Token 访问，无需在电视端登录网页。普通用户只能读取其有权限的片库资源。
- **外部订阅**：填写名称和订阅地址导入，支持带注释的 JSON、图片封装 Base64 及常见 TVBox AES 编码。每个订阅可更新、启停、移除和选择输出的站点。更新失败会保留此前配置；外部订阅内容保存到当前配置存储中，TVBox 加载本站订阅时直接读取已保存的版本。
- **本地保存源文件**：默认开启。导入、更新时下载 JAR、脚本和可识别的静态配置；已有订阅可点击“下载源文件”。文件保存在服务端 `.data/tvbox/assets`，可通过 `TVBOX_ASSET_DIR` 指定持久目录，容器部署需要挂载该目录。客户端通过本站带 Token 的地址获取文件；JAR 保留原始字节和校验信息，脚本静态导入会一并下载并替换为本地地址。下载失败会列出原因并保留之前可用的文件，可点击重试。此功能需要具有持久磁盘的 Node 服务，源在运行时请求的站点与视频仍需联网。
- **过滤网盘接口**：默认开启，按站点名称及插件标识移除外部订阅中的网盘配置、盘搜和网盘播放站点。自动识别以外的站点可通过站点选择手动排除。电视访问面板可为订阅链接单独切换此选项，参数为 `cloudFilter=true/false`。
- **仅保留 M3U8 线路**：在 **后台管理 → 站点配置** 中统一设置，默认关闭。开启后，网页搜索、影片详情、聚合片库和 TVBox 的标准 JSON CMS 接口按同一规则筛选，只保留可识别的 M3U8 直链。无法确定播放格式的客户端插件站点也会隐藏。原始片库与缓存数据保留，关闭后可恢复其他格式线路。更改并保存后刷新网页、更新 TVBox 订阅即可使用，无需更换订阅地址。
- **去广告和黄色过滤**：适用于本地片库及标准 JSON CMS 源。网页播放器与 TVBox 开启去广告后共用本站 M3U8 处理接口，实际视频分片保持直连。除网址关键词和 CUE 广告标记外，完整 TS 点播清单还可通过时间戳、编码参数和正片时间线的连续性识别无标记插片；检测只读取少量分片头，设有超时及缓存，证据不足时保留内容。自定义去广告代码优先。黄色过滤按现有词库筛选返回内容。JAR、JS、Python 等客户端源的搜索、详情和播放由客户端插件执行，本地保存源文件不会使这些结果自动经过本站过滤。
- **站点兼容**：合并时保留各订阅的 Spider/JAR、站点扩展参数、解析器、直播和规则，并补全相对资源地址。JAR、JS 等站点交由客户端运行和搜索；这类站点是否可播放取决于客户端和源本身。多线路仓库链接需先选择一个具体线路导入。
- **扩展海报墙**：标准 JSON CMS 站点可点击“导入 CMS 视频源”，再到“本地片库”选择采集源并配置分类。JAR、JS 等站点保留在电视端的站点列表中。

在 OK 影视中添加或更新本站订阅后，选择 **MoonTV · 聚合片库** 作为首页源，并将首页内容设置为源推荐（具体名称随版本不同）。已保存的首页源可能优先于配置中的首个站点，需要手动切换一次。后续在后台修改外部订阅或站点选择后，再更新客户端的本站订阅。

## 安全与隐私提醒

### 请设置密码保护并关闭公网注册

为了您的安全和避免潜在的法律风险，我们要求在部署时**强烈建议关闭公网注册**：

### 部署要求

1. **设置环境变量 `PASSWORD`**：为您的实例设置一个强密码
2. **仅供个人使用**：请勿将您的实例链接公开分享或传播
3. **遵守当地法律**：请确保您的使用行为符合当地法律法规

### 重要声明

- 本项目仅供学习和个人使用
- 请勿将部署的实例用于商业用途或公开服务
- 如因公开分享导致的任何法律问题，用户需自行承担责任
- 项目开发者不对用户的使用行为承担任何法律责任
- 本项目不在中国大陆地区提供服务。如有该项目在向中国大陆地区提供服务，属个人行为。在该地区使用所产生的法律风险及责任，属于用户个人行为，与本项目无关，须自行承担全部责任。特此声明

## License

[MIT](LICENSE) © 2025 MoonTV & Contributors

## 致谢

- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter) — 项目最初基于该脚手架。
- [MoonTV](https://github.com/MoonTechLab/LunaTV)— 由此启发，再次站在巨人的肩膀上。
- [LibreTV](https://github.com/LibreSpark/LibreTV) — 由此启发，站在巨人的肩膀上。
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 提供强大的网页视频播放器。
- [HLS.js](https://github.com/video-dev/hls.js) — 实现 HLS 流媒体在浏览器中的播放支持。
- [Zwei](https://github.com/bestzwei) — 提供获取豆瓣数据的 cors proxy
- [CMLiussss](https://github.com/cmliu) — 提供豆瓣 CDN 服务
- 感谢所有提供免费影视接口的站点。

## Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=mtvpls/moontvplus&type=Date)](https://star-history.dera.page/#mtvpls/moontvplus&Date)
