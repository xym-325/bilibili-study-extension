import {
  DEFAULT_SETTINGS,
  MAINTENANCE_ALARM,
  STORAGE_KEYS,
} from "../core/config/defaults";
import {
  pageKindFromUrl,
  parseBvid,
  parseCheeseEpisodeId,
} from "../core/page/detect";
import {
  clearStored,
  getStored,
  setStored,
} from "../core/storage/chrome-store";
import type {
  AppDataExport,
  AppNotice,
  ClearableDataSection,
  ClipBookmark,
  CourseProgress,
  DailyUsageRecord,
  LearningSession,
  MonthlyUsageRecord,
  PageSnapshot,
  PlayerSnapshot,
  QueueItem,
  UsageBucket,
  UsageStore,
  UsageSummary,
} from "../core/types/domain";
import type {
  AddBookmarkInput,
  AddQueueInput,
  ExtensionMessage,
  MessageResponse,
} from "../core/types/messages";
import type { AppSettings, SettingsPatch } from "../core/types/settings";

const emptyBucket = (): UsageBucket => ({
  totalSeconds: 0,
  studySeconds: 0,
  liveSeconds: 0,
});
const emptyUsage = (): UsageStore => ({ days: {}, months: {} });
let systemState: "active" | "idle" | "locked" = "active";
let usageMutation: Promise<void> = Promise.resolve();
const makeId = (prefix: string) =>
  `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
function localDate(timestamp = Date.now()): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const localMonth = (timestamp = Date.now()) => localDate(timestamp).slice(0, 7);
const emptyDay = (date: string): DailyUsageRecord => ({
  date,
  hours: Array.from({ length: 24 }, emptyBucket),
});

function mergeSettings(
  current: AppSettings,
  patch: SettingsPatch,
): AppSettings {
  const next = structuredClone(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const base = next[key as keyof AppSettings];
      Object.assign(next, {
        [key]: { ...(typeof base === "object" ? base : {}), ...value },
      });
    } else if (value !== undefined) Object.assign(next, { [key]: value });
  }
  next.schemaVersion = 2;
  next.playerTools.shortcuts = {
    ...DEFAULT_SETTINGS.playerTools.shortcuts,
    ...next.playerTools.shortcuts,
  };
  return next;
}
async function settings(): Promise<AppSettings> {
  return mergeSettings(
    DEFAULT_SETTINGS,
    await getStored<SettingsPatch>(STORAGE_KEYS.settings, {}),
  );
}
async function saveSettings(value: AppSettings): Promise<AppSettings> {
  await setStored(STORAGE_KEYS.settings, value);
  await broadcast({ type: "SETTINGS_CHANGED", settings: value });
  return value;
}
async function broadcast(message: unknown): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: "https://*.bilibili.com/*" });
    await Promise.allSettled(
      tabs
        .filter((tab) => tab.id !== undefined)
        .map((tab) => chrome.tabs.sendMessage(tab.id!, message)),
    );
  } catch {
    /* Missing/revoked site access safely disables synchronization. */
  }
}
async function guardDestructive(): Promise<void> {
  const active = await getStored<LearningSession | null>(
    STORAGE_KEYS.learningSession,
    null,
  );
  if (active?.active && !active.completed)
    throw new Error("学习时间结束前只允许导出备份");
}
async function updateBadge(): Promise<void> {
  const queue = await getStored<QueueItem[]>(STORAGE_KEYS.queue, []);
  const count = queue.filter((item) => item.status === "needs-review").length;
  await chrome.action.setBadgeBackgroundColor({ color: "#fb7299" });
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
}

function migrateLegacySettings(value: unknown): AppSettings {
  if (!value || typeof value !== "object")
    return structuredClone(DEFAULT_SETTINGS);
  const legacy = value as Record<string, unknown>;
  if (legacy.schemaVersion === 2)
    return mergeSettings(DEFAULT_SETTINGS, legacy as SettingsPatch);
  const next = structuredClone(DEFAULT_SETTINGS);
  const enabled = legacy.featureEnabled as Record<string, boolean> | undefined;
  const map: Record<string, keyof AppSettings["features"]> = {
    "home-feed": "interface-optimization",
    "watch-time": "watch-time",
    "focus-mode": "learning-mode",
    "watch-queue": "watch-queue",
    "player-tools": "player-tools",
    "discussion-filter": "content-filter",
    "study-notes": "learning-library",
  };
  for (const [oldId, newId] of Object.entries(map))
    next.features[newId] = Boolean(enabled?.[oldId]);
  const queue = legacy.queue as Partial<AppSettings["queue"]> | undefined;
  if (queue) next.queue = { ...next.queue, ...queue };
  const discussion = legacy.discussion as { keywords?: string[] } | undefined;
  if (Array.isArray(discussion?.keywords))
    next.contentFilter.keywords = discussion.keywords;
  next.onboardingComplete = Boolean(legacy.onboardingComplete);
  return next;
}
function migrateLegacyUsage(value: unknown): UsageStore {
  if (!value || typeof value !== "object") return emptyUsage();
  const candidate = value as Partial<UsageStore> & {
    daily?: Record<string, { date?: string; seconds?: number }>;
  };
  if (candidate.days && candidate.months) return candidate as UsageStore;
  const result = emptyUsage();
  for (const [key, legacyDay] of Object.entries(candidate.daily ?? {})) {
    const date = legacyDay.date ?? key;
    const seconds = Math.max(0, Number(legacyDay.seconds) || 0);
    const day = emptyDay(date);
    day.hours[0].totalSeconds = seconds;
    result.days[date] = day;
    const monthKey = date.slice(0, 7);
    const month = result.months[monthKey] ?? {
      month: monthKey,
      ...emptyBucket(),
    };
    month.totalSeconds += seconds;
    result.months[monthKey] = month;
  }
  return result;
}
function migrateLegacyQueue(value: unknown): QueueItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"),
    )
    .map(
      (item) =>
        ({
          ...item,
          id: String(item.id ?? makeId("queue")),
          url: String(item.url ?? ""),
          title: String(item.title ?? "未命名视频"),
          status:
            item.status === "this-week" || item.status === "watching"
              ? "soon"
              : item.status === "completed" || item.status === "needs-review"
                ? item.status
                : "later",
          addedAt: Number(item.addedAt) || Date.now(),
          updatedAt: Number(item.updatedAt) || Date.now(),
          extensionCount: Number(item.extensionCount) || 0,
        }) as QueueItem,
    );
}
function migrateLegacyBookmarks(value: unknown): ClipBookmark[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"),
    )
    .map((item) => {
      const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
      const tag = tags.find((value) =>
        ["重点", "疑问", "待复习"].includes(value),
      );
      return {
        ...item,
        id: String(item.id ?? makeId("bookmark")),
        kind: item.kind === "segment" ? "segment" : "point",
        url: String(item.url ?? ""),
        title: String(item.title ?? "未命名视频"),
        name: String(item.name ?? "未命名标记"),
        startSeconds: Number(item.startSeconds) || 0,
        tag: tag as ClipBookmark["tag"],
        createdAt: Number(item.createdAt) || Date.now(),
        updatedAt: Number(item.updatedAt) || Date.now(),
      } as ClipBookmark;
    });
}
async function migrateStorage(): Promise<void> {
  const meta = await getStored<{ version?: number } | null>(
    STORAGE_KEYS.meta,
    null,
  );
  if (meta?.version === 2) return;
  const raw = await chrome.storage.local.get(null);
  try {
    const sourceSettings = raw[STORAGE_KEYS.settings] ?? raw.settings;
    const sourceQueue = raw[STORAGE_KEYS.queue] ?? raw.queue ?? [];
    const sourceBookmarks = raw[STORAGE_KEYS.bookmarks] ?? raw.bookmarks ?? [];
    const sourceNotices = (raw[STORAGE_KEYS.notices] ??
      raw.notices ??
      []) as AppNotice[];
    await chrome.storage.local.set({
      [STORAGE_KEYS.meta]: { version: 2, migratedAt: Date.now() },
      [STORAGE_KEYS.settings]: migrateLegacySettings(sourceSettings),
      [STORAGE_KEYS.usage]: migrateLegacyUsage(
        raw[STORAGE_KEYS.usage] ?? raw.watch,
      ),
      [STORAGE_KEYS.queue]: migrateLegacyQueue(sourceQueue),
      [STORAGE_KEYS.bookmarks]: migrateLegacyBookmarks(sourceBookmarks),
      [STORAGE_KEYS.progress]: raw[STORAGE_KEYS.progress] ?? [],
      [STORAGE_KEYS.notices]: Array.isArray(sourceNotices) ? sourceNotices : [],
    });
  } catch (error) {
    // Old keys remain untouched. All features start disabled until the data can be repaired.
    await chrome.storage.local.set({
      [STORAGE_KEYS.meta]: {
        version: 2,
        migrationError: String(error),
        failedAt: Date.now(),
      },
      [STORAGE_KEYS.settings]: structuredClone(DEFAULT_SETTINGS),
    });
  }
}

async function trimUsage(): Promise<void> {
  const usage = await getStored<UsageStore>(STORAGE_KEYS.usage, emptyUsage());
  const config = await settings();
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - config.watchTime.detailRetentionWeeks * 7);
  for (const date of Object.keys(usage.days))
    if (new Date(`${date}T00:00:00`).getTime() < cutoff.getTime())
      delete usage.days[date];
  await setStored(STORAGE_KEYS.usage, usage);
}
async function maintenance(): Promise<void> {
  const queue = await getStored<QueueItem[]>(STORAGE_KEYS.queue, []);
  const notices = await getStored<AppNotice[]>(STORAGE_KEYS.notices, []);
  const now = Date.now();
  let changed = false;
  for (const item of queue)
    if (
      item.status !== "completed" &&
      item.status !== "needs-review" &&
      item.dueAt !== undefined &&
      item.dueAt <= now
    ) {
      item.status = "needs-review";
      item.updatedAt = now;
      changed = true;
      if (
        !notices.some((notice) => notice.relatedId === item.id && !notice.read)
      )
        notices.push({
          id: makeId("notice"),
          level: "warning",
          title: "待看项目已到期",
          message: item.title,
          createdAt: now,
          read: false,
          relatedId: item.id,
        });
    }
  if (changed)
    await chrome.storage.local.set({
      [STORAGE_KEYS.queue]: queue,
      [STORAGE_KEYS.notices]: notices,
    });
  await trimUsage();
  await updateBadge();
}
async function ensureAlarm(): Promise<void> {
  if (!(await chrome.alarms.get(MAINTENANCE_ALARM)))
    await chrome.alarms.create(MAINTENANCE_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: 1440,
    });
}

async function recordUsage(
  seconds: number,
  at: number,
  study: boolean,
  live: boolean,
): Promise<void> {
  if (systemState === "locked") return;
  const safe = Math.max(0, Math.min(300, Math.round(seconds)));
  if (!safe) return;
  let effectiveSeconds = safe;
  let activeSession: LearningSession | null = null;
  if (study) {
    activeSession = await getStored<LearningSession | null>(
      STORAGE_KEYS.learningSession,
      null,
    );
    if (!activeSession?.active || activeSession.completed) return;
    const available = Math.max(
      0,
      Math.floor((Date.now() - activeSession.lastCountedAt) / 1000),
    );
    effectiveSeconds = Math.min(safe, available);
    if (!effectiveSeconds) return;
  }
  const config = await settings();
  if (config.features["watch-time"]) {
    const usage = await getStored<UsageStore>(STORAGE_KEYS.usage, emptyUsage());
    const date = localDate(at);
    const monthKey = localMonth(at);
    const hour = new Date(at).getHours();
    const day = usage.days[date] ?? emptyDay(date);
    const bucket = day.hours[hour] ?? emptyBucket();
    bucket.totalSeconds += effectiveSeconds;
    if (study) bucket.studySeconds += effectiveSeconds;
    if (live) bucket.liveSeconds += effectiveSeconds;
    day.hours[hour] = bucket;
    usage.days[date] = day;
    const month =
      usage.months[monthKey] ??
      ({ month: monthKey, ...emptyBucket() } satisfies MonthlyUsageRecord);
    month.totalSeconds += effectiveSeconds;
    if (study) month.studySeconds += effectiveSeconds;
    if (live) month.liveSeconds += effectiveSeconds;
    usage.months[monthKey] = month;
    await setStored(STORAGE_KEYS.usage, usage);
  }
  if (study && activeSession) {
    const now = Date.now();
    activeSession.elapsedSeconds = Math.min(
      activeSession.targetSeconds,
      activeSession.elapsedSeconds + effectiveSeconds,
    );
    activeSession.lastCountedAt = now;
    activeSession.completed =
      activeSession.elapsedSeconds >= activeSession.targetSeconds;
    activeSession.updatedAt = now;
    await setStored(STORAGE_KEYS.learningSession, activeSession);
    await broadcast({
      type: "LEARNING_SESSION_CHANGED",
      session: activeSession,
    });
  }
}
function enqueueUsage(
  seconds: number,
  at: number,
  study: boolean,
  live: boolean,
): Promise<void> {
  usageMutation = usageMutation.then(
    () => recordUsage(seconds, at, study, live),
    () => recordUsage(seconds, at, study, live),
  );
  return usageMutation;
}
function sumDays(days: DailyUsageRecord[]): UsageBucket {
  const out = emptyBucket();
  for (const day of days)
    for (const hour of day.hours) {
      out.totalSeconds += hour.totalSeconds;
      out.studySeconds += hour.studySeconds;
      out.liveSeconds += hour.liveSeconds;
    }
  return out;
}
async function usageSummary(): Promise<UsageSummary> {
  const usage = await getStored<UsageStore>(STORAGE_KEYS.usage, emptyUsage());
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (start.getDay() || 7) + 1);
  const currentWeek = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    const key = localDate(date.getTime());
    return usage.days[key] ?? emptyDay(key);
  });
  const today = usage.days[localDate()];
  return {
    today: today ? sumDays([today]) : emptyBucket(),
    currentWeek,
    recentWeeks: Object.values(usage.days).sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    months: Object.values(usage.months).sort((a, b) =>
      b.month.localeCompare(a.month),
    ),
    recording: systemState !== "locked",
  };
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .trim();
}
function attribute(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(
    new RegExp(`${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  return decodeHtml(match?.[1] ?? match?.[2] ?? "") || undefined;
}
function metaContent(html: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (attribute(tag, "property") === key || attribute(tag, "name") === key)
      return attribute(tag, "content");
  }
  return undefined;
}
function safeCoverUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
async function fetchQueueMetadata(
  input: Pick<QueueItem, "url" | "title" | "uploader" | "coverUrl">,
): Promise<Pick<QueueItem, "title" | "uploader" | "coverUrl">> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(input.url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`页面返回 ${response.status}`);
    const html = await response.text();
    const rawTitle =
      metaContent(html, "og:title") ??
      decodeHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
    const title = rawTitle
      .replace(/[_\-—|]\s*哔哩哔哩.*$/i, "")
      .replace(/_bilibili.*$/i, "")
      .trim();
    return {
      title: title || input.title,
      uploader:
        metaContent(html, "author") ??
        metaContent(html, "og:video:actor") ??
        input.uploader,
      coverUrl: safeCoverUrl(metaContent(html, "og:image") ?? input.coverUrl),
    };
  } catch {
    return {
      title: input.title,
      uploader: input.uploader,
      coverUrl: safeCoverUrl(input.coverUrl),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function addQueue(input: AddQueueInput): Promise<QueueItem> {
  const parsed = new URL(input.url);
  if (
    parsed.protocol !== "https:" ||
    !(
      parsed.hostname === "bilibili.com" ||
      parsed.hostname.endsWith(".bilibili.com")
    ) ||
    (!input.bvid && !input.cheeseEpisodeId)
  )
    throw new Error("只能添加B站普通视频或课堂链接");
  const queue = await getStored<QueueItem[]>(STORAGE_KEYS.queue, []);
  const duplicate = queue.find(
    (item) =>
      (input.bvid && item.bvid === input.bvid) ||
      (input.cheeseEpisodeId && item.cheeseEpisodeId === input.cheeseEpisodeId),
  );
  if (duplicate) {
    const metadata = await fetchQueueMetadata(duplicate);
    Object.assign(duplicate, metadata, {
      metadataFetchedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await setStored(STORAGE_KEYS.queue, queue);
    return duplicate;
  }
  const config = await settings();
  const now = Date.now();
  const days =
    input.status === "soon" ? config.queue.soonDays : config.queue.laterDays;
  const metadata = await fetchQueueMetadata(input);
  const item: QueueItem = {
    ...input,
    ...metadata,
    id: makeId("queue"),
    addedAt: now,
    updatedAt: now,
    dueAt: input.dueAt ?? now + days * 86_400_000,
    extensionCount: 0,
    metadataFetchedAt: now,
  };
  queue.push(item);
  await setStored(STORAGE_KEYS.queue, queue);
  return item;
}
async function refreshQueueMetadata(id: string): Promise<QueueItem> {
  const queue = await getStored<QueueItem[]>(STORAGE_KEYS.queue, []);
  const item = queue.find((entry) => entry.id === id);
  if (!item) throw new Error("未找到队列项目");
  const metadata = await fetchQueueMetadata(item);
  Object.assign(item, metadata, {
    metadataFetchedAt: Date.now(),
    updatedAt: Date.now(),
  });
  await setStored(STORAGE_KEYS.queue, queue);
  return item;
}
async function addBookmark(input: AddBookmarkInput): Promise<ClipBookmark> {
  const items = await getStored<ClipBookmark[]>(STORAGE_KEYS.bookmarks, []);
  const found = items.find(
    (item) =>
      item.kind === input.kind &&
      item.bvid === input.bvid &&
      item.pageNumber === input.pageNumber &&
      Math.abs(item.startSeconds - input.startSeconds) < 2,
  );
  if (found) return found;
  const now = Date.now();
  const item = {
    ...input,
    id: makeId("bookmark"),
    createdAt: now,
    updatedAt: now,
  };
  items.push(item);
  await setStored(STORAGE_KEYS.bookmarks, items);
  return item;
}
async function activeBilibiliPage(): Promise<PageSnapshot> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: "https://*.bilibili.com/*",
  });
  if (tab?.id !== undefined)
    try {
      return (await chrome.tabs.sendMessage(tab.id, {
        type: "CONTENT_GET_PAGE",
      })) as PageSnapshot;
    } catch {
      /* safe fallback */
    }
  const url = tab?.url ?? "about:blank";
  return {
    url,
    kind: tab?.url ? pageKindFromUrl(tab.url) : "other",
    bvid: tab?.url ? parseBvid(tab.url) : undefined,
    cheeseEpisodeId: tab?.url ? parseCheeseEpisodeId(tab.url) : undefined,
    title: tab?.title,
    detectedAt: Date.now(),
  };
}
async function activeBilibiliPlayer(): Promise<PlayerSnapshot> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: "https://*.bilibili.com/*",
  });
  if (tab?.id !== undefined)
    try {
      return (await chrome.tabs.sendMessage(tab.id, {
        type: "CONTENT_GET_PLAYER",
      })) as PlayerSnapshot;
    } catch {
      /* no content access */
    }
  return {
    attached: false,
    paused: true,
    ended: false,
    pictureInPicture: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    updatedAt: Date.now(),
  };
}
async function exportData(): Promise<AppDataExport> {
  return {
    schemaVersion: 2,
    exportedAt: Date.now(),
    settings: await settings(),
    usage: await getStored(STORAGE_KEYS.usage, emptyUsage()),
    queue: await getStored(STORAGE_KEYS.queue, []),
    bookmarks: await getStored(STORAGE_KEYS.bookmarks, []),
    progress: await getStored(STORAGE_KEYS.progress, []),
    notices: await getStored(STORAGE_KEYS.notices, []),
  };
}
function validateImport(value: unknown): AppDataExport {
  if (!value || typeof value !== "object")
    throw new Error("备份文件不是有效JSON对象");
  const data = value as Partial<AppDataExport>;
  if (
    data.schemaVersion !== 2 ||
    !data.settings ||
    data.settings.schemaVersion !== 2 ||
    !data.usage ||
    !Array.isArray(data.queue) ||
    !Array.isArray(data.bookmarks) ||
    !Array.isArray(data.progress) ||
    !Array.isArray(data.notices)
  )
    throw new Error("备份格式不完整或版本不兼容");
  if (
    typeof data.usage.days !== "object" ||
    data.usage.days === null ||
    typeof data.usage.months !== "object" ||
    data.usage.months === null ||
    data.queue.some(
      (item) =>
        !item ||
        typeof item.id !== "string" ||
        typeof item.url !== "string" ||
        typeof item.title !== "string",
    ) ||
    data.bookmarks.some(
      (item) =>
        !item ||
        typeof item.id !== "string" ||
        typeof item.url !== "string" ||
        !Number.isFinite(item.startSeconds),
    ) ||
    data.progress.some(
      (item) =>
        !item || typeof item.key !== "string" || typeof item.parts !== "object",
    )
  )
    throw new Error("备份内部数据校验失败，未导入任何内容");
  return data as AppDataExport;
}
async function clearSection(section: ClearableDataSection): Promise<void> {
  await guardDestructive();
  if (section === "settings")
    await saveSettings(structuredClone(DEFAULT_SETTINGS));
  else {
    const key = STORAGE_KEYS[section];
    await setStored(key, section === "usage" ? emptyUsage() : []);
  }
  if (section === "queue") await updateBadge();
  await broadcast({ type: "DATA_CHANGED" });
}

