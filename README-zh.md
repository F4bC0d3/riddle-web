# riddle-web

**Tom Riddle 的日记，在浏览器中。** 用手指或触控笔在屏幕上书写。停顿片刻后，日记会吸走你的墨水——你的字迹渐渐淡去——随后一段回复会以流畅的手写体自动浮现，然后同样缓缓消失。

> **在线演示：** [https://tomriddle.f4b.workers.dev](https://tomriddle.f4b.workers.dev)

[MaximeRivest/riddle](https://github.com/MaximeRivest/riddle)（最初为 reMarkable Paper Pro 打造）的 Web 移植版。可在任何带浏览器的设备上运行——手机、平板、桌面端均可。Samsung S-Pen、Apple Pencil 和 Wacom 触控笔均支持完整的压感功能。

**邀请制访问：** 每位朋友使用独立的邀请码登录。服务器持有 API 密钥，朋友只需输入邀请码即可使用——无需自己申请任何 AI 服务的密钥。

---

## 初学者必读：这是什么？

如果你几乎没有网络开发经验，下面用最简单的语言解释每个部分。

### 源代码（GitHub 仓库）

你在 GitHub 上看到的是一份 **源代码**。它就像一份菜谱——描述了网站如何运作，但本身不是网站。你需要"烹饪"（部署）它才能让朋友访问。

### `npm install` 做什么？

`npm` 是 Node.js 的包管理器。`npm install` 会下载项目所需的工具——这里主要是 **Wrangler**（Cloudflare 的命令行工具），用来把代码部署到 Cloudflare。

### Cloudflare Worker 做什么？

**Worker** 是 Cloudflare 提供的"小服务器"。你写的代码会被部署到 Cloudflare 全球的服务器上运行。它负责：

- 把网页发送给浏览器
- 验证朋友的邀请码
- 用你的 API 密钥调用 AI 大模型
- 把 AI 的回复传回浏览器

**电脑关了网站仍然运行**，因为代码跑在 Cloudflare 的服务器上，不在你的电脑上。

### D1 数据库做什么？

**D1** 是 Cloudflare 提供的数据库（类似 Excel 表格，但更强大）。它保存：

- 朋友的邀请信息（但不保存邀请码原文，只保存 HMAC-SHA-256 摘要）
- 登录会话记录（只保存 session token 的 SHA-256 哈希，不保存原始 token）
- 每人每天的 AI 调用次数

### Secret 是什么？

**Secret** 是只有服务器知道的密码。它保存在 Cloudflare 的安全系统中，永远不会发送给浏览器。本项目的 Secret 包括：

| Secret                  | 用途                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `INVITE_PEPPER`       | 用于计算邀请码的 HMAC-SHA-256 摘要——即使数据库泄露也无法反推邀请码 |
| `SILICONFLOW_API_KEY` | 你的 SiliconFlow（硅基流动）API 密钥                                 |

> 注意：`INVITE_PEPPER` 不是"加密"邀请码，而是用 HMAC-SHA-256 计算不可逆的摘要。HMAC 是单向的——有 pepper 和邀请码可以算出摘要，但从摘要无法反推邀请码。

### 邀请码、Session Cookie、API Key 的区别

| 概念                     | 谁拥有                              | 存放在哪                                        | 用途                           |
| ------------------------ | ----------------------------------- | ----------------------------------------------- | ------------------------------ |
| **邀请码**         | 你给你的朋友                        | 朋友的大脑                                      | 朋友证明"我是被邀请的"         |
| **Session Cookie** | 浏览器自动管理                      | 浏览器 Cookie（HttpOnly，不可被 JS 读取）       | 证明"我之前已经验证过邀请码了" |
| **Session Token**  | Worker 生成后仅通过 Set-Cookie 发送 | 浏览器 Cookie（原始随机值）+ D1（SHA-256 哈希） | 服务器验证会话身份             |
| **API Key**        | 只有你                              | Cloudflare Secret                               | 服务器向 AI 服务付费           |

### 哪些数据经过服务器？数据去哪了？

| 数据类型                      | 路径                                                                   |
| ----------------------------- | ---------------------------------------------------------------------- |
| 手写截图（PNG，包含书写内容） | 浏览器 → Cloudflare Worker → AI 模型服务商（SiliconFlow 硅基流动）   |
| 邀请码                        | 仅兑换时发送到 Worker → 计算 HMAC → 与 D1 中的摘要比对 → 不保存原文 |
| AI 回复文本                   | AI 服务商 → Cloudflare Worker → 浏览器流式显示 → 不写入 D1          |
| Session Cookie                | Worker 设置 → 浏览器保存（HttpOnly）→ D1 保存 token 的 SHA-256 哈希  |
| 主题设置（OLED 模式）         | 浏览器 localStorage，不发送到服务器                                    |

> **隐私说明：** 项目自身不主动将手写图片、识别内容和 AI 回复写入 D1 数据库。但请注意：图片会经过 Cloudflare Worker 并被发送到 AI 模型服务商（SiliconFlow 硅基流动），该服务商的基础设施会处理你的数据。不要在书写内容中包含密码、身份证号等敏感信息。

---

## 部署步骤（从零开始，Windows）

如果你从未部署过 Cloudflare 项目，按以下步骤操作。所有命令在 **CMD** 或 **PowerShell** 中运行。

### 前提条件

1. 安装 [Node.js](https://nodejs.org/)（推荐 LTS 版本）
2. 注册 [Cloudflare 账号](https://dash.cloudflare.com/sign-up)
3. 一个 [SiliconFlow（硅基流动）](https://siliconflow.cn/) 账号和 API 密钥

### 第 1 步：安装依赖

```bash
cd riddle-web
npm install
```

> **这步做了什么：** `npm install` 读取 `package.json` 中的依赖列表，从网络下载 **Wrangler**（Cloudflare 官方的命令行工具）。Wrangler 是后续所有操作的核心——创建数据库、设置密钥、部署代码都靠它。下载的文件放在 `node_modules/` 文件夹中，这个文件夹不会上传到 Git（已在 `.gitignore` 中忽略）。

### 第 2 步：登录 Cloudflare

```bash
npx wrangler login
```

浏览器会弹出 Cloudflare 授权页面，点击"Allow"。

> **这步做了什么：** `wrangler login` 在你的电脑和 Cloudflare 账号之间建立信任关系。它会生成一个 API Token 保存在本地，后续的 `wrangler deploy`、`wrangler d1 create` 等命令就不需要每次输入密码了。这个 Token 只存在你的电脑上，不会提交到 Git。

### 第 3 步：创建 D1 数据库

```bash
npx wrangler d1 create tomriddle-auth
```

命令输出会显示类似这样的信息：

```
created database "tomriddle-auth" with ID "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**复制数据库 ID**，下一步要用。

> **这步做了什么：** 在 Cloudflare 的服务器上创建了一个名为 `tomriddle-auth` 的 D1 数据库实例。D1 是 Cloudflare 的分布式 SQLite 数据库——你可以把它理解为一个云端 Excel 表格。它目前是空的（没有任何表），需要下一步用迁移来创建表结构。返回的数据库 ID 是它在 Cloudflare 系统中的唯一标识，需要写入 `wrangler.toml` 让 Worker 代码能找到它。

### 第 4 步：配置 wrangler.toml

打开 `wrangler.toml`，找到 `d1_databases` 部分，将 `database_id` 替换为上一步复制的数据库 ID：

```toml
[[d1_databases]]
binding = "DB"
database_name = "tomriddle-auth"
database_id = "你的数据库ID"   # ← 替换这里
```

> **这步做了什么：** `wrangler.toml` 是项目的配置文件，告诉 Cloudflare 这个项目需要哪些资源。`[[d1_databases]]` 这一节声明了"这个 Worker 需要绑定一个 D1 数据库"。`binding = "DB"` 是代码中的变量名——Worker 代码里通过 `env.DB` 访问数据库。`database_id` 告诉 Cloudflare 具体是哪个数据库实例。

### 第 5 步：应用数据库迁移

"迁移"（migration）是把空数据库变成有表结构的过程。`migrations/0001_auth.sql` 文件里定义了三个表。你需要分别在**生产数据库**和**本地数据库**上执行。

#### 5.1 查看迁移文件内容

打开 `migrations/0001_auth.sql`，你会看到三张表的定义：

| 表名            | 存储内容 | 关键字段                                                                             |
| --------------- | -------- | ------------------------------------------------------------------------------------ |
| `invites`     | 邀请信息 | `code_hash`（HMAC-SHA-256 摘要，不含邀请码原文）、`friend_name`、`daily_limit` |
| `sessions`    | 登录会话 | `token_hash`（session token 的 SHA-256 哈希）、`expires_at`、`revoked_at`      |
| `daily_usage` | 每日用量 | `invite_id`、`usage_date`、`request_count`                                     |

> 你不需要手动执行这些 SQL——下面的命令会自动完成。

#### 5.2 在生产数据库上应用迁移

```bash
npx wrangler d1 migrations apply tomriddle-auth --remote
```

> **这条命令做了什么：**
>
> 1. `d1 migrations apply` 告诉 Wrangler："我要应用迁移"。
> 2. `tomriddle-auth` 是数据库名称，和第 3 步创建的一致。
> 3. `--remote` 表示操作 Cloudflare 上的生产数据库（而不是本地的）。
> 4. Wrangler 会在 D1 中自动创建一个 `d1_migrations` 管理表（用于跟踪哪些迁移已执行），然后执行 `0001_auth.sql` 中的所有 SQL 语句。
> 5. 执行完成后，生产数据库里就有了三张空表——它们已经准备好存储邀请码摘要、会话记录和每日用量了。

#### 5.3 在本地开发数据库上应用迁移

```bash
npx wrangler d1 migrations apply tomriddle-auth --local
```

> **这条命令做了什么：**
>
> 1. `--local` 表示操作你电脑上的本地 D1 数据库。
> 2. 本地 D1 是 `wrangler dev` 启动时自动创建的，和生产数据库完全独立。
> 3. 这条命令确保本地数据库的表结构和生产数据库一致——方便你在本地测试时能正常使用邀请码登录等功能。
>
> **可选但推荐：** 如果你打算先用 `wrangler dev` 本地测试，现在就可以执行这条命令。如果直接部署到生产，可以跳过，第 9 步本地测试前再执行。

#### 5.4 验证迁移是否成功

```bash
# 查看生产数据库的表列表
npx wrangler d1 execute tomriddle-auth --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

# 查看本地数据库的表列表
npx wrangler d1 execute tomriddle-auth --local --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

> **这条命令做了什么：**
>
> 查询 SQLite 的系统表 `sqlite_master`，列出数据库中所有表名。如果迁移成功，你应该看到：
>
> ```
> daily_usage
> d1_migrations
> invites
> sessions
> ```
>
> 其中 `d1_migrations` 是 Wrangler 自动创建的迁移记录表，`invites`、`sessions`、`daily_usage` 是你项目的三张业务表。

### 第 6 步：生成 INVITE_PEPPER

生成 32 字节密码学安全随机密钥：

**PowerShell：**

```powershell
$bytes = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Fill($bytes); [Convert]::ToHexString($bytes).ToLower()
```

**CMD（需要安装 OpenSSL）：**

```cmd
openssl rand -hex 32
```

> **这步做了什么：** 生成一个 64 字符的随机十六进制字符串。这个字符串就是 `INVITE_PEPPER`——它是整个邀请系统的安全基石。邀请码本身是低熵的（比如全拼姓名，很容易被猜到），`INVITE_PEPPER` 和邀请码一起经过 HMAC-SHA-256 运算后，得到的摘要才是存入数据库的值。即使有人拿到了数据库，没有 pepper 也无法反推出邀请码。
>
> ⚠️ **妥善保管！** 这个值不能丢失——丢失后你无法验证任何现有邀请码，需要重新生成并让所有朋友换新的邀请码。

### 第 7 步：设置 Cloudflare Secrets

```bash
npx wrangler secret put INVITE_PEPPER
```

粘贴上一步生成的随机密钥，回车。

```bash
npx wrangler secret put SILICONFLOW_API_KEY
```

粘贴你的 SiliconFlow API 密钥。

> **这步做了什么：** `wrangler secret put` 把敏感值上传到 Cloudflare 的加密存储中。这些值在 Cloudflare 的服务器上被加密保存，Worker 代码通过 `env.INVITE_PEPPER`、`env.SILICONFLOW_API_KEY` 等方式读取。
>
> **Secret 和 `wrangler.toml` 的 `[vars]` 的区别：** `[vars]` 中的值是明文存在配置文件里的（可以提交到 Git），适合放模型名称、URL 这类非敏感配置。Secret 只存在于 Cloudflare 的安全系统中，任何人在 Dashboard 中也看不到明文——适合放 API Key、密码等敏感信息。
>
> 如果你也在本地开发（`wrangler dev`），需要在项目根目录创建 `.dev.vars` 文件（复制 `.dev.vars.example` 改名），在里面写入同样的值。`.dev.vars` 已被 `.gitignore` 忽略，不会提交到 Git。

### 第 8 步：添加第一位朋友

首先在当前终端中设置 `INVITE_PEPPER` 环境变量（和 Secret 中相同的值）：

**CMD：**

```cmd
set INVITE_PEPPER=你的pepper值
```

**PowerShell：**

```powershell
$env:INVITE_PEPPER = "你的pepper值"
```

> **这步做了什么：** 邀请码管理脚本 `scripts/invite-manager.mjs` 是一个 Node.js 程序，它运行时需要读取 `INVITE_PEPPER` 来计算邀请码的 HMAC-SHA-256 摘要。上面的命令把 pepper 临时注入到当前终端的环境变量中——关闭终端后这个值就消失了，不会写入任何文件。每次打开新终端都需要重新设置。

然后添加朋友：

**本地开发测试：**

```bash
npm run invite -- add --name "测试用户" --code "testuser-7k3p" --daily-limit 20 --local
```

**生产数据库：**

```bash
npm run invite -- add --name "王小明" --code "wangxiaoming" --daily-limit 20 --remote
```

> **这步做了什么：** 脚本内部做了几件事：(1) 将邀请码标准化（小写、去空格）；(2) 使用 `INVITE_PEPPER` 计算出 `HMAC-SHA-256(pepper, code)` 的摘要；(3) 通过 Wrangler 将这个摘要连同朋友名称、每日限额写入 D1 的 `invites` 表。数据库**只保存摘要，不保存原始邀请码**——即使数据库泄露，没有 pepper 的人也无法还原邀请码。
>
> `--local` 写入本地开发数据库（`wrangler dev` 使用）；`--remote` 写入 Cloudflare 上的生产数据库。

> **邀请码安全提示：** 全拼（如 `wangxiaoming`）容易被猜到。小规模熟人测试可以用，但推荐使用"全拼＋4~6 位随机字符"（如 `wangxiaoming-7k3p`）。两位朋友全拼相同时必须使用不同后缀。

### 第 9 步：本地测试

启动本地开发服务器：

```bash
npm run dev
```

浏览器打开 `http://localhost:8787`，输入邀请码 `testuser-7k3p` 测试。

> **这步做了什么：** `npm run dev`（即 `wrangler dev`）在你的电脑上启动一个迷你版的 Cloudflare Workers 运行环境。它会：
>
> - 在 `localhost:8787` 启动一个 HTTP 服务器
> - 运行 `src/worker.js` 中的代码
> - 自动连接本地 D1 数据库（独立的，和生产数据无关）
> - 读取 `.dev.vars` 中的 Secret 值（如果有的话）
>
> 这个本地环境不会消耗你的 Cloudflare 配额，所有请求都在你的电脑上处理。修改代码后它会自动重载。

> **注意：** `wrangler dev` 默认使用本地 D1。因此管理本地 D1 必须加 `--local`，管理生产 D1 必须加 `--remote`。不再依赖隐含默认值。

### 第 10 步：部署

```bash
npm run deploy
```

部署完成后会显示你的网址，形如 `https://tomriddle.你的用户名.workers.dev`。

> **这步做了什么：** `npm run deploy`（即 `wrangler deploy`）把你的代码打包上传到 Cloudflare 全球的边缘网络。具体流程：
>
> 1. 将 `src/index.html` 和 `src/worker.js` 打包成一个 Worker 脚本
> 2. 上传到 Cloudflare 的服务器
> 3. 分配一个 `*.workers.dev` 域名
> 4. 绑定 D1 数据库、Secrets 和 Rate Limiter——Worker 现在可以访问这些资源了
>
> 部署后，任何人都可以通过你的域名访问网站。**你的电脑关机后网站仍然运行**，因为代码跑在 Cloudflare 的服务器上。

### 第 11 步：无痕窗口测试

用浏览器的**无痕/隐私模式**打开你的网址，输入邀请码，确认可以正常使用。

> **这步做了什么：** 无痕模式下浏览器不带任何 Cookie 和历史记录，可以模拟"一个全新的访问者第一次打开网站"的场景。这能验证登录流程从头到尾都正常工作——不会因为之前测试的残留 Cookie 而跳过登录。

### 第 12 步：iPad Safari 测试

在 iPad 上用 Safari 打开网址，测试手写和停笔回复功能。

> **这步做了什么：** iPad + Apple Pencil 是这个项目最重要的使用场景。验证以下几点：
>
> - 登录界面在 iPad 上正常显示
> - Apple Pencil 书写有压感（笔迹粗细随力度变化）
> - 停笔约 2.8 秒后墨迹淡出，AI 开始回复
> - 回复以 Dancing Script 手写字体逐词浮现

---

## 邀请码管理

所有命令前需要在终端设置 `INVITE_PEPPER` 环境变量。

```bash
# 设置环境变量（每次打开新终端都要执行）
# CMD:
set INVITE_PEPPER=你的pepper值
# PowerShell:
$env:INVITE_PEPPER = "你的pepper值"

# 添加朋友 —— 创建新的邀请码
npm run invite -- add --name "王小明" --code "wangxiaoming" --daily-limit 20 --remote

# 查看所有朋友 —— 列出所有邀请（不显示邀请码原文，数据库不保存原文）
npm run invite -- list --remote

# 禁用朋友 —— 暂停某人的访问权限（邀请码保留，可以重新启用）
npm run invite -- disable --name "王小明" --remote

# 重新启用 —— 恢复被禁用的朋友
npm run invite -- enable --name "王小明" --remote

# 更换邀请码 —— 生成新邀请码，同时撤销此人所有活跃会话
npm run invite -- rotate --name "王小明" --new-code "wangxiaoming-7k3p" --remote

# 强制重新登录 —— 撤销此人所有会话，不改变邀请码
npm run invite -- revoke-sessions --name "王小明" --remote

# 删除朋友 —— 永久删除邀请记录和所有关联数据（需 --yes 确认）
npm run invite -- delete --name "王小明" --yes --remote
```

| 命令                | 做什么                                                  | 影响范围                       |
| ------------------- | ------------------------------------------------------- | ------------------------------ |
| `add`             | 计算邀请码的 HMAC-SHA-256 摘要，写入 D1                 | 新增一行`invites` 记录       |
| `list`            | 从 D1 读取所有邀请，按时间倒序排列                      | 只读，不修改任何数据           |
| `disable`         | 将`enabled` 设为 0                                    | 此人无法登录，但不删除任何数据 |
| `enable`          | 将`enabled` 设为 1                                    | 恢复被禁用的邀请码             |
| `rotate`          | 更新`code_hash` + 撤销所有活跃 session                | 此人需要新邀请码重新登录       |
| `revoke-sessions` | 将所有活跃 session 标记为已撤销                         | 此人全部设备被强制退出         |
| `delete`          | 删除`invites` + 关联的 `sessions` + `daily_usage` | 永久删除，不可恢复             |

> **`--local` 与 `--remote` 必须显式指定。** 本地开发用 `--local`，生产数据库用 `--remote`。不再有默认值。

---

## 查看日志

```bash
npx wrangler tail
```

> **这步做了什么：** `wrangler tail` 实时显示你的 Worker 在生产环境中的运行日志——就像看服务器的"监控屏幕"。你会看到每次请求的 URL、响应状态码、错误信息等。日志中**不会**输出 API Key、邀请码、完整 Cookie 或请求图片（代码中已做脱敏处理）。
>
> 按 `Ctrl+C` 退出日志查看。

---

## 更换 API Key

```bash
npx wrangler secret put SILICONFLOW_API_KEY
```

输入新密钥即可。无需重新部署。

> **这步做了什么：** Cloudflare Secret 修改后会自动推送到全球边缘节点，Worker 下次处理请求时就能读到新值。不需要重新 `npm run deploy`。

---

## 紧急停止公共服务

**方法 A：暂停 Worker**
在 Cloudflare Dashboard → Workers & Pages → tomriddle → 点击"Pause"。

> **效果：** Worker 停止响应所有请求，网站完全不可访问。这是最快的方式。可以随时点击"Resume"恢复。

**方法 B：禁用所有邀请码**

```bash
npm run invite -- list --remote                    # 查看所有朋友
npm run invite -- disable --name "王小明" --remote  # 逐个禁用
```

> **效果：** 网站本身仍然可以打开（显示登录界面），但所有人的邀请码都失效，无人能登录使用。恢复时需要逐个 `enable`。

---

## 服务器模型配置

模型名称、Base URL、最大 token 数等**非敏感**配置放在 `wrangler.toml` 的 `[vars]` 中：

```toml
[vars]
MODEL_NAME = "Qwen/Qwen2.5-VL-7B-Instruct"
MODEL_BASE_URL = "https://api.siliconflow.cn/v1"
MODEL_MAX_TOKENS = "1000"
ENABLE_BYOK_PROXY = "false"
```

> **为什么这些放在 `[vars]` 而不是 Secret？** 因为这些值不涉及安全——模型名称和 API 地址是公开信息。放在 `[vars]` 中可以提交到 Git，方便版本管理。真正的敏感信息（API Key、pepper）必须用 Secret。
>
> **Worker 如何使用这些值？** 在 `src/worker.js` 中通过 `env.MODEL_NAME`、`env.MODEL_BASE_URL` 等方式读取。修改 `[vars]` 后需要 `npm run deploy` 重新部署才能生效。

| 配置项                  | 含义                     | 是否可提交到 Git |
| ----------------------- | ------------------------ | ---------------- |
| `MODEL_NAME`          | 使用的视觉模型名称       | ✅ 是（非敏感）  |
| `MODEL_BASE_URL`      | 模型服务商的 API 地址    | ✅ 是（非敏感）  |
| `MODEL_MAX_TOKENS`    | 每次回复的最大 token 数  | ✅ 是（非敏感）  |
| `ENABLE_BYOK_PROXY`   | 是否允许朋友自带 API Key | ✅ 是（非敏感）  |
| `INVITE_PEPPER`       | HMAC-SHA-256 摘要密钥    | ❌ 必须是 Secret |
| `SILICONFLOW_API_KEY` | SiliconFlow API 密钥     | ❌ 必须是 Secret |

**客户端不能覆盖共享模式下的模型名称、Base URL 或 API Key。** 这些值由服务器在 `[vars]` 和 Secrets 中统一控制。

### 更换配置后

修改 `wrangler.toml` 的 `[vars]` 后需要重新部署：

```bash
npm run deploy
```

修改 Secret 则无需重新部署，新 Secret 即时生效。

### 自带密钥（BYOK）模式

默认关闭。如果你希望朋友使用自己的 API Key，将 `ENABLE_BYOK_PROXY` 设为 `"true"`。

启用后，前端设置面板会显示 API Key 输入框；代理只允许固定的 HTTPS 服务商域名（`api.openai.com`、`openrouter.ai`、`api.groq.com`、`integrate.api.nvidia.com`、`api.siliconflow.cn`），拒绝私网地址和任意 URL。有独立的频率限制（`PROXY_RATE_LIMITER`）。

> BYOK 代理会缓冲完整响应（上限 2 MB）再返回，不支持流式输出。共享邀请码模式下无需 BYOK，流式体验不受影响。

---

## 每日额度说明

- 每日额度按 **UTC 时间** 的 `YYYY-MM-DD` 重置（北京时间早上 8:00）
- 使用原子 UPSERT + WHERE 条件更新计数。更新后检查 `meta.changes`（0 表示被 WHERE 拒绝）+ 重新读取计数做双重校验，避免 SELECT-then-UPDATE 竞态条件
- D1/SQLite 在写入时评估 WHERE 条件，大幅缩小并发窗口
- 一次被接受的模型请求计入当日额度，即使上游模型随后失败
- 达到每日上限后返回日记风格的 429 提示
- **注意：** D1 不支持严格的可序列化事务隔离。极端并发场景下（同一毫秒数百个请求），理论上仍可能略微突破限额。这在朋友间小规模使用中不构成实际问题。

---

## Rate Limiter 配置

`wrangler.toml` 中配置了三个独立的 Rate Limiting 绑定，使用不同的 `namespace_id`：

| 绑定名称               | namespace_id | 限制对象  | 用途                              |
| ---------------------- | ------------ | --------- | --------------------------------- |
| `AUTH_RATE_LIMITER`  | `10001`    | IP 地址   | 防止暴力猜邀请码（每分钟 5 次）   |
| `ASK_RATE_LIMITER`   | `10002`    | invite ID | 限制模型调用频率（每分钟 6 次）   |
| `PROXY_RATE_LIMITER` | `10003`    | invite ID | 限制 BYOK 代理调用（每分钟 3 次） |

> **Rate Limiter 做什么：** 它是 Cloudflare 内置的"阀门"——在请求到达你的 Worker 代码之前就进行计数和限流，不消耗 Worker 的 CPU 时间。每个绑定有独立的计数器和限制规则。
>
> **为什么 AUTH 按 IP 而 ASK 按 invite ID？** 未登录时没有用户身份，只能用 IP 来防止暴力猜码。登录后使用 invite ID 更精确——多位朋友共享同一个 WiFi 时不会被 IP 限流误伤。
>
> 注意：即使 Rate Limiter 绑定暂时不可用（如本地开发未配置），D1 的每日额度仍然强制执行。Rate Limiter 是额外的一层保护。

---

## 特性

- ✍️ **完整压感支持**——基于 Pointer Events API（S-Pen、Apple Pencil、Wacom、触摸）
- 🌙 **OLED 纯黑模式**——纯黑背景（`#000`）可关闭三星 OLED 像素以节省电量
- 🔑 **邀请制访问**——朋友只需输入邀请码，无需自己的 API 密钥
- 📱 **全设备适配**——手机、平板、桌面端均可使用
- 🎭 **Tom Riddle 人格**——神秘、莫测、高度还原角色
- 🖋️ **Dancing Script** 手写字体用于回复渲染
- ⚡ **流式输出**——回复从 LLM 逐字流式呈现
- 🔒 **服务器端密钥**——API Key 只保存在 Cloudflare Secret 中
- 🛡️ **安全会话**——HttpOnly Cookie，30 天有效期

## 手势操作

| 操作                  | 效果                           |
| --------------------- | ------------------------------ |
| 书写后停笔            | 日记吸走你的墨水，Tom 开始回应 |
| 翻转触控笔 / 右键点击 | 擦除                           |
| 画一个小**?**         | 召唤内置指南                   |
| 按`Escape` 键       | 清除全部内容                   |
| 点击**⚙**            | 设置（OLED 暗色模式）          |

## 项目结构

```
riddle-web/
├── src/
│   ├── index.html          # 完整应用：画布、绘制、空闲检测、墨迹淡出、
│   │                       # PNG 导出、SSE 流式传输、SVG 回复动画、
│   │                       # 登录界面、会话管理、OLED 暗色模式
│   └── worker.js           # Cloudflare Worker：认证 + /api/ask + /api/proxy
├── migrations/
│   └── 0001_auth.sql       # D1 数据库结构
├── scripts/
│   └── invite-manager.mjs  # 邀请码管理 CLI 工具
├── wrangler.toml
├── package.json
├── .dev.vars.example       # 本地开发环境变量模板
└── .gitignore
```

## `.dev.vars` 注意事项

本地开发时可以创建 `.dev.vars` 文件（从 `.dev.vars.example` 复制），但**绝对不能提交到 Git**。`.gitignore` 已配置忽略此文件。

## 致谢

- 原始创意：[MaximeRivest/riddle](https://github.com/MaximeRivest/riddle)，为 reMarkable Paper Pro 打造
- 回复字体：[Dancing Script](https://github.com/googlefonts/DancingScript)（SIL OFL 1.1）
- 许可证：MIT
