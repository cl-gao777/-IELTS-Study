# 官方公开题库（资源核验 2026-10-04，接入 2026-10-05）

本次私人安装新增 **28 组、200 道题**。这些是官方公开样题与专项练习；没有证据将其标记为某次历年实考试卷。

| 模块 | 完整样题 | 专项 | 总题数 | 来源 |
| --- | ---: | ---: | ---: | --- |
| Academic Reading | 1 × 40 题 | 18 组，76 题 | 116 | IELTS.org、Cambridge English |
| Listening | 1 × 40 题 | 8 组，44 题 | 84 | IELTS.org，British Council 官方教案链接核验录音 |

原来的两组原创演示题仍有明确的“原创示例”标签。专项按原题号作答，不将其拼成一套考试，也不按同一资源在不同品牌网站出现的次数重复计数。

## 阅读

- [IELTS 无障碍样题入口](https://ielts.org/take-a-test/booking-your-test/access-arrangements)：完整大字版 Academic Reading，文本册、题本、答案分别保留。3 篇文章为 Rags to Riches、The Nature and Aims of Archaeology、Winning with Our Minds。
- [IELTS 官方样题入口](https://ielts.org/take-a-test/preparation-resources/sample-test-questions/academic-test)：[46 页原版 Reading 样题册](https://cdn.ielts.org/Sample-tests/ielts-academic-reading-sample-tasks-2023.pdf)，13 组、55 题，覆盖判断、匹配、选择、流程图、表格、句子/摘要/图解填空。
- [Cambridge English 免费样题](https://www.cambridgeenglish.org/exams-and-tests/ielts/preparation/)：[官方下载包](https://www.cambridgeenglish.org/Images/23435-ielts-sample-papers.zip)中增加 5 组、21 题，交通匹配、被动吸烟判断、农业标题匹配/选择、蜣螂图示填空。重复的火箭/蜣螂表格题已排除。ZIP 内不同 PDF 按文件哈希区分。

## 听力

- [IELTS 无障碍样题入口](https://ielts.org/take-a-test/booking-your-test/access-arrangements)：完整 40 题、答案、原始 MP3。不同无障碍格式使用相同题目/音频，只计一套。题面允许每段听两遍与暂停，不能按普通单遍考试解释结果。
- [33 页原版 Listening 样题册](https://ielts.org/cdn/Sample-tests/ielts-listening-sample-tasks-2023.pdf)：8 组、44 题，含题目、答案与听力稿。9 段不同录音（含完整套）均来自 IELTS CDN；专项音频通过 [British Council 官方教案](https://takeielts.britishcouncil.org/teach-ielts/teaching-resources/lesson-plans-listening)交叉核对。
- 专项 1/2 为同一运输公司对话的前后片段，分别 8/2 题。完整套未附公开听力稿；没有生成或猜测。

## 使用

打开 Reading / Listening，选择“官方资源”，可搜索标题与题型。Reading 在桌面宽屏使用约 2:1 的左右两栏：左侧按当前 Passage 上下连续显示原版 PDF 页，右侧只显示本篇答题框。完整阅读通过顶部三个 Passage 切换；18 组专项各自作为一个单篇练习，不混入共享总样题册中的其他专项或答案。

完整阅读的原文册、题本分别保留，每篇先连续显示对应原文页，再显示对应题目页；无需切换文件来回找题。左侧默认适应宽度，支持 125–200% 缩放，每页可展开提取文字摘录词汇。图示与排版以原 PDF 为准。

右侧保留原题号，所有篇的答案共同保存在整卷草稿中。切篇保留答案和计时，本次页面会话内还记忆每篇两栏位置与所选题；刷新恢复 SQLite 已保存的答案、笔记和用时，选篇和阅读位置从第一篇重新开始。最后“提交整卷”统一保存得分、每题答案、错题和错误原因。

参考答案 PDF 需主动展开，默认连续阅读范围不包含答案页。“打开完整原文件”仍可查看完整原卷，包括可能存在的附录。Listening 保留逐页试卷预览、按需展开的答案和专项 Transcript、笔记与听写；播放本地官方录音，支持倍速和 AB 循环。

这些专项和无障碍样题均只显示得分/正确率，不换算普通考试 Band。乱序多格按不同正确目标计分：books / some books 属于同一目标，重复两格只记一分；官方别名通过 `answerGroupTargets` 保留。数字、分数题中官方文字格式与机械词数限制不完全一致时，保留官方答案写法并在解析写明原限制。边缘格式可对照原答案页复核。

## 文件与数据

私人安装共导入 **12 份不同原 PDF、9 段 MP3**。共享样题册只保存一次，各专项记录页码。所有文件保留原字节和版权标识，Source Material 记录官方 URL、SHA-256 与使用范围；未将教材原文件、试题正文或答案清单提交到 Git。

`scripts/import-official-pack.cjs` 导入已经核验的本地清单，不联网。调用应用的实际题型与分组校验，核对文件哈希；SQLite 导入前留安全快照，数据库事务失败时回滚并清理当次文件。重复导入同一题组不会覆盖题目或学习记录。源代码、数据库和附件通过原有完整备份流程保存；旧 v1 备份缺少新增 `resource_json` 时按已知迁移补空值。

官方清单格式为 `ielts-studio-official-pack`。阅读套卷可附加
`readingPassages: [{id, label, questionIds, documents: [{documentIndex, page, endPage, label?}]}]`：
`documentIndex` 从 0 开始引用本套清单的 `documents` 数组，只能引用题目角色。
一篇可以关联原文与题本两个不同 PDF；`questionIds` 必须引用原有题目，联合覆盖
完整套卷且各题仅出现一次，乱序答案组不能跨篇。各范围使用实际 PDF 页码，
不得包含参考答案。导入器将索引转换为本机上传 URL，并保留官方来源和文件哈希。

已安装题组使用独立的幂等 metadata 回填，不通过重新导入覆盖。命令及哈希核对
映射见 [个人题库说明](PRIVATE_RESOURCES.md#reviewed-metadata-backfill)；该脚本同时
适用于官方阅读，只更新 `resource_json`，保留题目、答案和学习记录。备份恢复会
校验新增篇章的题目覆盖、合法页范围和嵌套附件关联。

## 个人使用依据

[IELTS 版权声明](https://ielts.org/legal/ielts-copyright-and-trade-mark-statement)允许署名的个人非商业下载/打印，要求遵守原材料限制、保留权利标记。Cambridge 官方备考页直接提供免费样题下载；[其主站使用条款](https://www.cambridgeenglish.cn/footer/terms-and-conditions/)说明个人备考使用范围。原文件仅用于本人的本地学习，不构成开放再分发许可。

British Council、IELTS USA、Cambridge New Insight 的部分旧完整卷链接已失效，未凑齐题本/答案/录音的候选未纳入。官方机考熟悉体验只提供在线程序的也未计入本地可评分题库。
