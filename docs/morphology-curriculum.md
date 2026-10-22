# 词根词缀系统课程：内容、核对与许可

课程文件为 `src/data/morphology-curriculum.json`，内容版本 2。首批包含 160 课：80 个词根主题、40 个前缀主题、40 个后缀主题，482 个关联词义位，合计 463 个不同的“词＋词性＋具体义项”，每个词义有两条不同语境例句。跨课复用同义项时沿用相同词义与例句 ID，因此总句位为 964，不等于 964 条互不重复的句子。

这是 IELTS Studio 编写的构词学习课程，不是官方雅思考纲，也不声称课程词汇会在特定考试中出现。课程独立于词汇 FSRS；仅在学习者逐词明确选择加入后，才由应用处理词汇待学关联。

## 资料来源与改写边界

构词分类参考 [Cambridge English Grammar Today：Word formation](https://dictionary.cambridge.org/us/grammar/british-grammar/word-formation_2)。这里只引用分类事实，未复制 Cambridge 的讲解、练习或例句。

每个整词或必要基词的词源证据来自 **Wiktionary contributors**。`scripts/morphology-source-manifest.json` 保留实际获取的词条修订号、源修订时间、核对日期、语言分节与词源／释义摘录；课程逐项提供带 `oldid` 的链接，可回到实际核对的修订及其编辑历史。英语整词条目使用 English 分节，必要时追溯 Latin 基词，不把“网址存在”当成词源关系成立。

**该 manifest 本身包含词典文本摘录**，按 CC BY-SA 4.0 使用并保留逐词条署名和修订链接。课程的中文概述、限制、解释与新补英文释义为原创改写。词典中的外部书刊引句、图片、录音没有复制进课包。Wiktionary 的外部引用材料可能另有权利，不能由本课包许可推定其可复用，参见 [Wiktionary 复用说明](https://en.wiktionary.org/wiki/Wiktionary:Copyrights)。

一部分词汇资料复用公开 `src/data/vocabulary-catalog.json` 中已发布的原创中文学习释义和原创例句。其 NGSL 1.2／NAWL 1.2 英文释义来源为 **Charles Browne、Brent Culligan、Joseph Phillips / New General Service List Project**，许可及原始来源见 [公开词汇课包许可](../src/data/VOCABULARY-LICENSE.md)、[NGSL](https://www.newgeneralservicelist.com/new-general-service-list)、[NAWL](https://www.newgeneralservicelist.com/new-academic-word-list)。259 个词条采用本次原创补充或订正，记录在 `scripts/morphology-authored-words.tsv`；其余沿用经过本次逐义复核的公开课包资料。本课包不读取私人 PDF、私人阅读原句或个人学习记录。

## 等级与基础示例

只有已核对的 **Oxford 3000／5000 官方 PDF 词＋词性事实**才登记 B2/C1，出处、页码与源文件 SHA 保留在 `scripts/morphology-cefr-facts.json` 及每词 `levelSource`。该标注不声称对本课具体义项另作了 CEFR 定级。实际 463 个不同词义中，94 个词＋词性有 B2 依据，39 个有 C1 依据，330 个没有本次可核等级。

**未核定级不等于基础词。** 生僻的医学或法律词可能没有在这两份词表中出现。56 个明确基础词仅标为构词示例；课程不以词频或字母排序推断其他词的难度，也不自动将例词加入个人待学队列。

## 重要核对决定

- 拉丁 regō／分词 rēctus 对应的 reg-/rect- 合并为一课，不拆成两个根凑数；原位置改为独立 rupt- 词根。
- `livelihood` 不是普通的 -hood 派生词，已从该课关联词中删除，改用 `adulthood`。-hood 的限制仍解释这个反例。
- -cy/-acy、-ous/-ious、-ory/-tory/-atory 以及 -ion/-tion/-sion/-ation 等变体合课，明确截尾、词干变化和历史借词限制。
- `hypoglycaemia` 与 `modernise` 等拼写转引继续核对 canonical 词条；-ing 名词同时核对名词释义、基词与 -ing 的名词功能。
- `pro-environmental` 整词条目未被 Wiktionary 收录，按已核对的 pro-（支持）和 environmental 解释为现代可产构词，不伪造整词出处。
- 例句按具体义项统一。例如 reception 为信号接收；illuminate 为阐明；prescribe 为正式规定；morphology 为生物形态研究；deposit 为订金。不得把两个义项各一条例句冒充同义项的两句覆盖。
- 构词部件卡不把任意剩余字母编造成有含义的词根；历史词干与现代派生在关系标签和解释中区分。

## 内容许可

`src/data/morphology-curriculum.json`、本课程原创讲解和例句、`scripts/morphology-authored-words.tsv`、教学说明、构词干扰项、词源 manifest 摘录及其改编内容统一按 **[Creative Commons Attribution–ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)** 分发。署名为 **IELTS Studio contributors, 2026; adapted with attribution to Wiktionary contributors and the New General Service List Project**。允许在遵守署名、许可链接、标明修改及相同方式共享等条件下复制和改编；许可不表示上述机构认可本应用。

本课包的内容许可与应用程序代码许可分别适用，不更改软件许可，也不授权传播私人阅读材料、个人笔记、学习历史或密钥。

## 离线再现与验证

在项目根目录运行：

```sh
node scripts/morphology-build.cjs
node --experimental-strip-types scripts/morphology-validate.mjs
```

普通构建只读取公开、已核对的本地文件，不联网、不写数据库。`--refresh-evidence` 仅供维护者从已经下载的真实 MediaWiki 修订响应重建 manifest；它不能替代内容核对。改变义项、题目或构词事实时必须重新审阅并提升对应课程版本，保持旧学习历史冻结。

机器计数与版本校验见 `docs/morphology-content-audit.json`；机器校验不代替语义、词源关系、干扰项和例句的人工审阅。
