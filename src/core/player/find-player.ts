import type { PlayerSnapshot } from "../types/domain";
export function findVideo(): HTMLVideoElement | null {
  return document.querySelector(
    ".bpx-player-video-wrap video,.bilibili-player-video video,video",
  );
}
export function playerSnapshot(video: HTMLVideoElement | null): PlayerSnapshot {
  return {
    attached: Boolean(video),
    paused: video?.paused ?? true,
    ended: video?.ended ?? false,
    pictureInPicture: document.pictureInPictureElement === video,
    currentTime: video?.currentTime ?? 0,
    duration: Number.isFinite(video?.duration) ? video!.duration : 0,
    playbackRate: video?.playbackRate ?? 1,
    updatedAt: Date.now(),
  };
}
