import assert from "node:assert/strict";
import {
  classifyCard,
  marketingTitle,
  CONTENT_TYPES,
  isCommercialUrl,
  normalizeKeywords,
  cardKey,
} from "../src/core/filter/rules.ts";
import {
  learningLocked,
  learningRemaining,
  refreshLearning,
} from "../src/core/learning/session.ts";
import { applyUsageTick } from "../src/core/usage/record.ts";
const options = {
  hideAds: true,
  hideLiveCards: true,
  hiddenBadges: [],
  matchMode: "any",
  hiddenTypes: [...CONTENT_TYPES],
  hideMarketing: true,
  exceptions: [],
};
const base = {
  key: "video",
  url: "https://www.bilibili.com/video/BV1TEST",
  title: "正常教学",
  badges: [],
  ad: false,
  live: false,
  commercial: false,
};
for (const title of [
  "盗月社美食探店：本期由汽车品牌赞助",
  "广告行业观察",
  "AI课程学习心得",
  "保健品骗局分析",
  "程序员学Agent Skills",
  "课程限时报名骗局揭秘",
  "不要购买保健品",
  "只要一个小火箭",
])
  assert.equal(classifyCard({ ...base, title }, options), null, title);
for (const type of CONTENT_TYPES) {
  assert.equal(
    classifyCard({ ...base, badges: [type] }, options)?.reason,
    "内容类型",
  );
  assert.equal(
    classifyCard({ ...base, title: `${type}幕后分析` }, options),
    null,
  );
  assert.equal(
    classifyCard({ ...base, badges: [type] }, { ...options, hiddenTypes: [] }),
    null,
  );
}
assert.ok(CONTENT_TYPES.includes("课堂"), "内容类型应包含课堂");
assert.ok(CONTENT_TYPES.includes("赛事"), "内容类型应包含赛事");
assert.equal(classifyCard({ ...base, ad: true }, options)?.reason, "广告");
assert.equal(classifyCard({ ...base, live: true }, options)?.reason, "直播");
assert.equal(
  classifyCard({ ...base, title: "AI训练营限时报名" }, options)?.reason,
  "营销",
);
assert.equal(marketingTitle("课程私信报名"), true);
assert.equal(marketingTitle("保健品七天见效"), false);
assert.equal(isCommercialUrl("https://www.bilibili.com/video/BV1TEST"), false);
assert.equal(isCommercialUrl("https://example.org/free-course"), false);
assert.equal(
  isCommercialUrl("https://www.bilibili.com/blackboard/activity.html"),
  false,
);
assert.equal(isCommercialUrl("https://item.jd.com/123.html"), true);
assert.equal(
  classifyCard({ ...base, commercial: true }, options)?.reason,
  "营销",
);
assert.equal(
  classifyCard(
    { ...base, title: "AI训练营限时报名" },
    { ...options, hideMarketing: false },
  ),
  null,
);
const words = { ...options, hiddenBadges: ["犯罪", "案件"] };
assert.equal(
  classifyCard({ ...base, title: "犯罪心理学" }, words)?.reason,
  "关键词",
);
assert.equal(
  classifyCard(
    { ...base, title: "犯罪心理学" },
    { ...words, matchMode: "all" },
  ),
  null,
);
assert.equal(
  classifyCard(
    { ...base, title: "犯罪案件分析" },
    { ...words, matchMode: "all" },
  )?.reason,
  "关键词",
);
assert.equal(
  classifyCard({ ...base, ad: true }, { ...words, exceptions: [base.key] }),
  null,
);
assert.deepEqual(normalizeKeywords("犯罪，\n案件, ,犯罪"), ["犯罪", "案件"]);
assert.equal(classifyCard(base, { ...options, hiddenBadges: ["", " "] }), null);
assert.equal(
  classifyCard(
    { ...base, title: "正常教学" },
    { ...options, hiddenBadges: [".*"] },
  ),
  null,
);
assert.equal(
  cardKey("https://www.bilibili.com/video/BV1TEST/?p=3"),
  cardKey("https://www.bilibili.com/video/BV1TEST"),
);
const session = {
  id: "test",
  active: true,
  completed: false,
  startedAt: 1000,
  targetSeconds: 600,
  elapsedSeconds: 0,
  allowedVideos: [],
  lastCountedAt: 1000,
  updatedAt: 1000,
};
assert.equal(learningRemaining(session, 301000), 300);
assert.equal(learningLocked(session, 601000), false);
assert.equal(refreshLearning(session, 601000).completed, true);
assert.equal(
  learningLocked({ ...session, completed: true }, 301000),
  true,
  "不能依靠缓存completed绕过时间",
);
const now = new Date();
now.setHours(9, 59, 58, 0);
now.setDate(now.getDate() - 1);
const t = now.getTime();
const usage = { days: {}, months: {} };
applyUsageTick(usage, {
  seconds: 5,
  recordedAt: t + 5000,
  study: true,
  live: false,
});
applyUsageTick(usage, {
  seconds: 5,
  recordedAt: t + 5000,
  study: true,
  live: false,
});
const day = Object.values(usage.days)[0];
assert.equal(day.hours[9].totalSeconds, 2);
assert.equal(day.hours[10].totalSeconds, 3);
assert.equal(day.hours[10].studySeconds, 3);
applyUsageTick(usage, {
  seconds: 5,
  recordedAt: t + 7000,
  study: false,
  live: true,
});
assert.equal(day.hours[10].totalSeconds, 5, "重叠窗口不能重复累计");
assert.equal(day.hours[10].liveSeconds, 5);
assert.equal(Object.values(usage.months)[0].totalSeconds, 7);
const before = JSON.stringify(usage);
applyUsageTick(usage, {
  seconds: NaN,
  recordedAt: t,
  study: false,
  live: false,
});
assert.equal(JSON.stringify(usage), before);
console.log(
  "Filter/session/usage tests passed: 保留赞助、九类角标、营销反例、关键词、例外、客观时间与跨窗口去重/跨时段分桶。",
);
