import "./styles.css";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../core/config/defaults";
import { sendMessage } from "../core/message/client";
import { detectPage, videoKey } from "../core/page/detect";
import { findVideo, playerSnapshot } from "../core/player/find-player";
import type {
  CourseProgress,
  LearningSession,
  PageSnapshot,
  PartProgress,
  QueueItem,
} from "../core/types/domain";
import type { AppSettings } from "../core/types/settings";

let settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
let session: LearningSession | null = null;
let page = detectPage();
let video: HTMLVideoElement | null = null;
let lastUrl = location.href;
let lastActivityAt = Date.now();
let dwellStartedAt = Date.now();
let lastHeartbeatAt = Date.now();
let pointA: number | null = null;
let pointB: number | null = null;
let danmakuVisible = false;
let toolbar: HTMLElement | null = null;
let progressCache: CourseProgress[] = [];
let queueCache: QueueItem[] = [];
let handledIntent = "";
const safe = <T>(promise: Promise<T>) =>
  promise.catch((error) => {
    console.warn("[BSE]", error);
    return undefined;
  });
function allowed(current = page): boolean {
  if (!session?.active) return false;
  if (current.kind === "auth") return true;
  return session.allowedVideos.some(
    (item) =>
      (current.bvid && item.bvid === current.bvid) ||
      (current.cheeseEpisodeId &&
        item.cheeseEpisodeId === current.cheeseEpisodeId),
  );
}
function enforceLearning(): void {
  const active = Boolean(session?.active && allowed());
  document.documentElement.classList.toggle("bse-learning-active", active);
  document.documentElement.classList.toggle(
    "bse-learning-danmaku-hidden",
    active && !danmakuVisible,
  );
  if (!session?.active || page.kind === "auth" || allowed()) {
    if (active)
      void safe(
        sendMessage({ type: "SET_LEARNING_LAST_URL", url: location.href }),
      );
    return;
  }
  const fallback = session.lastLearningUrl ?? session.allowedVideos[0]?.url;
  if (fallback && location.href !== fallback) {
    document.documentElement.classList.add("bse-learning-redirecting");
    location.replace(fallback);
  }
}
const textOf = (el: Element) =>
  (el.textContent ?? "").replace(/\s+/g, " ").trim();
