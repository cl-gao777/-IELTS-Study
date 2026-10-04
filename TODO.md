# 后续增强（P1 / P2）

当前可用功能、数据边界和验证见 [IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。以下是尚未交付的增强项。

## P1：AI 与学习内容增强

- [ ] 把可选 AI 题目生成从上游的三种题型扩展到手工编辑器支持的全部题型；增加生成前预览、逐题编辑和 evidence 质量检查。
- [ ] 词汇 AI enrichment：按来源句补充释义、IPA、搭配和词族，允许逐项接受并记录来源；现在这些字段通过手工编辑维护。
- [ ] Tutor 进一步关联当前选题、选中段落与语法错误，提供更细的引用和检索边界；保持当前有限上下文，不发送整库。
- [ ] 扩展跨题型练习模板、成套题目 JSON 导入导出与批量编辑。当前可逐题手工录入或使用可选 AI 生成。
- [ ] CSV / Markdown 学习数据导出；现有完整 JSON 和 SQLite/附件备份继续作为恢复依据。
- [ ] 个性化 FSRS 参数拟合及 retention 设置；现有确定性 FSRS 使用统一目标 retention。

## P2：高级训练与桌面分发

- [ ] Whisper / faster-whisper / whisper.cpp 本地转写及句级时间戳；当前本地音频与手动 Transcript 不依赖转写。
- [ ] 句级自动切分、逐句 Shadowing 和发音分析；当前 AB 循环可用于人工跟读。
- [ ] Speaking 与语音录制/评估，不影响 Reading / Listening / Writing 的本地使用。
- [ ] 扫描 PDF 的本地 OCR、复杂版式题库的结构解析。
- [ ] 完整 IELTS 模考增强：更严格的分阶段计时、题型版式、多空/多选组合规则及审核过的许可材料。
- [ ] 桌面安装包、自动更新、数据库迁移演练与大型附件的增量备份。
