import { createSignal } from "solid-js";
import { config } from "../utils/config";
import { createStore } from "solid-js/store";
import { setNavStore } from "./navigation";

const nl = navigator.language.slice(0, 2);
const initLocale = config.language || (Locales.includes(nl) ? nl : 'en');

export type AppMode = 'music' | 'video';

const savedMode = localStorage.getItem('appMode') as AppMode | null;
export const [appMode, setAppMode] = createSignal<AppMode>(savedMode || 'music');

export function switchAppMode(mode: AppMode) {
  if (mode === appMode()) return;
  // Reset all nav states first
  setNavStore('search', 'state', false);
  setNavStore('library', 'state', false);
  setNavStore('queue', 'state', false);
  setNavStore('player', 'state', false);
  setNavStore('list', 'state', false);
  // Then switch mode
  setAppMode(mode);
  localStorage.setItem('appMode', mode);
  // Then open search after a tick
  setTimeout(() => setNavStore('search', 'state', true), 50);
}

const storeInit: {
  useSaavn: boolean,
  api: string,
  updater?: () => void,
  actionsMenu?: TrackItem & { albumId?: string },
  snackbar?: string,
  syncState?: SyncState,
  locale: string,
  translations: Record<TranslationKeys, string> | {}
} = {
  api: '',
  useSaavn: true,
  locale: initLocale,
  translations: {},
};

export const [store, setStore] = createStore(storeInit);


export function t(key: TranslationKeys, value: string = ''): string {

  const translations = store.translations as Record<TranslationKeys, string>;
  const translatedString = translations[key] || key as string;
  return value ? translatedString.replace('$', value) : translatedString;
}

export async function updateLang() {

  document.documentElement.lang = store.locale;

  const json = await import(`../../locales/${store.locale}.json`)

  setStore('translations', json.default);
  return true;
}
