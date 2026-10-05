# IELTS Studio 实施记录

日期：2026-10-04。

## 基础项目与选择

基于 [aimerfeng/ists](https://github.com/aimerfeng/ists)，原始审计 commit：`1088fe0f11391ec0106d5225c40ae310c57a37ba`，MIT License。

本项目先审计 AGENTS.md、CONTEXT.md、架构决策、真实数据层与页面，再安装依赖、运行原项目。原版 localhost HTTP 200、10 个原有测试通过之后才开始修改。

ISTS 已有 Next.js / React / TypeScript、SQLite、Route Handlers、题目评分、词汇复习、写作、题库导入、Review、Analytics、Mock、AI provider 等基础。它与用户要求的单用户、本地文件、SQLite、IELTS 专项工作流最接近。原版不是完整满足本任务：Reading 只有三种题型；Listening 忽略音频 URL、只读 TTS；资料生成练习依赖 AI；写作和成绩展示也需明确真实评分边界。因此保留框架和持久层，补齐工作流，而非从零搭页面或迁移架构。

| 候选 | 实际审计结果 | 采用方式 |
|---|---|---|
| `aimerfeng/ists` | MIT；原始代码、本地启动、SQLite 与测试实际核验 | 唯一二次开发基础 |
| `Talljack/echo-type` | MIT，Next.js/Tauri/Dexie/FSRS；Supabase 同步可选，不是运行硬依赖；本次可见提交 2026-09-06 | 参考精听、FSRS、材料贯通思路；未复制代码或素材 |
| `iFralex/IELTS-Study` | Electron/React/SQLite；当前 LICENSE 仅许可私用检查/修改，不是可自由分发的开源许可；本次可见提交 2026-08-19 | 仅参考阅读分屏、考试与写作交互；未移植其代码或 IELTS Liz 内容 |
| `sallowayma-git/IELTS-practice` | GPL-3.0；main 为静态浏览器存储；本次可见提交 2026-08-28；第三方素材另有版权边界 | 仅参考产品流程，不复制题库、PDF、音频或解析 |

维护日期来自本次读取的 GitHub 提交列表，可能受缓存影响，不代表实时最新版本；只有 ISTS 在本机运行。来源：[EchoType README/License](https://github.com/Talljack/echo-type)、[IELTS-Study LICENSE](https://github.com/iFralex/IELTS-Study/blob/main/LICENSE)、[IELTS-practice README/License](https://github.com/sallowayma-git/IELTS-practice)。

## 保留的基础设施

- Next.js App Router、React Client Components、TypeScript、Zod、CSS/Tailwind、better-sqlite3 和 Vitest。
- 原有 `practice_sets` / `practice_attempts`、`source_materials`、`vocabulary_words` / reviews、`writing_submissions`、Study Tasks、Review Items、Coach 和 Mock 记录。
- 统一 AI provider 的 Responses / Chat Completions 路径、可选环境变量和 Codex fallback。
- 原创示例短文与听力稿；没有加入 Cambridge、IELTS Liz 或其他未授权完整教材。

## 本次实际实现

### 每日学习与本地设置

产品命名集中到 `lib/product.ts`，默认目标 Overall 6.5、单项 5.5。Today 首屏展示下一步任务、可调整每日学习时长、完成率、到期词、近期正确率和实际学习时间。实际时长与预计时长分开记录；Light/Dark、中文导航、桌面双栏布局。

### Reading / Listening / Materials

- 双栏独立滚动、字体大小、计时、全屏、题目导航、键盘快捷键。
- 14 个题型共享描述、校验、输入与评分框架；每个空格或匹配项独立录入，支持本地地图/图示图片。
- 答案、原文、证据、解释、时间和错题保存；Find Evidence 在文本中定位；8 种阅读错误原因可记录。
- 标注、下划线、整体/选段 Notes 和回答草稿保存在 SQLite，恢复页面可继续学习。
- 资料库支持导入 TXT/Markdown/HTML/PDF/DOCX/图片/音频，搜索、标签、难度、Section、来源和备注；HTML 转纯文本。
- 本地无 AI 纯阅读与手工 Questions + Answers；资料详情可编辑 Transcript，也可加载本地 TXT/Markdown 听力稿。
- HTMLAudio 真实播放导入音频，±5/±10 秒、速率、AB 循环；上传路由支持 Range。TTS 仅用于没有音频的原创示例或词汇发音。
- 听写对齐与 missing/extra/wrong/spelling 差异，连同 AB 时间范围保存，错误进入 Mistakes。

### Vocabulary / SRS

任意页面明确选中英语可收词，保存来源句和材料名；词条完整字段可编辑。Recognition、Recall、Spelling、Context 四种模式，British English 系统发音。新增 FSRS adapter，迁移原有真实复习历史，保留到期时间；Again 形成统一错题记录。

### Writing / Mistakes / Analytics

Task 1/2 分类、prompt/图片、字数、可调计时、SQLite 自动保存；同一题多版本重写与对照。AI 配置后返回结构化四项反馈、句级错误、分类、建议改写与行动项；无 AI / AI 失败保留作文且不虚构 band。

Mistakes 汇集练习、词汇、听写、写作来源，支持复习与掌握状态。Analytics 使用真实数据库历史，按题型、错误原因、词汇复习、听写差异、写作四项反馈和学习日统计；无记录展示空状态。短练习显示正确率，完整 40 题才估算 Reading/Listening Band。

### Backup / Ownership

Settings 可导出完整 JSON（应用表和附件）、数据库快照，恢复前留安全快照并检查结构与关联关系。附件路径不直接从备份信任。AI Key 使用独立本地秘密文件，不进入学习 JSON 或 Git。原版“每次启动补种子”的行为改为有迁移标记的首次初始化，避免恢复空库后意外重新增加样例。

## 工程选择与修复

1. 改用 npm 管理本地安装与运行。本机现有 pnpm 启动器不能稳定按项目版本工作，另一次 `pnpm exec` 触发全锁文件 registry 校验，受网络权限阻止；项目内 Node 二进制和 npm 脚本可正常运行。`package-lock.json` 记录实际依赖。
2. 保留 SQLite 基表，扩展模块按需创建附表；没有引入 SaaS、登录、Redis、Docker 或全量重构。
3. 新增 `ts-fsrs` 为小型纯 TypeScript 调度依赖，迁移成本合理；保留上游 scheduler 为旧路径兼容，现代词汇 API 走 FSRS。
4. 不把小样本正确率线性转换为正式 band。写作本地 fallback 的字数/规则检查不再作为 AI 评分来源。
5. 浏览器读取本地音频需要真实 Range 支持；已补 206、Content-Range、Accept-Ranges 和非法范围 416。
6. 资料文件只以本地随机名保存，HTML 等活动文件限制原始预览执行；核心 API 不需云端服务。
7. 运行时数据均在 data 目录，Git 忽略用户数据库、附件、环境文件和秘密配置。升级不删库。
8. 真实 PDF 上传暴露上游 `pdf-parse@1.1.1` 的运行时兼容问题：有效 ReportLab PDF 在裸 Node 可读，但 Next.js Route Handler 返回 `bad XRef entry`；仅外部化依赖或切换其内置旧 PDF.js 仍失败。升级至官方稳定 `pdf-parse@2.4.5`（Apache-2.0 依赖）和其 PDF.js 5.4，使用本地 worker、Windows `file:` URL、独立 Uint8Array 与 finally destroy；在 Next 中 externalize parser/canvas。开发 HTTP 连续两次 PDF 与一次 DOCX 均返回 200 并提取完整原创句子；补充 4 个真实文件提取回归测试。没有下载远程 worker 或教材素材。

## 已执行的模块验证

- 原版：10 个测试通过，HTTP 200。
- Reading/Listening 新增 18 个测试通过：词级听写对齐、14 题型 schema、重复 ID / 无效选项 / 图片 URL 校验、原创逐字 evidence、HTML 转换、SQLite 重启、练习来源快照、错因与听写事务保存。
- 定向 ESLint 无 warning，TypeScript 检查通过。
- API 实测：上传原创合成 WAV、编辑 Transcript、创建无 AI 精听练习、Range 206/44 字节、听写漏词保存、工作台草稿 GET 恢复均成功。
- 真实浏览器：阅读列表及双栏正常；本地 WAV 实际播放，0.75×、AB 0–0.7 秒持续循环、暂停及听写核对显示正常。

最终完整验证：68 tests / 16 files 全部通过，lint、typecheck、production build 均通过。生产 HTTP 验证 PDF/DOCX 解析、25 表含附件备份恢复、无 AI 作文保留；真实浏览器验证 MP3/WAV、AB 循环、阅读错题、收词、FSRS 和写作版本。停止并重启后 25 表记录数保持。外部 AI Provider 未使用真实 API Key 调用。

正式安装已完成于 `D:\Codex_ws\IELTS_Study`，通过 Windows PowerShell 5.1 启动脚本完成新目录生产构建，服务为 `http://127.0.0.1:3000`，实际数据路径为该目录 `data/ists.db`。正式安装未携带开发测试记录。详细证据见 [docs/VALIDATION.md](docs/VALIDATION.md)。

## 2021 年个人阅读题库

2026-10-05：增加私人阅读题库来源类型、资料年份筛选和可见的缺页/编号说明。
审核用户提供的 2021 年 30 份 PDF，整理 1,198 个可练习题位，原文件和答案表
留在私人 data 中。新增带哈希校验、一致性备份、事务回滚、重复导入保护的
离线导入脚本；使用现有原卷 PDF 预览、评分、笔记和错题流程。

## 后续范围

见 [TODO.md](TODO.md)。它只记录确实未实现的后续增强，不替代当前本地 P0 学习闭环。

## 官方公开题库扩充（2026-10-05）

根据用户选择“先扩充官方公开资源”，导入 19 组阅读 116 题、9 组听力 84 题。资料来自 IELTS.org 与 Cambridge English 官方免费样题；资源保留出处、版权、核验日期、文件哈希及题号/页码。完整无障碍样题单独说明考试条件，专项不拼卷、不估 Band。原 PDF 和真人 MP3 仅存于私人 data/uploads，不进入 Git。

新增来源筛选、题型搜索、原版逐页 PDF 预览/翻页/缩放/摘录、按需答案和听力稿、原卷编号答题卡与真人录音；继续使用原有计时、自动保存、评分、错题和听写流程。分组评分支持不同正确目标及官方同义写法，重复目标只计一次。数据库增加兼容迁移的 resource_json，完整备份验证附件引用并兼容旧 v1。

验收发现并修正原生 PDF 内嵌不可见、ZIP 同 URL 不同文件误去重、Next.js 默认 10 MB 请求体截断和大 Base64 正则栈溢出。开发环境实际逐组 200/200 评分、36 MB 备份恢复及恢复后的文件哈希/数据库完整性全部通过；85 个测试、lint、类型检查和生产构建通过。详见 docs/OFFICIAL_RESOURCES.md 与 docs/VALIDATION.md。

