import assert from "node:assert/strict";

const data = {};
let messageListener;

globalThis.chrome = {
  action: {
    setBadgeBackgroundColor: async () => undefined,
    setBadgeText: async () => undefined,
  },
  alarms: {
    get: async () => null,
    create: async () => undefined,
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
globalThis.fetch = async () => ({
  ok: true,
  text: async () => `<!doctype html><html><head>
    <meta property="og:title" content="测试视频标题_哔哩哔哩_bilibili">
    <meta property="og:image" content="https://i0.hdslb.com/test-cover.jpg">
    <meta name="author" content="测试UP主">
  </head></html>`,
});

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

console.log("Background runtime test passed: 消息响应与队列元数据补全正常。");
