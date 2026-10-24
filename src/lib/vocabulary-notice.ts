export type VocabularyNotice = { kind: "success" | "attention"; text: string };

// Unknown notices must stay visible. Only complete, known confirmations can be
// moved out of the learning card; an extra warning suffix invalidates a match.
const successMessages = new Set([
  "已核对：上次学习选择已保存，没有重复处理。",
  "已核对：上次评分已保存，没有重复提交。",
  "已核对：开始练习的结果已保存，已读取最新一轮。",
  "已切换练习方式，原词本轮暂缓，没有评分。",
  "已暂缓此词，没有改变熟练度或原复习安排。",
  "本轮已结束，已保存评分保留。浏览课程或词条不产生评分。",
  "已学习，1 分钟后的首次回忆已安排。这次学习没有计入答题成绩。",
  "已学习，1 分钟后的首次回忆已安排，没有计入答题成绩。",
  "已确认学习这个用法，1 分钟后的语境巩固已安排；原复习计划保持不变。",
  "已保存“这个用法已会”的自报选择，不计为答对或实测掌握。",
  "已暂停整个词，各课程都不再安排；原历史和 FSRS 保留。",
  "已恢复学习，后续按现有计划安排。",
  "已核对：学习选择已经保存，没有重复处理。",
  "已核对：评分已保存，没有重复提交。",
  "该词已存在，原词条与复习进度保留。",
  "词条已更新，复习进度保留。",
  "新词已加入，下一轮先学习再回忆。",
  "新增课程已开启。返回学习后可开始，原有到期词仍优先。",
  "已暂停新增词，原有到期词继续复习。",
]);

const supplementalSaved = /^(?:用法巩固|追加练习)已保存，复习计划保持不变。$/u;
const supplementalVerified = /^已核对：(?:上次)?(?:用法巩固|追加练习)已保存，复习计划保持不变。$/u;
// The client's zh-CN date contains only date/time digits and separators. Never
// accept an unrestricted suffix here: it could be an appended failure notice.
const reviewSaved = /^评分已保存，下次复习：[0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2} [0-9]{1,2}:[0-9]{2}:[0-9]{2}。(?:可以再练一句，这次练习不会重复安排复习。)?$/u;

export function vocabularyNotice(message: string): VocabularyNotice | null {
  const text = message.trim();
  if (!text) return null;
  const success = successMessages.has(text) || supplementalSaved.test(text)
    || supplementalVerified.test(text) || reviewSaved.test(text);
  return { kind: success ? "success" : "attention", text };
}