const cardSelector = [
  ".bili-video-card",
  ".feed-card",
  ".video-page-card-small",
  ".bili-live-card",
  "[class*='video-card']",
  "[class*='live-card']",
  "[class*='floor-card']",
].join(",");
function restoreOptimizedCards(): void {
  document
    .querySelectorAll<HTMLElement>("[data-bse-card-hidden]")
    .forEach((el) => {
      el.style.removeProperty("display");
      delete el.dataset.bseCardHidden;
    });
}
function layoutItemFor(card: HTMLElement): HTMLElement {
  let current = card;
  for (let depth = 0; depth < 5; depth += 1) {
    const parent = current.parentElement;
    if (!parent || parent === document.body) break;
    const display = getComputedStyle(parent).display;
    if (
      (display === "grid" || display === "inline-grid") &&
      parent.children.length >= 3
    )
      return current;
    current = parent;
  }
  return card;
}
function optimize(): void {
  const enabled =
    settings.features["interface-optimization"] &&
    ["home", "video", "cheese"].includes(page.kind);
  restoreOptimizedCards();
  if (!enabled) return;
  const rules = settings.interfaceOptimization.hiddenBadges
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  document.querySelectorAll<HTMLElement>(cardSelector).forEach((card) => {
    const text = textOf(card);
    const normalizedText = text.toLowerCase();
    const ad =
      /(广告|推广|赞助)/.test(text) ||
      Boolean(
        card.querySelector("[class*='ad-tag'],[class*='adcard'],[data-ad]"),
      );
    const live =
      /(^|\s)(直播中?|正在直播)(\s|$)/.test(text) ||
      Boolean(
        card.querySelector(
          "[class*='live-tag'],[class*='live-status'],[class*='living']",
        ),
      );
    const ruleMatched =
      rules.length > 0 &&
      (settings.interfaceOptimization.matchMode === "all"
        ? rules.every((rule) => normalizedText.includes(rule))
        : rules.some((rule) => normalizedText.includes(rule)));
    if (
      (settings.interfaceOptimization.hideAds && ad) ||
      (settings.interfaceOptimization.hideLiveCards && live) ||
      ruleMatched
    ) {
      const target = layoutItemFor(card);
      target.style.setProperty("display", "none", "important");
      target.dataset.bseCardHidden = "true";
    }
  });
}
function restoreFilter(): void {
  document
    .querySelectorAll<HTMLElement>("[data-bse-filtered-comment]")
    .forEach((el) => {
      el.classList.remove(
        "bse-filtered-comment",
        "bse-filtered-comment-revealed",
      );
      delete el.dataset.bseFilteredComment;
      el.querySelector(":scope > .bse-reveal-comment")?.remove();
    });
  document
    .querySelectorAll<HTMLElement>("[data-bse-filtered-danmaku]")
    .forEach((el) => {
      el.style.removeProperty("display");
      delete el.dataset.bseFilteredDanmaku;
    });
}
function filterContent(): void {
  const words = settings.contentFilter.keywords
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (!settings.features["content-filter"] || !words.length) {
    restoreFilter();
    return;
  }
  const hit = (text: string) =>
    words.some((word) => text.toLowerCase().includes(word));
  document
    .querySelectorAll<HTMLElement>(
      ".bili-danmaku-x-dm,.b-danmaku,[class*='danmaku-item']",
    )
    .forEach((el) => {
      if (hit(textOf(el))) {
        el.style.setProperty("display", "none", "important");
        el.dataset.bseFilteredDanmaku = "true";
      }
    });
  document
    .querySelectorAll<HTMLElement>(
      ".reply-item,.root-reply-container,.sub-reply-item",
    )
    .forEach((el) => {
      if (el.dataset.bseFilteredComment || !hit(textOf(el))) return;
      el.dataset.bseFilteredComment = "true";
      el.classList.add("bse-filtered-comment");
      const button = document.createElement("button");
      button.className = "bse-reveal-comment";
      button.textContent = "命中本地过滤词，点击查看";
      button.onclick = () => el.classList.add("bse-filtered-comment-revealed");
      el.prepend(button);
    });
}
function currentVideo(): HTMLVideoElement | null {
  const next = findVideo();
  if (next !== video) {
    video?.removeEventListener("timeupdate", loop);
    video = next;
    video?.addEventListener("timeupdate", loop);
    if (video) applyIntent(video);
  }
  return video;
}
function loop(): void {
  if (
    video &&
    pointA !== null &&
    pointB !== null &&
    video.currentTime >= pointB
  )
    video.currentTime = pointA;
}
function applyIntent(target: HTMLVideoElement): void {
  if (handledIntent === location.href) return;
  const url = new URL(location.href);
  const start = Number(
    url.searchParams.get("bse_a") ?? url.searchParams.get("t"),
  );
  const end = Number(url.searchParams.get("bse_b"));
  if (!Number.isFinite(start)) return;
  const apply = () => {
    target.currentTime = Math.max(0, start);
    if (Number.isFinite(end) && end > start) {
      pointA = start;
      pointB = end;
      void target.play().catch(() => undefined);
    } else if (url.searchParams.get("bse_pause") === "1") target.pause();
    handledIntent = location.href;
    updateToolbar();
  };
  if (target.readyState >= 1) apply();
  else target.addEventListener("loadedmetadata", apply, { once: true });
}
function fmt(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
function button(label: string, action: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.textContent = label;
  el.onclick = action;
  return el;
}
function flash(message: string): void {
  const el = toolbar?.querySelector<HTMLElement>(".bse-status");
  if (!el) return;
  el.textContent = message;
  setTimeout(() => {
    if (el.textContent === message) el.textContent = "";
  }, 1600);
}
async function addQueue(): Promise<void> {
  const player = currentVideo();
  const item = await sendMessage({
    type: "ADD_QUEUE_ITEM",
    item: {
      bvid: page.bvid,
      cheeseEpisodeId: page.cheeseEpisodeId,
      url: location.href,
      title: page.title ?? document.title,
      uploader: page.uploader,
      coverUrl: page.coverUrl,
      status: "later",
      durationSeconds:
        player && Number.isFinite(player.duration)
          ? player.duration
          : undefined,
    },
  });
  if (!queueCache.some((entry) => entry.id === item.id)) queueCache.push(item);
  flash("已加入稍后看");
}
async function savePoint(): Promise<void> {
  const player = currentVideo();
  if (!player) return;
  await sendMessage({
    type: "ADD_BOOKMARK",
    bookmark: {
      kind: "point",
      bvid: page.bvid,
      cheeseEpisodeId: page.cheeseEpisodeId,
      url: location.href,
      pageNumber: page.pageNumber,
      title: page.title ?? document.title,
      uploader: page.uploader,
      startSeconds: player.currentTime,
      name: `时间点 ${fmt(player.currentTime)}`,
    },
  });
  flash("时间点已保存");
}
async function saveSegment(): Promise<void> {
  if (pointA === null || pointB === null) {
    flash("请先设置A、B点");
    return;
  }
  await sendMessage({
    type: "ADD_BOOKMARK",
    bookmark: {
      kind: "segment",
      bvid: page.bvid,
      cheeseEpisodeId: page.cheeseEpisodeId,
      url: location.href,
      pageNumber: page.pageNumber,
      title: page.title ?? document.title,
      uploader: page.uploader,
      startSeconds: pointA,
      endSeconds: pointB,
      name: `片段 ${fmt(pointA)}–${fmt(pointB)}`,
    },
  });
  flash("片段已保存");
}
function updateToolbar(): void {
  if (!toolbar) return;
  const learning = Boolean(session?.active && allowed());
  const timer = toolbar.querySelector<HTMLElement>(".bse-timer");
  const stop = toolbar.querySelector<HTMLButtonElement>(".bse-stop");
  const dm = toolbar.querySelector<HTMLButtonElement>(".bse-danmaku");
  if (timer) {
    timer.hidden = !learning;
    timer.textContent = learning
      ? session?.completed
        ? "学习时间已完成"
        : `剩余 ${fmt((session?.targetSeconds ?? 0) - (session?.elapsedSeconds ?? 0))}`
      : "";
  }
  if (stop) {
    stop.hidden = !learning;
    stop.disabled = !session?.completed;
  }
  if (dm) {
    dm.hidden = !learning;
    dm.textContent = danmakuVisible ? "关闭弹幕" : "显示弹幕";
  }
}
function mountToolbar(): void {
  const supported = page.kind === "video" || page.kind === "cheese";
  const enabled =
    settings.features["player-tools"] ||
    settings.features["watch-queue"] ||
    settings.features["learning-library"] ||
    Boolean(session?.active);
  if (!supported || !enabled) {
    toolbar?.remove();
    toolbar = null;
    return;
  }
  if (!document.body || toolbar?.isConnected) {
    updateToolbar();
    return;
  }
  toolbar = document.createElement("aside");
  toolbar.id = "bse-player-toolbar";
  const title = document.createElement("strong");
  title.textContent = "学习工具";
  toolbar.append(title);
  if (settings.features["watch-queue"])
    toolbar.append(button("稍后看", () => void safe(addQueue())));
  if (settings.features["player-tools"])
    toolbar.append(
      button("设 A", () => {
        const v = currentVideo();
        if (v) {
          pointA = v.currentTime;
          if (pointB !== null && pointB <= pointA) pointB = null;
          flash(`A ${fmt(pointA)}`);
        }
      }),
      button("设 B", () => {
        const v = currentVideo();
        if (v && pointA !== null && v.currentTime > pointA) {
          pointB = v.currentTime;
          flash(`循环 ${fmt(pointA)}–${fmt(pointB)}`);
        } else flash("请先设A点");
      }),
      button("清循环", () => {
        pointA = pointB = null;
        flash("已清除");
      }),
    );
  if (settings.features["learning-library"])
    toolbar.append(
      button("记时间点", () => void safe(savePoint())),
      button("存片段", () => void safe(saveSegment())),
    );
  const timer = document.createElement("span");
  timer.className = "bse-timer";
  toolbar.append(timer);
  const dm = button("显示弹幕", () => {
    danmakuVisible = !danmakuVisible;
    enforceLearning();
    updateToolbar();
  });
  dm.className = "bse-danmaku";
  toolbar.append(dm);
  const stop = button("结束学习", () => {
    void safe(sendMessage({ type: "STOP_LEARNING_SESSION" })).then(() => {
      session = null;
      enforceLearning();
      updateToolbar();
    });
  });
  stop.className = "bse-stop";
  toolbar.append(stop);
  const status = document.createElement("small");
  status.className = "bse-status";
  toolbar.append(status);
  document.body.append(toolbar);
  updateToolbar();
}
function keyboard(event: KeyboardEvent): void {
  if (
    !settings.playerTools.shortcutsEnabled ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  )
    return;
  const v = currentVideo();
  if (!v) return;
  const combo = [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Meta" : "",
    event.code,
  ]
    .filter(Boolean)
    .join("+");
  const s = settings.playerTools.shortcuts;
  if (combo === s.setA) {
    event.preventDefault();
    pointA = v.currentTime;
  } else if (combo === s.setB && pointA !== null && v.currentTime > pointA) {
    event.preventDefault();
    pointB = v.currentTime;
  } else if (combo === s.clearLoop) {
    event.preventDefault();
    pointA = pointB = null;
  } else if (combo === s.savePoint) {
    event.preventDefault();
    void safe(savePoint());
  } else if (combo === s.saveSegment) {
    event.preventDefault();
    void safe(saveSegment());
  }
}
async function recordProgress(): Promise<void> {
  if (
    !settings.features["learning-library"] &&
    !settings.features["watch-queue"]
  )
    return;
  if (page.kind !== "video" && page.kind !== "cheese") return;
  const related = queueCache.some(
    (item) =>
      (page.bvid && item.bvid === page.bvid) ||
      (page.cheeseEpisodeId && item.cheeseEpisodeId === page.cheeseEpisodeId),
  );
  if (!related && !allowed()) return;
  const v = currentVideo();
  if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
  const key = videoKey(page);
  let course = progressCache.find((item) => item.key === key);
  if (!course) {
    course = {
      key,
      bvid: page.bvid,
      cheeseEpisodeId: page.cheeseEpisodeId,
      url: location.href,
      title: page.title ?? document.title,
      uploader: page.uploader,
      parts: {},
      totalParts: 1,
      updatedAt: Date.now(),
    };
    progressCache.push(course);
  }
  const partKey = String(page.pageNumber ?? 1);
  const previous = course.parts[partKey];
  const max = Math.max(previous?.maxPositionSeconds ?? 0, v.currentTime);
  const part: PartProgress = {
    pageNumber: page.pageNumber ?? 1,
    lastPositionSeconds: v.currentTime,
    maxPositionSeconds: max,
    durationSeconds: v.duration,
    completed: max / v.duration >= settings.queue.completionRatio,
    updatedAt: Date.now(),
  };
  course.parts[partKey] = part;
  course.totalParts = Math.max(
    course.totalParts ?? 1,
    document.querySelectorAll(
      ".video-pod__item,.video-pod__list .simple-base-item,.list-box li",
    ).length,
    Number(partKey),
  );
  course.url = location.href;
  course.title = page.title ?? course.title;
  course.uploader = page.uploader ?? course.uploader;
  course.updatedAt = Date.now();
  await sendMessage({ type: "UPDATE_PROGRESS", progress: course });
}
function eligibility(): { total: boolean; study: boolean; live: boolean } {
  const v = currentVideo();
  const pip = document.pictureInPictureElement === v;
  const focused = document.visibilityState === "visible" && document.hasFocus();
  const study = Boolean(session?.active && allowed() && (focused || pip));
  const playing = Boolean(v && !v.paused && !v.ended);
  const active =
    Date.now() - lastActivityAt <= settings.watchTime.inactiveSeconds * 1000;
  const dwelled =
    Date.now() - dwellStartedAt >= settings.watchTime.dwellSeconds * 1000;
  const total =
    study ||
    (dwelled && ((focused && (active || playing)) || (pip && playing)));
  return {
    total,
    study,
    live: Boolean(page.kind === "live" && total && playing),
  };
}
async function heartbeat(): Promise<void> {
  const now = Date.now();
  const seconds = Math.max(
    1,
    Math.min(300, Math.floor((now - lastHeartbeatAt) / 1000)),
  );
  lastHeartbeatAt = now;
  if (!settings.features["watch-time"] && !session?.active) return;
  const e = eligibility();
  if (e.total)
    await sendMessage({
      type: "RECORD_USAGE_TICK",
      tick: {
        seconds,
        recordedAt: now,
        study: e.study,
        live: e.live,
      },
    });
}
function updatePage(): void {
  page = detectPage();
  dwellStartedAt = Date.now();
  pointA = pointB = null;
  currentVideo();
  enforceLearning();
  optimize();
  filterContent();
  mountToolbar();
}
function observe(): void {
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      const latest = detectPage();
      page.title = latest.title ?? page.title;
      page.uploader = latest.uploader ?? page.uploader;
      optimize();
      filterContent();
      currentVideo();
      mountToolbar();
    }, 120);
  }).observe(document.documentElement, { childList: true, subtree: true });
}
chrome.runtime.onMessage.addListener((raw, _sender, respond) => {
  const message = raw as {
    type?: string;
    settings?: AppSettings;
    session?: LearningSession | null;
  };
  if (message.type === "CONTENT_GET_PAGE") respond(page);
  else if (message.type === "CONTENT_GET_PLAYER")
    respond(playerSnapshot(currentVideo()));
  else if (message.type === "SETTINGS_CHANGED" && message.settings) {
    settings = message.settings;
    updatePage();
  } else if (message.type === "LEARNING_SESSION_CHANGED") {
    if (message.session?.id !== session?.id) danmakuVisible = false;
    session = message.session ?? null;
    enforceLearning();
    mountToolbar();
  } else if (message.type === "DATA_CHANGED") void initialize();
  return false;
});
async function initialize(): Promise<void> {
  const [a, b, c, d] = await Promise.all([
    sendMessage({ type: "GET_SETTINGS" }),
    sendMessage({ type: "GET_LEARNING_SESSION" }),
    sendMessage({ type: "LIST_PROGRESS" }),
    sendMessage({ type: "LIST_QUEUE" }),
  ]);
  settings = a;
  session = b;
  progressCache = c;
  queueCache = d;
  updatePage();
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEYS.queue])
    queueCache = (changes[STORAGE_KEYS.queue].newValue as QueueItem[]) ?? [];
});
for (const event of [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
] as const)
  window.addEventListener(
    event,
    () => {
      lastActivityAt = Date.now();
    },
    { passive: true },
  );
window.addEventListener("keydown", keyboard, true);
for (const event of ["focus", "blur"] as const)
  window.addEventListener(event, () => {
    lastHeartbeatAt = Date.now();
  });
document.addEventListener("visibilitychange", () => {
  lastHeartbeatAt = Date.now();
});
document.addEventListener("enterpictureinpicture", () => {
  lastHeartbeatAt = Date.now();
});
document.addEventListener("leavepictureinpicture", () => {
  lastHeartbeatAt = Date.now();
});
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    updatePage();
  }
  enforceLearning();
  updateToolbar();
}, 1000);
setInterval(() => void safe(heartbeat()), 5000);
setInterval(() => void safe(recordProgress()), 15_000);
observe();
void safe(initialize());
