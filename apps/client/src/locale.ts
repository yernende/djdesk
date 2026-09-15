import { ref, watch } from "vue";
import {
  LOCALE_STORAGE_KEY,
  resolveLocale,
  translate,
  translateMessage,
  countLabel,
  type Locale,
  type MessageKey,
  type MessageParams,
} from "./i18n.ts";

let saved: string | null = null;
try {
  saved = localStorage.getItem(LOCALE_STORAGE_KEY);
} catch {
  /* Preferences are optional. */
}
export const locale = ref<Locale>(
  resolveLocale(saved, navigator.languages ?? [navigator.language]),
);
document.documentElement.lang = locale.value;
watch(
  locale,
  (value) => {
    document.documentElement.lang = value;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, value);
    } catch {
      /* Keep the in-memory choice. */
    }
  },
  { flush: "sync" },
);
export const t = (key: MessageKey, params?: MessageParams): string =>
  translate(locale.value, key, params);
export const message = (value: unknown): string => translateMessage(locale.value, value);
export const trackCount = (count: number): string => countLabel(locale.value, count);
export const segmentCount = (count: number): string => countLabel(locale.value, count, "segments");
