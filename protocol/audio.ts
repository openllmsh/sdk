/**
 * Verified subscription audio formats and voices. Catalog capability is
 * not billing inclusion; these lists are the supported subset from live
 * research, not the public vendor menu.
 */

export const CLAUDE_DICTATION_INPUT_FORMATS = [
  "pcm_s16le_16khz_mono",
  "wav_pcm16_16khz_mono",
] as const;

export const CODEX_TRANSCRIBE_INPUT_FORMATS = ["webm_opus"] as const;

export const CODEX_SPEECH_OUTPUT_FORMATS = ["mp3"] as const;

/**
 * Codex pronunciation has no voice selector. Do not send public OpenAI
 * voices such as `alloy`.
 */
export const CODEX_SPEECH_VOICES = [] as const;

export const GROK_STT_INPUT_FORMATS = ["wav_pcm16_16khz_mono"] as const;

export const GROK_TTS_OUTPUT_FORMATS = ["mp3"] as const;

export const GROK_TTS_VOICES = ["eve"] as const;

/** Verified Grok realtime operations. Microphone / barge-in are not listed. */
export const GROK_REALTIME_OPERATIONS = ["text_to_audio"] as const;
