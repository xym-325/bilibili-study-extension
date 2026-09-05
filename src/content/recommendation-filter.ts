import {
  cardKey,
  classifyCard,
  emptyCounts,
  isCommercialUrl,
  type CardEvidence,
  type FilterRecord,
  type FilterReport,
} from "../core/filter/rules";
import type { AppSettings } from "../core/types/settings";

// Whole cards only: substring selectors also match titles and entire feed containers.
export const CARD_SELECTOR =
  ".bili-video-card,.bili-live-card,.video-page-card-small,.video-card,.live-card,.bili-video-card__wrap,.feed-card,.floor-single-card,.video-card-reco,.rank-wrap,.bili-video-card.is-rcmd";
const TITLE_SELECTOR =
  ".bili-video-card__info--tit,.bili-video-card__info--title,.bili-video-card__info--tit a,.title,.info-title,h3,[data-video-title]";
const BADGE_SELECTOR =
  ".bili-video-card__info--badge,.bili-video-card__badge,.bili-video-card__cover-badge,.bili-video-card__cover-badge span,.bili-video-card__stats--text,.bili-video-card__stats__text,.badge,.badge span,.corner-mark,.corner-mark span,.cover-badge,.cover-badge span,.type-tag,.ogv-badge,.live-tag,.live-status,.ad-tag,.bili-video-card__info--ad,.bili-video-card__stats--ad";
const ownUi = (node: Element) =>
  Boolean(node.closest("#bse-player-toolbar,.bse-reveal-comment"));
const text = (el: Element | null) =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const wrapperLike = (el: HTMLElement) =>
  /(?:card|feed|floor|recommend|recommended|rcmd|video|live|wrap)/i.test(
    `${el.className} ${el.id}`,
  );
