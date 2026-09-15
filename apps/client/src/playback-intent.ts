export type PlaybackIntentAudioEventType = "play" | "pause";

interface PlaybackIntentAudioEvent {
  activeTrackId: string | null | undefined;
  currentIntent: boolean;
  eventTrackId: string | null | undefined;
  eventType: PlaybackIntentAudioEventType;
}

export function getNextPlaybackIntentForAudioEvent({
  activeTrackId,
  currentIntent,
  eventTrackId,
  eventType,
}: PlaybackIntentAudioEvent): boolean {
  if (!activeTrackId || !eventTrackId || activeTrackId !== eventTrackId) {
    return currentIntent;
  }

  return eventType === "play";
}
