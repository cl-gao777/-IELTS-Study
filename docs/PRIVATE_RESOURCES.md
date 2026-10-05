# Personal reading bank

用户提供的学习资料按 `user-supplied` 来源保存，和官方公开样题分别筛选。
年份代表用户的资料分类；文件名中的月、序号不自动认定为真实考试日期。
保留原 PDF、原文件名、导入位置、SHA-256、核对日期及资料质量说明。
付费或第三方题目、答案和导入清单仅进入私人存储，不提交 Git。

## Reading workflow

打开 Reading →「我的题库」，按资料年份或原文件编号搜索。打开练习后，
左侧「试卷 PDF」可以切换三个 Passage，按原卷页码翻页、缩放；右侧保留
原题号作答。参考答案另行展开，原文件入口保留全部排版与整理者标識。

Practice Attempts 使用附带答案表评分；多选题支持乱序但每个正确选项只计一次。
可接受的括号、拼写或数量写法需要逐题整理，不能把原答案字符串直接当作一个答案。
私人整理资料记录原始分数和错题，不自动换算正式考试 Band。

缺题或缺页在练习卡片和原题区域直接显示。缺少题干的题目不计入评分；
没有答案的资料可保留为自由阅读，卡片标记「待补答案」。不生成未经核实的答案。

## Reviewed offline import

`scripts/import-private-pack.cjs` 接受 `ielts-studio-private-pack` 清单，使用应用的
真实 `manualPracticeSchema` 校验题型、答案、字数及乱序组。每套练习包含
`user-reading-*` ID、标题、来源说明、资料年份、时长、题目数组和原始 PDF 描述。
PDF 描述包含 `role`（questions / answers）、`label`、`localPath`、`sha256`、
可选起始 `page` 与提取的 `content`。同一原文件可有多个 Passage 视图。

```powershell
node scripts/import-private-pack.cjs C:\path\to\reviewed-private-pack.json
```

启动应用建立数据库后再导入。导入前验证文件哈希与题目，建立 SQLite 一致性
安全快照，再以事务添加 Source Materials 和 Practice Sets。同字节 PDF 在多个
题本/答案视图中只存一份。同一题本改名后重新提供也会按文件与题目身份去重。
再次执行同一清单跳过已安装练习；同 ID 的文件或答案
发生变化会拒绝替换，保护既有 Practice Attempts。事务失败会回滚数据和新复制文件。

原文件仍在用户提供的位置，工作台使用 `data/uploads` 内的私人副本。恢复完整
JSON 备份时一并保留个人资料元数据、全部本地附件引用及学习记录。

## 2021 batch

2026-10-05 整理用户指定的 30 份 PDF：28 套 40 题、2 套 39 题，合计 1,198 个
可练习题位。每份 PDF 附有 Solution 表；原文件字节保持不变。

- `2021-09-01.pdf`：印刷页码由 3 跳到 5，缺第 4 页，涉及文章续文和第 1 题。
  已保留第 2–40 题与缺页说明，待补原页。
- `2021-10-02.pdf`：正文止于第 39 题；答案表中的一组三选条目重复标为 27–29，
  对应正文第 37–39 题。保留原 PDF，记录此对应关系，无第 40 题。
- 部分套卷重复使用同篇文章：Caveat Scriptor，以及 LOCKED DOORS, OPEN ACCESS
  和 A leap into history。按原套保留不同组合，不声称有 90 篇不同文章。

这些文件带有第三方整理标识；本工作台未核实其官方历年真题身份。编号和年份
按用户分类保存，来源标签保持「用户提供」。