export function extractEvidence(card: HTMLElement): CardEvidence {
  const titleNode = card.querySelector<HTMLElement>(TITLE_SELECTOR);
  const titleLink = titleNode?.matches("a[href]")
    ? (titleNode as HTMLAnchorElement)
    : titleNode?.querySelector<HTMLAnchorElement>("a[href]");
  const link =
    titleLink ??
    card.querySelector<HTMLAnchorElement>(
      'a[href*="/video/"],a[href*="/bangumi/"],a[href*="live.bilibili.com/"],a[href]',
    );
  const url = link?.href ?? "";
  const title =
    titleNode?.getAttribute("title")?.trim() ||
    text(titleNode) ||
    link?.getAttribute("title")?.trim() ||
    "";
  const badges = [...card.querySelectorAll(BADGE_SELECTOR)]
    .map(text)
    .filter((v) => v.length <= 12);
  const icons = [...card.querySelectorAll("svg use")].map(
    (el) => el.getAttribute("href") ?? el.getAttribute("xlink:href") ?? "",
  );
  const ad =
    card.matches("[data-ad='true'],[data-is-ad='true']") ||
    badges.some((b) => /^(广告|商业推广)$/.test(b)) ||
    Boolean(
      card.querySelector(
        ".ad-tag,.bili-video-card__info--ad,.bili-video-card__stats--ad",
      ),
    ) ||
    icons.some((icon) => /#(?:widget-)?ad(?:vertisement)?$/i.test(icon));
  let liveLink = false;
  try {
    const u = new URL(url);
    liveLink =
      u.hostname === "live.bilibili.com" &&
      /^\/(?:blanc\/)?\d+/.test(u.pathname);
  } catch {
    /* missing link */
  }
  const live =
    card.matches(".bili-live-card,.live-card") ||
    liveLink ||
    badges.some((b) => /^(直播|直播中|正在直播)$/.test(b));
  // Registration/contact buttons are common on legitimate course cards. A button
  // alone is only decisive when it directly starts a purchase.
  const cta = [...card.querySelectorAll("a,button")].some((el) =>
    /^(立即购买|点击购买|立即下单|购买完整版)$/.test(text(el)),
  );
  return {
    key: cardKey(url) || `title:${title}`,
    title,
    url,
    badges,
    ad,
    live,
    commercial: isCommercialUrl(url) || cta,
  };
}

export class RecommendationFilter {
  private options: AppSettings["interfaceOptimization"];
  private enabled = false;
  private pending = new Set<HTMLElement>();
  private states = new Map<
    HTMLElement,
    {
      fingerprint: string;
      record: FilterRecord | null;
      placeholder?: Comment;
    }
  >();
  private timer: number | undefined;
  private reflowTimer: number | undefined;
  private observer: MutationObserver;
  private pageUrl = location.href;
  public evaluations = 0;
  constructor(settings: AppSettings) {
    this.options = settings.interfaceOptimization;
    this.observer = new MutationObserver((records) => {
      if (!this.enabled) return;
      for (const record of records) {
        const target =
          record.target instanceof Element
            ? record.target
            : record.target.parentElement;
        if (!target || ownUi(target)) continue;
        if (record.type !== "childList") this.collectClosest(target);
        else {
          this.collectClosest(target);
          for (const node of record.addedNodes)
            if (node instanceof Element && !ownUi(node)) this.collect(node);
          // Release disconnected cards without walking the document again.
          if (record.removedNodes.length) this.prune();
        }
      }
      this.schedule();
    });
    this.observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["href", "title", "data-ad", "data-is-ad"],
    });
  }
  private wholeCard(el: HTMLElement): HTMLElement {
    // Hide the outer layout item when B站 wraps one card in a feed/grid shell.
    // Hiding only the inner card leaves an empty grid slot on the home feed.
    let card = el;
    while (card.parentElement && card.parentElement !== document.body) {
      const parent = card.parentElement;
      const leaves = [...parent.querySelectorAll(CARD_SELECTOR)].filter(
        (n) => !n.querySelector(CARD_SELECTOR),
      );
      if (leaves.length > 1) break;
      if (
        parent.matches(CARD_SELECTOR) ||
        (parent.children.length === 1 && wrapperLike(parent))
      )
        card = parent;
      else break;
    }
    return card;
  }
  private requestReflow() {
    if (this.reflowTimer !== undefined) return;
    this.reflowTimer = window.setTimeout(() => {
      this.reflowTimer = undefined;
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("scroll"));
    }, 40);
  }
  private collectClosest(el: Element) {
    const card = el.closest<HTMLElement>(CARD_SELECTOR);
    if (card) {
      const leaves = [...card.querySelectorAll(CARD_SELECTOR)].filter(
        (n) => !n.querySelector(CARD_SELECTOR),
      );
      if (leaves.length <= 1) this.pending.add(this.wholeCard(card));
    }
  }
  private collect(root: Element | Document) {
    if (root instanceof HTMLElement && root.matches(CARD_SELECTOR))
      this.collectClosest(root);
    for (const el of root.querySelectorAll<HTMLElement>(CARD_SELECTOR)) {
      if (!el.querySelector(CARD_SELECTOR))
        this.pending.add(this.wholeCard(el));
    }
  }
  private prune() {
    for (const [card, state] of this.states)
      if (!card.isConnected && !state.placeholder?.isConnected) {
        card.classList.remove("bse-card-hidden");
        this.states.delete(card);
      }
  }
  private hideCard(card: HTMLElement, state: { placeholder?: Comment } = {}) {
    card.classList.add("bse-card-hidden");
    if (state.placeholder?.isConnected) return state.placeholder;
    const placeholder = document.createComment("bse-hidden-card");
    card.before(placeholder);
    card.remove();
    return placeholder;
  }
  private restoreCard(card: HTMLElement, state?: { placeholder?: Comment }) {
    card.classList.remove("bse-card-hidden");
    if (state?.placeholder?.isConnected) {
      state.placeholder.after(card);
      state.placeholder.remove();
    }
  }
  private schedule() {
    if (this.timer !== undefined || !this.pending.size) return;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      const start = performance.now();
      for (const card of this.pending) {
        this.pending.delete(card);
        if (!card.isConnected) continue;
        const evidence = extractEvidence(card);
        const fingerprint = JSON.stringify(evidence);
        const previous = this.states.get(card);
        if (previous?.fingerprint !== fingerprint) {
          this.evaluations++;
          const record = this.enabled
            ? classifyCard(evidence, this.options)
            : null;
          const wasHidden = Boolean(previous?.record);
          const placeholder = record
            ? this.hideCard(card, previous)
            : (this.restoreCard(card, previous), undefined);
          if (wasHidden !== Boolean(record)) this.requestReflow();
          this.states.set(card, { fingerprint, record, placeholder });
        }
        if (performance.now() - start >= 8) break;
      }
      this.schedule();
    }, 80);
  }
  configure(settings: AppSettings, supported: boolean) {
    this.options = settings.interfaceOptimization;
    this.enabled = settings.features["interface-optimization"] && supported;
    this.pageUrl = location.href;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    if (this.reflowTimer !== undefined) window.clearTimeout(this.reflowTimer);
    this.timer = undefined;
    this.reflowTimer = undefined;
    this.pending.clear();
    for (const [card, state] of this.states) this.restoreCard(card, state);
    this.states.clear();
    this.requestReflow();
    if (this.enabled) {
      this.collect(document);
      this.schedule();
    }
  }
  restore(key: string) {
    this.options = {
      ...this.options,
      exceptions: [...this.options.exceptions, key],
    };
    for (const [card, state] of this.states)
      if (state.record?.key === key) {
        this.restoreCard(card, state);
        state.record = null;
        state.placeholder = undefined;
      }
  }
  report(): FilterReport {
    this.prune();
    const counts = emptyCounts();
    const hidden: FilterRecord[] = [];
    for (const { record } of this.states.values())
      if (record) {
        counts[record.reason]++;
        hidden.push(record);
      }
    return {
      pageUrl: this.pageUrl,
      enabled: this.enabled,
      checked: this.states.size,
      counts,
      hidden: hidden.slice(-100),
    };
  }
}
