# IELTS Study · 本地雅思学习工作台

A local-first IELTS workspace. Clone it, run it on your computer, and keep your learning history and documents on your own device.

本项目基于 [aimerfeng/ists](https://github.com/aimerfeng/ists) 的 MIT 代码扩展，使用 Next.js、React、TypeScript 和 SQLite。每个使用者在自己的电脑上独立运行，无需注册账号。

## 功能

- **阅读**：按 Passage 连续滚动阅读 PDF，左右分栏答题，保存整卷草稿和计时。
- **听力**：本地音频播放、逐题答题、评分与错题复习。
- **词汇**：离线语境填空，认词、回忆、听写专项，共享 FSRS 调度；核对前隐藏答案，恢复原题面和输入。
- **课程**：NGSL 1.2 基础词 2,809 个、NAWL 1.2 学术词 957 个，共 3,766 个词条和 7,532 道原创语境题；支持 TXT、CSV、Excel 导入。
- **进阶用法**：支持 B2/C1 义项、熟词新用法、暂停与分钟级巩固；需自行导入相应学习资料。
- **词根词缀**：160 课（80 词根、40 前缀、40 后缀），词群教学、选择与语境练习，保存中断位置、提示和首次作答；自行重练，不安排 FSRS。关联词仅在明确选择加入后进入词汇学习。
- **写作与模考**：作文自动保存、计时、历史版本；可选 AI 反馈明确标为估计分数。
- **记录与备份**：学习统计、错题、SQLite 持久保存，以及含附件、词根课程与会话的 v6 JSON 备份和恢复。

## 快速开始：Windows

安装 [Node.js 24 LTS](https://nodejs.org/) 和 [Git](https://git-scm.com/)，然后执行：

```powershell
git clone https://github.com/cl-gao777/-IELTS-Study.git IELTS-Study
cd IELTS-Study
.\start.bat
```

首次启动需要联网安装 npm 锁定依赖并构建，之后浏览器会打开 **http://127.0.0.1:3000**。也可以在文件管理器中双击 `start.bat`。保留终端窗口，按 Ctrl+C 停止。

最低 Node.js 版本为 22.3，推荐使用 24。端口冲突时运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Port 3001
```

## 手动启动

```bash
npm ci
npm run build
npm start
```

开发使用 `npm run dev`。macOS/Linux 可使用上述 npm 命令；依赖含 SQLite 和 PDF 原生模块，须在使用设备上安装，不能跨系统复制 `node_modules`。

基础练习、词汇课程和本地保存无需 AI API Key。可选 AI 功能在 Settings 配置，或复制 `.env.example` 为 `.env.local`；密钥留在本机。语音使用浏览器/系统提供的英语声音，可用性与是否联网取决于所选声音。

## 克隆后包含哪些资料

公开仓库包含上述 NGSL/NAWL 离线课程及项目原创阅读、听力示例。首次使用默认学术课程，公共课程和个人学习词条分开；浏览几千词不会自动生成几千条到期记录。

仓库**不包含**维护者的私人 PDF、历年试题、答案课包、音频、数据库、学习历史或 API Key。其他使用者请导入自己有权使用的资料。支持私人进阶课程的程序功能已包含，维护者的「PDF 精选」课程内容不随公开代码分发。来源与导入说明见 [本地使用指南](README_LOCAL.md)、[官方练习资源](docs/OFFICIAL_RESOURCES.md) 和 [个人题库](docs/PRIVATE_RESOURCES.md)。

## 数据与升级

默认文件均相对于项目目录：

- `data/ists.db`：个人 SQLite 学习数据库。
- `data/uploads/`：个人附件。
- `data/ai-provider.secret.json`：可选 AI 配置。
- `data/backups/`：恢复前安全快照。

Settings 可导出/恢复完整 JSON 备份。SQLite 快照不含附件和密钥；完整迁移请使用 JSON，或停服后备份整个数据目录。v6 支持本项目已知完整 v1–v5 备份的升级，不能将上游不完整导出视为完整备份。旧备份不补造词根学习记录，恢复后旧页面失效，未提交回答可保留为独立副本。

升级前先备份，停止应用，再 `git pull`；保留 `data/` 和 `.env.local`，运行 `start.bat` 或重新 `npm ci && npm run build && npm start`。不要使用 `git clean -xfd`，它会删除 Git 忽略的个人资料。

## 检查与贡献

```bash
npm ci
npm run check
```

检查包含测试、类型检查、lint 和生产构建。贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。可选容器与私人服务器说明见 [部署指南](docs/DEPLOYMENT.md)。应用默认仅监听本机；本仓库提供本地安装应用，没有多人共享学习记录或公开在线服务。

## 许可与来源

程序使用 [MIT License](LICENSE)，保留上游作者和本项目维护者署名。NGSL/NAWL 词表、释义和本项目课包改编另按 **CC BY-SA 4.0** 分发，完整作者、下载来源、版本和 SHA-256 见 [词库许可说明](src/data/VOCABULARY-LICENSE.md) 及 [来源清单](src/data/vocabulary-source-manifest.json)。私人资料不因程序开源而获得再分发许可。

词根词缀课程、来源摘录及改编另按 **CC BY-SA 4.0** 分发，逐项保留 Wiktionary 修订署名与公开词汇资料来源，见 [课程内容与许可](docs/morphology-curriculum.md)。仅有可核依据时标注 B2/C1，未标等级不等于基础词。

本项目不是 IELTS 官方产品，词库不称为官方固定考纲；没有复制 Lingvist 课程内容。AI 反馈不代表正式 IELTS 成绩。
