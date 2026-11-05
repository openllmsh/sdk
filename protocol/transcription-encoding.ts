import type { TDefaultChainRankable } from "./default-chains";
import { orderDefaultChainMembers } from "./default-chains";
import type { TMediaAudioInputFormat } from "./media-default";
import { inspectMediaAudioInputFormat } from "./media-default";
import type { TExtendedModel } from "./models";
import { MEDIA_DEFAULT_CLASS } from "./models";

export type TTranscriptionEncoding = "wav16k" | "wav_generic" | "raw";

/**
 * Choose how to encode a recording for catalog-declared
 * `audio_support.input_formats`.
 *
 * - `wav_pcm16_16khz_mono` → exact mono 16kHz PCM16 WAV conversion.
 * - Any other declared set (e.g. `webm_opus` only) → forward raw bytes.
 * - No declared formats → historical generic WAV.
 */
export const chooseTranscriptionEncoding = (
  inputFormats: ReadonlyArray<string> | undefined,
): TTranscriptionEncoding => {
  if (inputFormats === undefined) return "wav_generic";
  if (inputFormats.includes("wav_pcm16_16khz_mono")) return "wav16k";
  return "raw";
};

const recorderFormat = (recorderMime: string): TMediaAudioInputFormat =>
  inspectMediaAudioInputFormat({ contentType: recorderMime });

/**
 * Whether this model's declared formats can consume a browser recording
 * of `recorderMime` — convert paths are always compatible; raw paths
 * require a positive format match.
 */
export const transcriptionCompatibleWithRecorder = (
  inputFormats: ReadonlyArray<string> | undefined,
  recorderMime: string,
): boolean => {
  const encoding = chooseTranscriptionEncoding(inputFormats);
  if (encoding === "wav16k" || encoding === "wav_generic") return true;
  const proven = recorderFormat(recorderMime);
  if (proven === "unknown") return false;
  return inputFormats?.includes(proven) ?? false;
};

export type TTranscriptionSelectable = TDefaultChainRankable &
  Pick<TExtendedModel, "audio_support">;

/**
 * Catalog-ranked transcription pick for the browser mic: same
 * `deriveMediaDefaultModels` order, then first hop compatible with the
 * recorder MIME (raw vs convert).
 */
export const pickRankedTranscriptionModel = <
  T extends TTranscriptionSelectable,
>(
  cards: ReadonlyArray<T>,
  recorderMime: string,
): T | null => {
  const ordered = orderDefaultChainMembers(
    cards,
    undefined,
    MEDIA_DEFAULT_CLASS,
    "transcription",
  );
  for (const card of ordered) {
    if (
      transcriptionCompatibleWithRecorder(
        card.audio_support?.input_formats,
        recorderMime,
      )
    ) {
      return card;
    }
  }
  return null;
};
