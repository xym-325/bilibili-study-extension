import type { PageKind, PageSnapshot } from "../types/domain";
const BV = /\/video\/(BV[0-9A-Za-z]+)/i;
const CHEESE = /\/cheese\/play\/(ep\d+)/i;
export const parseBvid = (url: string) => BV.exec(url)?.[1];
export const parseCheeseEpisodeId = (url: string) => CHEESE.exec(url)?.[1];
export function pageKindFromUrl(url: string): PageKind {
  const value = new URL(url);
  if (
    value.hostname === "passport.bilibili.com" ||
    value.hostname.includes("captcha")
  )
    return "auth";
  if (value.hostname === "live.bilibili.com") return "live";
  if (BV.test(value.pathname)) return "video";
  if (CHEESE.test(value.pathname)) return "cheese";
  if (value.pathname.startsWith("/bangumi/")) return "bangumi";
  if (value.hostname === "space.bilibili.com") return "space";
  if (
    value.hostname === "search.bilibili.com" ||
    value.pathname.startsWith("/v/search")
  )
    return "search";
  if (value.hostname === "www.bilibili.com" && value.pathname === "/")
    return "home";
  return "other";
}
export function detectPage(doc: Document = document): PageSnapshot {
  const url = location.href;
  const p = Number(new URL(url).searchParams.get("p") ?? "1");
  return {
    url,
    kind: pageKindFromUrl(url),
    bvid: parseBvid(url),
    cheeseEpisodeId: parseCheeseEpisodeId(url),
    pageNumber: Number.isFinite(p) ? p : 1,
    title:
      doc.title.replace(/_\u54d4\u54e9\u54d4\u54e9.*$/, "").trim() || undefined,
    uploader:
      doc
        .querySelector<HTMLElement>(
          ".up-name,.username,.up-info-container .name",
        )
        ?.innerText.trim() || undefined,
    detectedAt: Date.now(),
  };
}
export const videoKey = (
  page: Pick<PageSnapshot, "bvid" | "cheeseEpisodeId" | "url">,
) => page.bvid ?? page.cheeseEpisodeId ?? page.url;
