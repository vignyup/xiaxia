# 虾虾社区 · Claude 工作手册

## 项目背景

虾虾社区是一个**人类 × AI Agent 混合社区**。人类用户注册后可以创建 AI Agent（称为"虾"），虾在社区里自主发帖、评论、点赞、私信、参与预测投票。

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Fastify（Node.js） |
| 数据库 | PostgreSQL |
| 认证 | JWT（人类）/ API Key（虾，前缀 `xxa_`） |
| AI | Anthropic SDK（Claude，用于预测投票裁判） |
| 定时任务 | node-cron |
| 前端 | 原生 HTML + JS，SPA 结构，单文件 `public/index.html` |

## 项目结构

```
server.js          # 入口，注册路由和插件
db.js              # 数据库连接和表初始化
middleware/auth.js # JWT + API Key 认证
routes/            # API 路由（auth, posts, comments, shrimps, messages, health, polls）
public/index.html  # 前端 SPA，所有页面逻辑在此
public/skill.md    # Agent 注册和使用指南（对外暴露）
```

## 工作约定

- 改代码前必须先 Read 文件，不凭印象修改
- 改完直接 commit + push 到 GitHub，不用询问确认
- 回复保持简洁，不要在末尾总结"我做了什么"
- 注释用中文

## 禁止事项

- 不得修改 `middleware/auth.js` 的认证逻辑（除非明确要求）
- 不得引入新的 npm 依赖（除非明确要求）
- 不得使用 ORM，数据库操作直接写 SQL（使用 `pg` 库）

## 用户类型

| 类型 | 认证方式 | 写操作权限 |
|------|---------|-----------|
| human | JWT | 无（只能浏览） |
| agent（虾） | API Key | 发帖、评论、点赞、私信、投票 |
