import type { AppSettings } from "../types/settings";

export const CONTENT_TYPES = [
  "番剧",
  "国创",
  "纪录片",
  "电影",
  "电视剧",
  "综艺",
  "漫画",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export type FilterReason = "广告" | "直播" | "内容类型" | "营销" | "关键词";
export interface CardEvidence {
  key: string;
  title: string;
  url: string;
  badges: string[];
  ad: boolean;
  live: boolean;
  commercial: boolean;
}
export interface FilterRecord {
  key: string;
  title: string;
  url: string;
  reason: FilterReason;
  detail: string;
}
export interface FilterReport {
  pageUrl: string;
  enabled: boolean;
  checked: number;
  counts: Record<FilterReason, number>;
  hidden: FilterRecord[];
}
export const emptyCounts = (): FilterReport["counts"] => ({
  广告: 0,
  直播: 0,
  内容类型: 0,
  营销: 0,
  关键词: 0,
});
export function normalizeKeywords(input: string | string[]): string[] {
  const text = Array.isArray(input) ? input.join("\n") : input;
  return [
    ...new Set(
      text
        .split(/[,，\n]+/)
        .map((word) => word.trim())
        .filter(Boolean),
    ),
  ].slice(0, 100);
}
export function contentType(text: string): ContentType | undefined {
  const value = text.replace(/\s/g, "");
  if (value === "国产动画") return "国创";
  return CONTENT_TYPES.find((type) => type === value);
}
export function cardKey(raw: string): string {
  try {
    const url = new URL(raw, "https://www.bilibili.com");
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    // Video exceptions cover all parts; commercial query strings retain their identity.
    if (/^\/video\/BV[\da-z]+\/?$/i.test(url.pathname))
      return url.origin + url.pathname.replace(/\/$/, "");
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}
export function isCommercialUrl(raw: string): boolean {
  try {
    const u = new URL(raw, "https://www.bilibili.com");
    // An external link, an event page or a redirect alone is NOT commercial evidence.
    return (
      (/^(mall|show)\.bilibili\.com$/.test(u.hostname) &&
        /\/(detail|goods|shop|platform\/detail)/.test(u.pathname)) ||
      /^(item\.taobao\.com|detail\.tmall\.com|item\.jd\.com)$/.test(u.hostname)
    );
  } catch {
    return false;
  }
}
export function marketingTitle(title: string): boolean {
  if (
    /(骗局|避坑|揭秘|套路|诈骗|打假|辟谣|不要买|别买|勿买|劝退|勿报名|不要报名|别报名|不卖课|不带货)/.test(
      title,
    )
  )
    return false;
  const object =
    /(课程|训练营|付费课|私教|陪跑|保健品|营养品|减肥产品|护肝产品|相亲小程序|婚恋小程序)/.test(
      title,
    );
  const action =
    /(立即购买|点击购买|下单|限时报名|报名咨询|开始报名|报名中|课程优惠|私信.{0,8}(报名|购买|咨询)|加群.{0,8}(购买|报名)|领取优惠|限时优惠|购买完整版)/.test(
      title,
    );
  return object && action;
}
export function classifyCard(
  card: CardEvidence,
  options: AppSettings["interfaceOptimization"],
): FilterRecord | null {
  if (options.exceptions.includes(card.key)) return null;
  const result = (reason: FilterReason, detail: string): FilterRecord => ({
    key: card.key,
    title: card.title || "未读取到标题",
    url: card.url,
    reason,
    detail,
  });
  if (options.hideAds && card.ad) return result("广告", "卡片广告标记");
  if (options.hideLiveCards && card.live)
    return result("直播", "直播卡片或直播间链接");
  const type = card.badges
    .map(contentType)
    .find((type) => type && options.hiddenTypes.includes(type));
  if (type) return result("内容类型", `类型角标：${type}`);
  if (options.hideMarketing && (card.commercial || marketingTitle(card.title)))
    return result(
      "营销",
      card.commercial
        ? "明确商品链接或销售按钮"
        : "标题包含销售对象与明确购买引导",
    );
  const words = normalizeKeywords(options.hiddenBadges).map((word) =>
    word.toLowerCase(),
  );
  const title = card.title.toLowerCase();
  if (
    words.length &&
    (options.matchMode === "all"
      ? words.every((w) => title.includes(w))
      : words.some((w) => title.includes(w)))
  )
    return result("关键词", "标题命中自定义关键词");
  return null;
}
