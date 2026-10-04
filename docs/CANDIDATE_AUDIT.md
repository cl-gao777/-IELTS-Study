# IELTS Studio：三个参考项目审计

审计日期：2026-10-04。范围为 GitHub 公开 README、LICENSE、package.json、部分数据层代码与提交列表；未复制任何代码、题库、音频或教材。没有在本机运行这些三个候选，因此平台难度和功能描述不等于本地验收结果。提交列表页面有缓存，下面日期为本次可见最近提交，不能当作实时 HEAD 日期。

| 项目 | 许可与维护证据 | 技术与本地数据 | Windows 成本与角色 |
|---|---|---|---|
| Talljack/echo-type | MIT；可见提交 2026-09-06，3418924（后续版本文件可能更新） | Next.js 16、React 19、TS、Tailwind 4、Tauri 2、Dexie/IndexedDB、Vercel AI SDK、ts-fsrs；Supabase 同步为可选 | Web 使用 pnpm；桌面开发另需 Rust。通用英语学习能力强，IELTS 题型/写作 rubric 需要另建。适合借鉴精听、共享材料、FSRS 和跨模块练习流程 |
| iFralex/IELTS-Study | **当前没有开源许可证**；LICENSE 只允许私用检查/修改，不许可发布或分发；可见提交 2026-08-19，0b249e4 | Electron 39、React 19、TS、Vite、better-sqlite3；进度、答案、作文、卡片、聊天本地 SQLite | 有 Windows build 脚本，但 README 明说 Windows/Linux 发布流程未验证。适合参考阅读分屏、计时、结果与分析界面；不作为可分发二开基础 |
| sallowayma-git/IELTS-practice | GPL-3.0；可见提交 2026-08-28，1e2e47e | main 为静态 HTML/CSS/JS；浏览器本地存储；另有服务端/AI 分支 | main 用 Chrome/Edge 打开即可。存储依赖浏览器与 origin。只参考产品交互，不引入其题库与代码 |

## 功能适配

| 维度 | EchoType | IELTS-Study | IELTS-practice main |
|---|---|---|---|
| Reading | 文章阅读、中文翻译、上下文词汇 | IELTS 阅读题型、55:45 独立滚动、答后原文定位 | 阅读题库、答案对比、解析与原文高亮 |
| Listening | 本地材料、TTS、逐词跟读、Shadow Reading | IELTS 听力播放器、限时训练 | 用户自备听力资源，通过统一成绩通道记录 |
| Vocabulary/SRS | FSRS、材料词汇、收藏 | 简化 SM-2、闪卡多方向复习 | 词汇工具；本次未核实 FSRS |
| Writing | 以原文打字/跟练为主，不等同 Academic Task 1/2 评分系统 | Task 1/2 编辑、字数、AI 反馈，AI 失败仍保存 | main 不属于完整写作工作台，写作在独立开发分支 |
| AI | 多 provider Tutor、翻译、生成、发音等 | AI 写作、词汇、Tutor | main 不作为本任务 AI 基础 |
| Analytics/mock | 日计划、session、streak；未核实 IELTS 完整模考 | 题型准确率、耗时、趋势、Listening→Reading→Writing 模考 | 成绩、错题、套题、学习时间 |
| 导入/导出 | URL、文本、PDF、音频等；本次未充分核验整库导出边界 | 本地 DB 明确；主要题库 pipeline 为抓取 JSON，通用 BYOM/整库导出未充分核验 | 自定义题库目录，JSON 导入导出与恢复 |

## 决策影响

1. 不应再把 EchoType 描述为“运行强制依赖 Supabase”。README 明确无账号本地运行，`src/lib/supabase/client.ts` 对无配置返回 null，`src/lib/db.ts` 使用 Dexie 并持久化本地音频 Blob。但 IndexedDB 不是本任务优先的 SQLite，Tauri、同步、多端结构也增加二开范围。
2. IELTS-Study 的版权边界不仅涉及题库。当前 LICENSE 对原始代码保留权利，全部练习内容也明确来源 IELTS Liz；本项目仅借鉴界面与流程，不移植代码或素材。其阅读“Find in passage”是答案字符串附近的 excerpt，不应当作严谨 evidence 标注的替代品。
3. IELTS-practice main 的启动轻量，但浏览器 origin/清缓存会影响持久化；其 JSON 备份值得参考。其 README 单独提醒第三方资料版权，公开包去除了完整听力资源，不能据此推断全部阅读题库可再分发。
4. 三者均没有构成推翻用户优先选择 ISTS 的充分理由；最终选择应以 ISTS 实际 SQLite、服务端 AI key 边界、测试与启动审计为准。

## 一手来源

- EchoType：[README](https://github.com/Talljack/echo-type)、[MIT License](https://github.com/Talljack/echo-type/blob/main/LICENSE)、[package.json](https://github.com/Talljack/echo-type/blob/main/package.json)、[Dexie 数据层](https://github.com/Talljack/echo-type/blob/main/src/lib/db.ts)、[Supabase 可选检查](https://github.com/Talljack/echo-type/blob/main/src/lib/supabase/client.ts)、[提交列表](https://github.com/Talljack/echo-type/commits/main/)。
- IELTS-Study：[README](https://github.com/iFralex/IELTS-Study)、[代码许可声明](https://github.com/iFralex/IELTS-Study/blob/main/LICENSE)、[package.json](https://github.com/iFralex/IELTS-Study/blob/main/package.json)、[第三方素材声明](https://github.com/iFralex/IELTS-Study/blob/main/THIRD_PARTY_CONTENT.md)、[提交列表](https://github.com/iFralex/IELTS-Study/commits/main/)。
- IELTS-practice：[README](https://github.com/sallowayma-git/IELTS-practice)、[GPL-3.0](https://github.com/sallowayma-git/IELTS-practice/blob/main/LICENSE)、[提交列表](https://github.com/sallowayma-git/IELTS-practice/commits/main/)。
