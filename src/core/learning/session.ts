import type { LearningSession } from "../types/domain";
export function learningRemaining(
  session: LearningSession | null,
  now = Date.now(),
): number {
  return session?.active
    ? Math.max(
        0,
        Math.ceil(
          (session.startedAt + session.targetSeconds * 1000 - now) / 1000,
        ),
      )
    : 0;
}
export function learningLocked(
  session: LearningSession | null,
  now = Date.now(),
): boolean {
  return Boolean(session?.active && learningRemaining(session, now) > 0);
}
export function refreshLearning(
  session: LearningSession | null,
  now = Date.now(),
): LearningSession | null {
  if (!session?.active) return session;
  return {
    ...session,
    elapsedSeconds: session.targetSeconds - learningRemaining(session, now),
    completed: !learningLocked(session, now),
  };
}
