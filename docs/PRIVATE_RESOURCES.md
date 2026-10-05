# Personal reading bank

用户提供的学习资料按 `user-supplied` 来源保存，和官方公开样题分别筛选。
年份代表用户的资料分类；文件名中的月、序号不自动认定为真实考试日期。
保留原 PDF、原文件名、导入位置、SHA-256、核对日期及资料质量说明。
付费或第三方题目、答案和导入清单仅进入私人存储，不提交 Git。

## Reading workflow

打开 Reading →「我的题库」，按资料年份或原文件编号搜索。打开练习后，
桌面宽屏左侧阅读材料与题目、右侧答题框约为 2:1，两栏独立滚动。顶部切换
Passage，左侧仅将当前篇的原 PDF 页连续排列，上下滑动即可阅读；右侧仅显示
该篇题目，保留原题号。默认适应宽度，可缩放并展开每页提取文字摘录词汇。

答案始终保存在整卷草稿中，切篇不会丢失其他篇的输入或重置计时。每篇按钮
显示已答数，顶部显示全卷进度，最后提交整卷统一评分。本次页面会话内切回
某篇会恢复其两栏位置和所选题号；刷新后恢复 SQLite 已保存的答案、笔记和用时，
从第一篇重新显示材料。参考答案另外展开，不放入当前篇默认阅读范围。
原文件入口保留完整排版和整理者标识，也可能包含原卷附录或答案。

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
可选起始 `page`、结束 `endPage` 与提取的 `content`。同一原文件可有多个 Passage 视图。

每套清单可另含 `readingPassages`。其中 `documents[].documentIndex` 是该套
`documents` 数组中从 0 开始的索引，必须指向 `role: questions`；导入时转换为
本机上传 URL。范围使用 PDF 实际文件页码，首尾均包含，不能使用印刷页码替代。
`questionIds` 引用已存在的原题 ID，各篇联合覆盖整套已导入题目且不能重复分配，
同一乱序答案组必须留在同一篇。原文和题目位于不同 PDF 时，一篇可关联多个范围。

以下是清单字段片段，只展示分组元数据，不含试题或答案内容：

```json
{
  "readingPassages": [
    {
      "id": "passage-1",
      "label": "Passage 1",
      "documents": [
        { "documentIndex": 0, "page": 2, "endPage": 4, "label": "阅读材料" },
        { "documentIndex": 1, "page": 4, "endPage": 6, "label": "题目" }
      ],
      "questionIds": ["q1", "q2"]
    }
  ]
}
```

```powershell
node scripts/import-private-pack.cjs C:\path\to\reviewed-private-pack.json
```

启动应用建立数据库后再导入。导入前验证文件哈希与题目，建立 SQLite 一致性
安全快照，再以事务添加 Source Materials 和 Practice Sets。同字节 PDF 在多个
题本/答案视图中只存一份。同一题本改名后重新提供也会按文件与题目身份去重。
再次执行同一清单跳过已安装练习；同 ID 的文件或答案
发生变化会拒绝替换，保护既有 Practice Attempts。事务失败会回滚数据和新复制文件。

原文件仍在用户提供的位置，工作台使用 `data/uploads` 内的私人副本。恢复完整
JSON 备份时一并保留个人资料元数据、全部本地附件引用及学习记录；恢复前校验
篇章题目覆盖及嵌套 PDF 引用。未含分篇字段的旧资源仍可读取。

## Reviewed metadata backfill

已有套卷的题目和学习记录不通过重新导入来覆盖。为其添加分篇或修正页码，使用
`scripts/backfill-reading-passages.cjs` 与私人核对映射。映射格式为
`ielts-studio-reading-passages`、`version: 1`，每套包含：

- `id` 与 `questionsSha256`：后者是数据库现存 `questions_json` 原样 UTF-8 字符串的 SHA-256。
- `files: [{sha256, totalPages}]`：已核对原件的哈希及实际 PDF 总页数。
- 可选 `questionDocuments: [{documentIndex, sha256, page, endPage}]`：修正现有题目视图的锚点；此索引对应已安装资源的 `questionDocuments`。
- `readingPassages: [{id, label, questionIds, documents: [{sha256, page, endPage, label}]}]`：用原件哈希关联本机 PDF，适用于上传 ID 不同的安装目录。

```powershell
node scripts/backfill-reading-passages.cjs C:\path\to\reviewed-reading-metadata.json --dry-run
node scripts/backfill-reading-passages.cjs C:\path\to\reviewed-reading-metadata.json
```

`--dry-run` 只验证并报告。正式回填先检查所有题目、原件哈希、页范围和题目归属，
建立 SQLite 安全快照，然后在一个事务中只更新 `practice_sets.resource_json`。
原题、答案、Attempt、草稿和附件均不重建；重复执行跳过相同映射。原件、题目
或已有分篇映射变化时拒绝静默覆盖；事务失败会回滚。映射和提取文本留在私人存储。

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
