import { learningLocked, learningRemaining } from "../../core/learning/session";
import { checkSiteAccess } from "../permissions";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { sendMessage } from "../../core/message/client";
import type {
  LearningSession,
  PageSnapshot,
  UsageBucket,
} from "../../core/types/domain";
import type { AppSettings } from "../../core/types/settings";
import "../shared.css";
const empty: UsageBucket = { totalSeconds: 0, studySeconds: 0, liveSeconds: 0 };
const duration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}小时${m}分` : `${m}分钟`;
};
function Popup(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [usage, setUsage] = useState(empty);
  const [session, setSession] = useState<LearningSession | null>(null);
  const [page, setPage] = useState<PageSnapshot | null>(null);
  const [notice, setNotice] = useState("");
  async function load() {
    const [a, b, c, d] = await Promise.all([
      sendMessage({ type: "GET_SETTINGS" }),
      sendMessage({ type: "GET_USAGE_SUMMARY" }),
      sendMessage({ type: "GET_LEARNING_SESSION" }),
      sendMessage({ type: "GET_PAGE_CONTEXT" }),
    ]);
    setSettings(a);
    setUsage(b.today);
    setSession(c);
    setPage(d);
    await checkSiteAccess(setNotice, false);
  }
  useEffect(() => {
    void load().catch((e: unknown) =>
      setNotice(e instanceof Error ? e.message : "加载失败"),
    );
  }, []);
  async function toggle(id: "interface-optimization" | "watch-time") {
    if (!settings) return;
    if (!settings.features[id] && !(await checkSiteAccess(setNotice, true)))
      return;
    const next = await sendMessage({
      type: "PATCH_SETTINGS",
      patch: {
        features: { ...settings.features, [id]: !settings.features[id] },
      },
    });
    setSettings(next);
  }
  async function addCurrent() {
    if (!(await checkSiteAccess(setNotice, true))) return;
    if (!page?.bvid && !page?.cheeseEpisodeId) {
      setNotice("当前不是支持的B站视频");
      return;
    }
    await sendMessage({
      type: "ADD_QUEUE_ITEM",
      item: {
        bvid: page.bvid,
        cheeseEpisodeId: page.cheeseEpisodeId,
        url: page.url,
        title: page.title ?? "未命名视频",
        uploader: page.uploader,
        coverUrl: page.coverUrl,
        status: "later",
      },
    });
    setNotice("已加入稍后看");
  }
  const remaining = learningRemaining(session);
  return (
    <main className="popup-shell">
      <header className="popup-header">
        <div>
          <span className="eyebrow">本地运行</span>
          <h1>B站综合插件</h1>
        </div>
        <span className="status-dot" />
      </header>
      <section className="popup-hero">
        <span>今日B站总时长</span>
        <strong>{duration(usage.totalSeconds)}</strong>
        <small>
          学习 {duration(usage.studySeconds)} · 直播{" "}
          {duration(usage.liveSeconds)}
        </small>
      </section>
      {session?.active ? (
        <section className="compact-card">
          <strong>
            {!learningLocked(session)
              ? "学习时间已完成"
              : `剩余 ${duration(remaining)}`}
          </strong>
          <button
            className="full-width"
            disabled={learningLocked(session)}
            onClick={() =>
              void sendMessage({ type: "STOP_LEARNING_SESSION" }).then(load)
            }
          >
            结束学习
          </button>
        </section>
      ) : null}
      <section className="compact-card">
        <div className="section-title-row">
          <h2>快捷开关</h2>
        </div>
        <label className="toggle-row">
          <span>界面优化</span>
          <input
            type="checkbox"
            checked={settings?.features["interface-optimization"] ?? false}
            onChange={() => void toggle("interface-optimization")}
          />
        </label>
        <label className="toggle-row">
          <span>全站计时</span>
          <input
            type="checkbox"
            checked={settings?.features["watch-time"] ?? false}
            onChange={() => void toggle("watch-time")}
          />
        </label>
      </section>
      <button
        className="primary-button full-width"
        onClick={() =>
          void addCurrent().catch((e: unknown) =>
            setNotice(e instanceof Error ? e.message : "添加失败"),
          )
        }
      >
        加入当前视频
      </button>
      {notice ? <p className="alert">{notice}</p> : null}
      <button
        className="full-width"
        onClick={() =>
          void chrome.runtime.openOptionsPage().catch(() =>
            chrome.tabs.create({
              url: chrome.runtime.getURL("src/ui/options/index.html"),
            }),
          )
        }
      >
        打开插件控制台
      </button>
      <p className="privacy-note">
        找不到入口？在浏览器工具栏的扩展菜单中固定“B站综合插件”。
      </p>
      <p className="privacy-note">不读取非B站网页，数据只保存在本机。</p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Popup />);
