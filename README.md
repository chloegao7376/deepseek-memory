# 长忆：DeepSeek 长期记忆客户端

一个面向单用户的最小部署版本：GitHub Pages 前端、Supabase Auth/Postgres/pgvector/Edge Functions 后端，以及 DeepSeek 官方 API。

## 安全边界

- DeepSeek API Key 只存放在 Supabase Edge Function 的 secret 中，不进入浏览器或 GitHub 仓库。
- 浏览器只持有 Supabase publishable key；数据库通过 Row Level Security 按登录用户隔离。
- `OWNER_EMAIL` 将付费聊天接口限制为指定邮箱。
- 这不是端到端加密系统。数据库运营方及拥有项目后台权限的人仍有能力访问数据。
- API 接入不会移除 DeepSeek 服务端或模型本身的安全与使用政策。

## 一、准备账户

准备清单：
1. 一个 GitHub 账户。
2. 一个 Supabase 项目。
3. 一个 DeepSeek API Key，并设置可接受的余额或消费控制。
4. 一个只有你能访问的邮箱，用于登录客户端。

## 二、创建 Supabase 数据库

1. 在 Supabase 新建项目。
2. 打开 SQL Editor。
3. 完整运行 `supabase/migrations/001_initial.sql`。
4. 在 Authentication → URL Configuration 中，把 Site URL 和 Redirect URLs 加入最终的 GitHub Pages 地址，例如：

   `https://YOUR_GITHUB_NAME.github.io/deepseek-memory/`

5. 在 Authentication → Providers 中启用 Email。建议先完成自己的首次登录，再关闭公开新用户注册。

## 三、部署 Edge Function

本机需要 Node.js、Git 和 Supabase CLI。进入项目目录后运行：

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy chat
```

然后配置服务端 secrets：

```bash
npx supabase secrets set DEEPSEEK_API_KEY=你的DeepSeekKey
npx supabase secrets set DEEPSEEK_MODEL=deepseek-flash
npx supabase secrets set OWNER_EMAIL=你的登录邮箱
npx supabase secrets set ALLOWED_ORIGIN=https://YOUR_GITHUB_NAME.github.io
```

`ALLOWED_ORIGIN` 只写 origin，不带仓库路径和结尾斜杠。例如 GitHub Pages 项目地址是 `https://alice.github.io/deepseek-memory/`，这里填写 `https://alice.github.io`。

## 四、部署 GitHub Pages 前端

1. 在 GitHub 创建一个新的空仓库，例如 `deepseek-memory`。
2. 把本目录内容提交并推送到仓库的 `main` 分支。
3. 打开仓库 Settings → Secrets and variables → Actions → Variables，创建：

   - `VITE_SUPABASE_URL`：Supabase 项目 URL。
   - `VITE_SUPABASE_PUBLISHABLE_KEY`：Supabase publishable key。它可以出现在前端；不要填写 secret/service-role key。

4. 打开 Settings → Pages，把 Source 设为 GitHub Actions。
5. 打开 Actions，等待 `Deploy GitHub Pages` 完成。

如果仓库变量是在第一次构建之后才添加的，在 Actions 页面重新运行工作流。

## 五、首次登录与迁移

1. 用 Safari 打开 GitHub Pages 地址。
2. 输入与 `OWNER_EMAIL` 完全一致的邮箱，点击邮件中的登录链接。
3. 打开“设定”，粘贴从旧 DeepSeek App 窗口整理出的四部分档案。
4. 先发送几条低敏感度消息，确认角色、数据库和记忆召回正常。
5. 确认无误后，在 Safari 的分享菜单选择“添加到主屏幕”。

迁移提示词见 `MIGRATION_PROMPT.md`。DeepSeek App 的原窗口不会自动同步到 API 客户端；需要通过该提示词整理后人工迁移。

## 本地运行

```bash
cp .env.example .env
npm install
npm run dev
```

本地地址通常是 `http://localhost:5173`。若要让本地页面调用已部署的函数，需要暂时把 `ALLOWED_ORIGIN` 改为该地址；测试后再改回 GitHub Pages origin。

## 当前版本的取舍

- 为简化部署，回复暂时采用非流式请求。
- 每次回复只带最近 16 条消息，并从长期记忆召回最多 8 条。
- Supabase 内置 `gte-small` 只适合英文，因此程序会让 DeepSeek 为中文消息和记忆生成英文检索表示；展示及回答仍使用中文原文。
- 自动记忆最多提取 3 条，并跳过高度相似的已有记忆。
- 当前只有一个默认对话；后续可以加入多会话、代表性对话样本、加密导出、记忆纠错/替代和流式输出。
