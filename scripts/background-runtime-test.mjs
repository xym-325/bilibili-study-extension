import assert from "node:assert/strict";

const data = {};
let messageListener;
const alarms = [];
let fetchCalls = 0;

globalThis.chrome = {
  action: {
    setBadgeBackgroundColor: async () => undefined,
    setBadgeText: async () => undefined,
  },
  alarms: {
    get: async () => null,
    create: async (name, options) => {
      alarms.push({ name, ...options });
    },
    onAlarm: { addListener: () => undefined },
  },
  idle: {
    setDetectionInterval: () => undefined,
    queryState: async () => "active",
    onStateChanged: { addListener: () => undefined },
  },
  runtime: {
    onMessage: {
      addListener: (listener) => {
        messageListener = listener;
      },
    },
    onInstalled: { addListener: () => undefined },
    onStartup: { addListener: () => undefined },
    openOptionsPage: async () => undefined,
  },
  storage: {
    local: {
      get: async (key) => {
        if (key === null) return { ...data };
        if (typeof key === "string") return { [key]: data[key] };
        return { ...data };
      },
      set: async (values) => Object.assign(data, values),
      clear: async () => {
        for (const key of Object.keys(data)) delete data[key];
      },
    },
  },
  tabs: {
    query: async () => [],
    sendMessage: async () => undefined,
  },
};
globalThis.fetch = async () => {
  fetchCalls++;
  return {
    ok: true,
    text: async () => `<!doctype html><html><head>
    <meta property="og:title" content="测试视频标题_哔哩哔哩_bilibili">
    <meta property="og:image" content="https://i0.hdslb.com/test-cover.jpg">
    <meta name="author" content="测试UP主">
  </head></html>`,
  };
};

const workerUrl = new URL("../dist/service-worker-loader.js", import.meta.url);
workerUrl.searchParams.set("test", String(Date.now()));
await import(workerUrl.href);
assert.equal(typeof messageListener, "function", "后台没有注册消息监听器");

async function request(message) {
  return new Promise((resolve, reject) => {
    const payload = typeof message === "string" ? { type: message } : message;
    const keepAlive = messageListener(payload, {}, (response) => {
      if (!response?.ok) reject(new Error(response?.error?.message));
      else resolve(response.data);
    });
    assert.equal(keepAlive, true, `${payload.type} 没有保持异步消息通道`);
  });
}

await Promise.all([
  request("GET_SETTINGS"),
  request("GET_USAGE_SUMMARY"),
  request("LIST_QUEUE"),
  request("LIST_BOOKMARKS"),
  request("LIST_PROGRESS"),
  request("GET_LEARNING_SESSION"),
]);

const queueItem = await request({
  type: "ADD_QUEUE_ITEM",
  item: {
    bvid: "BV1TEST12345",
    url: "https://www.bilibili.com/video/BV1TEST12345",
    title: "BV1TEST12345",
    status: "later",
  },
});
assert.equal(queueItem.title, "测试视频标题");
assert.equal(queueItem.uploader, "测试UP主");
assert.equal(queueItem.coverUrl, "https://i0.hdslb.com/test-cover.jpg");

const config = await request("GET_SETTINGS");
assert.equal(config.features["watch-time"], true, "新安装统计默认开启");
assert.equal(config.features["watch-queue"], true);
await request({
  type: "PATCH_SETTINGS",
  patch: { features: { "watch-time": false } },
});
assert.equal(
  (await request("GET_SETTINGS")).features["watch-time"],
  false,
  "保留用户主动关闭统计的选择",
);
await request({
  type: "PATCH_SETTINGS",
  patch: {
    interfaceOptimization: {
      hiddenBadges: ["犯罪", ""],
      hiddenTypes: ["国创"],
      hideMarketing: true,
    },
  },
});
assert.deepEqual(
  (await request("GET_SETTINGS")).interfaceOptimization.hiddenBadges,
  ["犯罪"],
);
const beforeFetch = fetchCalls;
await request({
  type: "ADD_QUEUE_ITEM",
  item: {
    bvid: "BV1KNOWN123",
    url: "https://www.bilibili.com/video/BV1KNOWN123",
    title: "已知标题",
    coverUrl: "https://i0.hdslb.com/known.jpg",
    status: "later",
  },
});
assert.equal(fetchCalls, beforeFetch, "页面已有标题封面时不额外请求");
const realNow = Date.now;
let now = realNow();
Date.now = () => now;
await assert.rejects(
  request({
    type: "START_LEARNING_SESSION",
    durationMinutes: NaN,
    queueItemIds: [queueItem.id],
  }),
);
const results = await Promise.allSettled([
  request({
    type: "START_LEARNING_SESSION",
    durationMinutes: 10,
    queueItemIds: [queueItem.id],
  }),
  request({
    type: "START_LEARNING_SESSION",
    durationMinutes: 10,
    queueItemIds: [queueItem.id],
  }),
]);
assert.equal(
  results.filter((r) => r.status === "fulfilled").length,
  1,
  "并发启动仅允许一个会话",
);
assert.ok(alarms.some((a) => a.name === "bse.learning-end"));
await assert.rejects(request("STOP_LEARNING_SESSION"), /结束前/);
await assert.rejects(
  request({ type: "CLEAR_DATA_SECTION", section: "settings" }),
  /学习时间/,
);
now += 5 * 60000;
const half = await request("GET_LEARNING_SESSION");
assert.equal(half.elapsedSeconds, 300, "没有页面心跳也按真实时间推进");
await request({
  type: "SET_LEARNING_LAST_URL",
  url: "https://www.bilibili.com/video/BV1TEST12345?p=3",
});
assert.ok(
  (await request("GET_LEARNING_SESSION")).lastLearningUrl.endsWith("?p=3"),
);
await request({
  type: "SET_LEARNING_LAST_URL",
  url: "https://www.bilibili.com/video/BV1NOTALLOWED",
});
assert.ok(
  (await request("GET_LEARNING_SESSION")).lastLearningUrl.endsWith("?p=3"),
);
now += 5 * 60000;
assert.equal((await request("GET_LEARNING_SESSION")).completed, true);
await request("STOP_LEARNING_SESSION");
assert.equal(await request("GET_LEARNING_SESSION"), null);
Date.now = realNow;
const exported = await request("EXPORT_ALL_DATA");
const snapshot = JSON.stringify(data);
await assert.rejects(
  request({ type: "IMPORT_ALL_DATA", data: { schemaVersion: 2 } }),
);
assert.equal(JSON.stringify(data), snapshot, "无效导入不改变数据");
assert.equal(exported.settings.interfaceOptimization.hideMarketing, true);
console.log(
  "Background runtime test passed: 默认值、设置保留、队列元数据、并发学习启动、真实时间到期、分P及导入无损校验。",
);