async function handle(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case "GET_SETTINGS":
      return settings();
    case "PATCH_SETTINGS":
      return saveSettings(mergeSettings(await settings(), message.patch));
    case "RESET_SETTINGS":
      await guardDestructive();
      return saveSettings(structuredClone(DEFAULT_SETTINGS));
    case "GET_USAGE_SUMMARY":
      return usageSummary();
    case "RECORD_USAGE_TICK":
      await enqueueUsage(
        message.tick.seconds,
        message.tick.recordedAt,
        message.tick.study,
        message.tick.live,
      );
      return { recorded: true };
    case "LIST_QUEUE": {
      const q = await getStored<QueueItem[]>(STORAGE_KEYS.queue, []);
      return message.status
        ? q.filter((item) => item.status === message.status)
        : q;
    }
    case "ADD_QUEUE_ITEM":
      return addQueue(message.item);
    case "UPDATE_QUEUE_ITEM": {
      const q = await getStored<QueueItem[]>(STORAGE_KEYS.queue, []);
      const i = q.findIndex((item) => item.id === message.id);
      if (i < 0) throw new Error("未找到队列项目");
      q[i] = {
        ...q[i],
        ...message.patch,
        id: message.id,
        updatedAt: Date.now(),
      };
      await setStored(STORAGE_KEYS.queue, q);
      await updateBadge();
      return q[i];
    }
    case "REFRESH_QUEUE_METADATA":
      return refreshQueueMetadata(message.id);
    case "DELETE_QUEUE_ITEM": {
      const q = await getStored<QueueItem[]>(STORAGE_KEYS.queue, []);
      const n = q.filter((item) => item.id !== message.id);
      await setStored(STORAGE_KEYS.queue, n);
      await updateBadge();
      return { deleted: n.length !== q.length };
    }
    case "LIST_BOOKMARKS":
      return getStored<ClipBookmark[]>(STORAGE_KEYS.bookmarks, []);
    case "ADD_BOOKMARK":
      return addBookmark(message.bookmark);
    case "UPDATE_BOOKMARK": {
      const b = await getStored<ClipBookmark[]>(STORAGE_KEYS.bookmarks, []);
      const i = b.findIndex((item) => item.id === message.id);
      if (i < 0) throw new Error("未找到标记");
      b[i] = {
        ...b[i],
        ...message.patch,
        id: message.id,
        updatedAt: Date.now(),
      };
      await setStored(STORAGE_KEYS.bookmarks, b);
      return b[i];
    }
    case "DELETE_BOOKMARK": {
      const b = await getStored<ClipBookmark[]>(STORAGE_KEYS.bookmarks, []);
      const n = b.filter((item) => item.id !== message.id);
      await setStored(STORAGE_KEYS.bookmarks, n);
      return { deleted: n.length !== b.length };
    }
    case "LIST_PROGRESS":
      return getStored<CourseProgress[]>(STORAGE_KEYS.progress, []);
    case "UPDATE_PROGRESS": {
      const p = await getStored<CourseProgress[]>(STORAGE_KEYS.progress, []);
      const i = p.findIndex((item) => item.key === message.progress.key);
      if (i >= 0) p[i] = message.progress;
      else p.push(message.progress);
      await setStored(STORAGE_KEYS.progress, p);
      const parts = Object.values(message.progress.parts);
      const automatic =
        parts.length >= (message.progress.totalParts ?? 1) &&
        parts.every((part) => part.completed);
      const completed = message.progress.manuallyCompleted ?? automatic;
      const q = await getStored<QueueItem[]>(STORAGE_KEYS.queue, []);
      let changed = false;
      for (const item of q) {
        const match =
          (item.bvid && item.bvid === message.progress.bvid) ||
          (item.cheeseEpisodeId &&
            item.cheeseEpisodeId === message.progress.cheeseEpisodeId);
        if (!match) continue;
        let c = false;
        if (completed && item.status !== "completed") {
          item.status = "completed";
          c = true;
        } else if (
          message.progress.manuallyCompleted === false &&
          item.status === "completed"
        ) {
          item.status = "soon";
          item.dueAt = Date.now() + 7 * 86_400_000;
          c = true;
        }
        if (item.title !== message.progress.title) {
          item.title = message.progress.title;
          c = true;
        }
        if (
          message.progress.uploader !== undefined &&
          item.uploader !== message.progress.uploader
        ) {
          item.uploader = message.progress.uploader;
          c = true;
        }
        if (c) {
          item.updatedAt = Date.now();
          changed = true;
        }
      }
      if (changed) await setStored(STORAGE_KEYS.queue, q);
      return message.progress;
    }
    case "RESET_PROGRESS": {
      const p = await getStored<CourseProgress[]>(STORAGE_KEYS.progress, []);
      await setStored(
        STORAGE_KEYS.progress,
        p.filter((item) => item.key !== message.key),
      );
      return { reset: true };
    }
    case "GET_LEARNING_SESSION":
      return getStored<LearningSession | null>(
        STORAGE_KEYS.learningSession,
        null,
      );
    case "START_LEARNING_SESSION": {
      const config = await settings();
      if (!config.features["learning-mode"])
        throw new Error("请先开启学习模式");
      if (message.durationMinutes < 10 || message.durationMinutes > 360)
        throw new Error("学习时长必须在10分钟至6小时之间");
      const existing = await getStored<LearningSession | null>(
        STORAGE_KEYS.learningSession,
        null,
      );
      if (existing?.active && !existing.completed)
        throw new Error("已有未完成的学习会话，不能重新设置");
      const queue = await getStored<QueueItem[]>(STORAGE_KEYS.queue, []);
      const selected = queue.filter((item) =>
        message.queueItemIds.includes(item.id),
      );
      if (!selected.length) throw new Error("请至少选择一个学习视频");
      const now = Date.now();
      const session: LearningSession = {
        id: makeId("learning"),
        active: true,
        completed: false,
        startedAt: now,
        targetSeconds: Math.round(message.durationMinutes * 60),
        elapsedSeconds: 0,
        lastCountedAt: now,
        allowedVideos: selected.map((item) => ({
          key: item.bvid ?? item.cheeseEpisodeId ?? item.url,
          bvid: item.bvid,
          cheeseEpisodeId: item.cheeseEpisodeId,
          url: item.url,
          title: item.title,
        })),
        lastLearningUrl: selected[0].url,
        updatedAt: now,
      };
      await setStored(STORAGE_KEYS.learningSession, session);
      await broadcast({ type: "LEARNING_SESSION_CHANGED", session });
      return session;
    }
    case "STOP_LEARNING_SESSION": {
      const s = await getStored<LearningSession | null>(
        STORAGE_KEYS.learningSession,
        null,
      );
      if (s?.active && !s.completed) throw new Error("学习时间结束前不能退出");
      await setStored(STORAGE_KEYS.learningSession, null);
      await broadcast({ type: "LEARNING_SESSION_CHANGED", session: null });
      return null;
    }
    case "SET_LEARNING_LAST_URL": {
      const s = await getStored<LearningSession | null>(
        STORAGE_KEYS.learningSession,
        null,
      );
      if (s?.active) {
        const bvid = parseBvid(message.url);
        const episode = parseCheeseEpisodeId(message.url);
        const inWhitelist = s.allowedVideos.some(
          (item) =>
            (bvid && item.bvid === bvid) ||
            (episode && item.cheeseEpisodeId === episode),
        );
        if (inWhitelist) {
          s.lastLearningUrl = message.url;
          s.updatedAt = Date.now();
          await setStored(STORAGE_KEYS.learningSession, s);
        }
      }
      return { updated: true };
    }
    case "GET_NOTICES":
      return getStored<AppNotice[]>(STORAGE_KEYS.notices, []);
    case "MARK_NOTICE_READ": {
      const n = await getStored<AppNotice[]>(STORAGE_KEYS.notices, []);
      const item = n.find((x) => x.id === message.id);
      if (item) item.read = true;
      await setStored(STORAGE_KEYS.notices, n);
      return { updated: Boolean(item) };
    }
    case "GET_PAGE_CONTEXT":
      return activeBilibiliPage();
    case "GET_PLAYER_CONTEXT":
      return activeBilibiliPlayer();
    case "EXPORT_ALL_DATA":
      return exportData();
    case "IMPORT_ALL_DATA": {
      await guardDestructive();
      const d = validateImport(message.data);
      await chrome.storage.local.set({
        [STORAGE_KEYS.meta]: { version: 2, importedAt: Date.now() },
        [STORAGE_KEYS.settings]: migrateLegacySettings(d.settings),
        [STORAGE_KEYS.usage]: d.usage,
        [STORAGE_KEYS.queue]: d.queue,
        [STORAGE_KEYS.bookmarks]: d.bookmarks,
        [STORAGE_KEYS.progress]: d.progress,
        [STORAGE_KEYS.notices]: d.notices,
      });
      await updateBadge();
      await broadcast({ type: "DATA_CHANGED" });
      return { imported: true };
    }
    case "CLEAR_DATA_SECTION":
      await clearSection(message.section);
      return { cleared: message.section };
    case "CLEAR_ALL_DATA":
      await guardDestructive();
      await clearStored();
      await chrome.storage.local.set({
        [STORAGE_KEYS.meta]: { version: 2 },
        [STORAGE_KEYS.settings]: structuredClone(DEFAULT_SETTINGS),
        [STORAGE_KEYS.usage]: emptyUsage(),
        [STORAGE_KEYS.queue]: [],
        [STORAGE_KEYS.bookmarks]: [],
        [STORAGE_KEYS.progress]: [],
        [STORAGE_KEYS.notices]: [],
      });
      await updateBadge();
      await broadcast({ type: "DATA_CHANGED" });
      return { cleared: true };
  }
}
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, respond) => {
    void handle(message)
      .then((data) => respond({ ok: true, data }))
      .catch((error: unknown) =>
        respond({
          ok: false,
          error: {
            code: "BSE_ERROR",
            message: error instanceof Error ? error.message : "未知错误",
          },
        } satisfies MessageResponse<never>),
      );
    return true;
  },
);
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.runtime.openOptionsPage();
  void migrateStorage().then(async () => {
    await ensureAlarm();
    await maintenance();
  });
});
chrome.runtime.onStartup.addListener(() => {
  void migrateStorage().then(async () => {
    await ensureAlarm();
    await maintenance();
  });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MAINTENANCE_ALARM) void maintenance();
});
chrome.idle.setDetectionInterval(300);
chrome.idle.queryState(300).then((state) => {
  systemState = state;
});
chrome.idle.onStateChanged.addListener((state) => {
  systemState = state;
});
void migrateStorage().then(async () => {
  await ensureAlarm();
  await maintenance();
});
