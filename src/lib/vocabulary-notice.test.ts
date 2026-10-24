import { describe, expect, it } from "vitest";
import { vocabularyNotice } from "./vocabulary-notice";

describe("vocabulary notice visibility", () => {
  it.each(["", " ", "\n\t"])("omits empty messages %j", (message) => {
    expect(vocabularyNotice(message)).toBeNull();
  });

  it.each([
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
  ])("recognises the complete confirmation %s", (message) => {
    expect(vocabularyNotice(message)).toEqual({ kind: "success", text: message });
    expect(vocabularyNotice(`${message} 请同步后继续。`)?.kind).toBe("attention");
  });

  it.each(["用法巩固", "追加练习"])("recognises saved %s without confusing unsaved verification", (label) => {
    for (const message of [
      `${label}已保存，复习计划保持不变。`,
      `已核对：${label}已保存，复习计划保持不变。`,
      `已核对：上次${label}已保存，复习计划保持不变。`,
    ]) expect(vocabularyNotice(message)?.kind).toBe("success");
    expect(vocabularyNotice(`已核对：这次${label}尚未保存。可重试保存，仍使用原练习结果和同一提交编号。`)?.kind).toBe("attention");
  });

  it("accepts the exact saved review date with its optional practice invitation", () => {
    const message = `评分已保存，下次复习：${new Date("2030-01-02T03:04:05Z").toLocaleString("zh-CN")}。`;
    expect(vocabularyNotice(message)).toEqual({ kind: "success", text: message });
    expect(vocabularyNotice(`${message}可以再练一句，这次练习不会重复安排复习。`)?.kind).toBe("success");
    for (const changed of [
      `${message}下一题加载失败。`,
      "评分已保存，下次复习：请刷新。",
      "评分已保存，下次复习：Invalid Date。",
      "评分已保存，下次复习：2030/1/2 03:04:05。请同步。",
    ]) expect(vocabularyNotice(changed)?.kind).toBe("attention");
  });

  it.each([
    "已核对：这次评分尚未保存。可重试保存，仍使用原评分和同一提交编号。",
    "已核对：这次学习选择尚未保存，可重试原操作。",
    "上次学习选择尚未保存，已保留原操作，可核对后重试。",
    "上次评分尚未保存。当前回答已保留，可重试保存原评分。",
    "已保存部分内容，仍有评分尚未保存。",
    "已完成请求，但响应不明，请先查询记录。",
    "学习选择的保存状态尚未确认。原操作仍保留，请先核对保存状态。",
    "词条或复习安排已经更新，请同步词卡后继续；旧答案尚未评分。",
    "本轮状态已在其他页面更新，已读取最新记录；原操作没有继续提交。",
    "用法或学习状态已更新，原操作不再提交，没有新增学习记录。",
    "旧词卡已同步并暂缓，原回答尚未评分。",
    "连接中断，草稿保留在本机。恢复连接后请重试保存。",
    "评分保存状态尚未确认。当前回答仍保留，请核对保存状态或重试原评分。",
    "复习状态已经更新，原请求不再提交；没有追加评分。",
    "暂时无法核对评分是否保存。请恢复连接后再核对；不会自动重新提交。",
    "复习状态加载失败，请重试。",
    "下一张词卡暂时无法读取，请重试。",
    "已恢复备份，请刷新旧页面。",
    "新的未知消息",
  ])("keeps warnings and unknown messages visible: %s", (message) => {
    expect(vocabularyNotice(message)).toEqual({ kind: "attention", text: message });
  });

  it("trims outer whitespace without rewriting warning content", () => {
    expect(vocabularyNotice("  尚未保存，请重试。\n")).toEqual({ kind: "attention", text: "尚未保存，请重试。" });
  });
});
