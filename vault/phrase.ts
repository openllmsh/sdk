import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/**
 * Number of words in a recovery phrase. 128 bits of BIP39 entropy →
 * 12 words. Single source of truth for UIs that render one cell/slot
 * per word (e.g. the recovery-phrase grid).
 */
export const PHRASE_WORD_COUNT = 12;

/**
 * BIP39 12-word recovery phrase. 128 bits of entropy — sufficient for
 * the AES-256 wrap (Argon2id stretches it further); ergonomic to
 * write down and re-type.
 */
export const generatePhrase = (): string => {
  return generateMnemonic(wordlist, 128);
};

/**
 * Canonicalise user-typed / pasted phrase input before any crypto
 * derivation. Trims leading/trailing whitespace, collapses internal
 * whitespace (spaces, tabs, newlines from a multi-line paste) to a
 * single space, and lowercases — BIP39 words are all lowercase, so
 * a CapsLock or autocapitalisation slip shouldn't 401 the unlock.
 *
 * Called at the boundary in `unlockDek` and `buildVaultWithSalt`, so
 * UI inputs don't need to pre-clean. Idempotent on already-canonical
 * input (so `normalizePhrase(generatePhrase()) === generatePhrase()`).
 */
export const normalizePhrase = (input: string): string => {
  return input.trim().replace(/\s+/g, " ").toLowerCase();
};

export const isValidPhrase = (phrase: string): boolean => {
  return validateMnemonic(normalizePhrase(phrase), wordlist);
};

export const phraseWords = (phrase: string): readonly string[] => {
  return phrase
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
};

/**
 * Parse a pasted recovery phrase into its words, tolerating the messy
 * shapes people actually paste: numbered lists ("1. abandon", "1) abandon",
 * "1 abandon", "1.abandon"), one-word-per-line dumps, tabs, and stray
 * punctuation. Each token has any leading list-ordinal stripped, then every
 * non-letter character removed, then is lowercased; purely-numeric tokens
 * collapse to empty and drop out. BIP39 words are all lowercase letters, so
 * this is lossless for a real phrase while pruning the numbering around it.
 *
 * Used by the recovery-phrase input grid so pasting a numbered backup into
 * any cell yields the clean words. For the canonical single-string form fed
 * to crypto, see {@link normalizePhrase}.
 */
export const parsePhraseWords = (text: string): readonly string[] => {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^\d+[.):\-\]]*/, "").replace(/[^a-z]/g, ""))
    .filter((w) => w.length > 0);
};
