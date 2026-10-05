# IELTS Studio 本地使用说明

IELTS Academic 私人学习工作台。基于 [aimerfeng/ists](https://github.com/aimerfeng/ists) 的 MIT 代码扩展；材料、练习、单词、草稿和统计保存在本机。

## 第一次运行

推荐 Windows + Node.js 24；最低要求 Node.js 22.3（本次验证 Node.js 24.21.0）。无需 Docker、数据库服务、云账号或 AI Key。

1. 打开项目文件夹，双击 `start.bat`。
2. 首次缺少依赖时脚本运行 `npm ci`，随后构建并启动；需要联网下载依赖。
3. 打开 http://127.0.0.1:3000。以后日常使用无需联网（AI 除外；系统 TTS 取决于本机已安装语音）。

PowerShell 也可执行：

```powershell
.\start.ps1
```

若系统执行策略禁止脚本，直接双击 `start.bat`，它只对本次启动进程设置脚本执行方式。脚本不会修改系统执行策略。

## 日常启动

双击 `start.bat`，保留启动窗口。关闭时按 Ctrl+C。再次启动会保留所有数据。

脚本会检查 Node、依赖、SQLite 原生模块、构建时间。已安装且未变更的依赖不会每天重装；源码有更新时自动重建。端口上运行的是同一项目目录时才会复用，其他目录的实例会提示端口占用。冷启动等待本实例就绪后再打开浏览器，最多等待 60 秒；超时后可手动打开终端显示的网址。可用 `start.ps1 -Port 3001` 或 `-NoBrowser`。

## 从 Today 开始

设置页可填写每天 15–360 分钟，30/60/90/120 均可。默认 60 分钟、Overall 6.5、单项 5.5。计划分配给词汇、听力、阅读、写作；任务完成度与实际学习时长分别记录。前台活动页面每 15 秒计时，隐藏页面或长时间无操作不会持续累计。

## Reading / Materials

本次私人安装已新增 19 组官方阅读（116 题）、9 组官方听力（84 题），共 200 题，含每科各一套 40 题完整无障碍样题。来源为 IELTS.org 和 Cambridge English 的公开练习；各题组有官方出处、原 PDF、答案及听力真人录音。详见 [官方题库说明](docs/OFFICIAL_RESOURCES.md)。

在列表选择“官方资源”，左侧阅读原版 PDF 逐页预览，右侧按原卷题号填写；答案/听力稿需自行展开。可翻页、缩放、摘录本页文字，提交后保存成绩与错题。专项和无障碍样题不换算普通考试 Band。

- 在 Materials 导入 TXT、Markdown、HTML、PDF、DOCX、图片或粘贴文章；扫描型 PDF 不做 OCR，可补充文本。
- 打开资料后可编辑标签、难度、来源、备注与正文；选择自由阅读、手工题目或 AI 生成。
- 手工录题支持 TFNG、YNNG、选择、匹配、填空、表格、地图/图示标签等。填写正确答案、解析和逐字 Evidence 后即可离线评分。地图/图示可提供图片；目前答案以文字/选项输入。
- 阅读左右独立滚动，支持字号、高亮、下划线、笔记、计时、全屏与题号导航。提交后显示答案与错误原因分类。
- 在任何页面选中英文，点击 Add to Vocabulary，来源句和材料一起保存。
- 40 题完整阅读/听力试卷可显示 Estimated IELTS Band；短练习仅显示得分/正确率。估算转换阈值不是官方成绩保证。

## Listening

导入 MP3、WAV 或 M4A（实际解码由浏览器支持的音频编码决定）。在资料详情补充 Transcript，打开精听模式。

播放器提供播放暂停、±5/10 秒、0.75/0.9/1/1.1/1.25 倍速及 AB 循环。设置 A、B 秒数或用当前播放位置设置。

听写时先输入听到的内容，展开参考 Transcript 填入本次片段对应的准确原文，点击核对保存。会区分漏词、多词、错词及疑似拼写错误，并进入错题库。疑似拼写用字符相似度识别，可人工判断。

原创内置听力样题用系统英式 TTS；新增官方听力使用保存到本地的真人录音。也可导入自己的音频。没有自动语音转写，Transcript 可手动导入。

## Vocabulary

FSRS 调度，Again / Hard / Good / Easy 四级复习。支持 Recognition、Recall、Spelling、Context；单词/例句可点击发音。没有安装英式声音时浏览器会使用可用英语语音。

词条支持中文释义、英文定义、词根、IPA、例句、原句/来源、搭配、近反义词、词族、备注与标签。可编辑已有词条而不丢复习进度。旧 ISTS 历史可回放到 FSRS。

## Writing

Task 1/2 类型、题目、图片、可调计时器与字数。输入后约 1.2 秒自动保存到 SQLite；连续输入也定期保存，另保留浏览器紧急恢复缓存。

完成稿保存后可建立下一版本，比较历史草稿；同题不同版本分开保存。AI 失败时保留草稿，不产生虚假分数。

AI 反馈包括四项标准、逐句建议、错误分类、表达改进、改写与行动项，明确标为 **AI Estimated Band**。当前 AI 发送文本；Task 1 图表图片用于编辑器展示，评估前请在题目中补充数值/内容。

## AI API 配置

在 Settings 填写 Base URL、API Key、Model、API protocol。支持 Responses 与 Chat Completions。API Key 留空会保留已配置密钥。

服务端配置优先顺序：设置页私有文件 → `AI_PROVIDERS_JSON` → `AI_BASE_URL/AI_API_KEY/AI_MODEL` → 经你在设置页启用的 Codex 备用配置。Codex fallback 默认关闭，避免未配置学习应用时意外使用其他服务。

可复制 `.env.example` 为 `.env.local` 手动配置；环境配置更改需重启。密钥不进入浏览器构建、不打印到日志、不进入学习 JSON/数据库备份。设置页密钥保存在数据目录的 `ai-provider.secret.json`，请保护你自己的 Windows 账户。

Tutor 按问题检索少量相关材料、词汇、近期错题和练习记录，避免发送整个数据库。使用 Tutor、请求作文 AI 反馈、生成 AI 题目，以及已配置 AI 时最终提交 Mock，会向配置的提供商发送有关文本；Mock 提交会自动请求作文评估。没有 Key 时 P0 功能仍可用。

## 数据保存位置

默认相对于启动脚本所在项目目录：

- `data/ists.db`：SQLite 数据库，WAL 模式。
- `data/uploads/`：导入的本地原文件。
- `data/ai-provider.secret.json`：可选 AI 密钥配置（不在数据库内）。
- `data/backups/`：恢复前快照，以及数据库下载时的快照。

安装到推荐目录后，默认数据库为 `D:\Codex_ws\IELTS_Study\data\ists.db`。

可在 `.env.local` 设置 `DATABASE_URL=file:D:/你的数据目录/ists.db` 与 `UPLOAD_DIR=D:/你的数据目录/uploads`。移动现有数据前先完整备份。仅改变路径不会自动迁移原数据库。

## Backup

Settings → 导出完整 JSON Backup。包含所有学习数据表及附件，文件路径采用可迁移引用。下载后存到另一个磁盘是更好的长期备份方式。

完整 JSON 的附件累计上限为 256 MB；超过时应用会明确拒绝导出。此时请先停止服务器，再备份整个数据目录；若使用自定义 `UPLOAD_DIR`，也需备份该附件目录。

“下载 SQLite 数据库快照”是 SQLite 一致性快照，**不包含上传文件与 API Key**，完整迁移优先使用 JSON。

## Restore

Settings → 选择本应用导出的 JSON → 输入 `RESTORE` → 恢复。恢复替换当前学习记录；此前数据自动保存为安全快照。非法字段、缺失表、缺失附件或错误外键会拒绝恢复/回滚。当前 v1 严格校验 schema，不接收原版 ISTS 的不完整旧导出。

若原数据附件已丢失，恢复仍可用原数据库安全快照保护剩余数据，然后导入健康的完整备份；原有附件不会删除。恢复后请检查页面显示与材料播放。

## Upgrade

1. 在 Settings 导出完整 JSON。
2. 停止服务器。
3. 更新代码，保留 `data/`、`.env.local` 和未提交的个人改动。
4. 运行 `start.bat`；锁文件变化时自动安装依赖，源码变化时自动构建。
5. 检查 Today、词库和最近作文。

不要使用 `git clean -xfd` 清理包含个人数据的项目。不要把 data、API Key、自有版权材料提交 Git。

## Troubleshooting

- **端口被占用**：停止另一个服务器或使用 `-Port 3001`。
- **SQLite 原生模块加载失败**：Node 大版本切换后执行 `npm rebuild better-sqlite3`；必要时重新 `npm ci`。源码编译需要 Windows C++ Build Tools；通常当前 LTS 有预编译包。
- **无法获取依赖**：检查 npm/GitHub 网络访问；安装成功后基础学习功能可离线运行。
- **页面未更新**：停止旧服务器，重新启动脚本；开发时使用 `npm run dev`。
- **发音不可用**：使用 Edge/Chrome，检查 Windows 英语语音是否已安装，或导入本地音频。
- **PDF 没有正文**：可能是扫描文档，请粘贴正文；不依赖 OCR/Whisper。
- **AI 报错**：核对 URL/协议/模型；Responses 地址通常填到 `/v1`，不包含 `/responses`。失败不会丢草稿。
- **恢复失败**：保留原始备份文件，阅读页面错误；不要手动覆盖运行中的 WAL 数据库。

开发验证：`npm test`、`npm run lint`、`npm run typecheck`、`npm run build`。当前交付结果见 `docs/VALIDATION.md`。
