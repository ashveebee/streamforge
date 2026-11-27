import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en, { type Messages } from './locales/en';
import es from './locales/es';
import fr from './locales/fr';
import de from './locales/de';
import ptBR from './locales/pt-BR';

/**
 * A small, typed translation layer. English is the source of truth: every
 * other locale must have the same keys (the type checker enforces it), and a
 * missing or empty string falls back to English at runtime.
 *
 * To add a language: copy `locales/en.ts`, translate it, and add it to
 * LOCALES below.
 */
export const LOCALES = [
  { code: 'en', name: 'English', messages: en },
  { code: 'es', name: 'Español', messages: es },
  { code: 'fr', name: 'Français', messages: fr },
  { code: 'de', name: 'Deutsch', messages: de },
  { code: 'pt-BR', name: 'Português (Brasil)', messages: ptBR },
] as const satisfies readonly { code: string; name: string; messages: Messages }[];

export type Locale = (typeof LOCALES)[number]['code'];

/** A message that changes with a count: `{ one: '1 stream', other: '{count} streams' }`. */
export type Plural = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };
type Leaf = string | Plural;

/** Every dotted key in the English messages, e.g. `nav.overview`. */
type Paths<T> = {
  [K in keyof T & string]: T[K] extends Leaf ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];
export type MessageKey = Paths<Messages>;

export type Vars = Record<string, string | number | undefined>;
export type TFunction = (key: MessageKey, vars?: Vars) => string;

const STORAGE_KEY = 'sf:locale';

function isLocale(x: unknown): x is Locale {
  return LOCALES.some((l) => l.code === x);
}

/** The saved choice, else the browser's preferred languages, else English. */
function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  for (const lang of typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])) {
    if (isLocale(lang)) return lang;
    // "pt", "pt-PT" → pt-BR; "es-MX" → es; "de-AT" → de …
    const base = lang.split('-')[0]!.toLowerCase();
    const match = LOCALES.find((l) => l.code.split('-')[0] === base);
    if (match) return match.code;
  }
  return 'en';
}

let current: Locale = detectLocale();

/** The active locale, for code outside React (formatting helpers). */
export function getLocale(): Locale {
  return current;
}

function lookup(messages: Messages, key: string): Leaf | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' || (node && typeof node === 'object' && 'other' in node) ? (node as Leaf) : undefined;
}

function interpolate(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = vars[name];
    if (v === undefined) return m;
    return typeof v === 'number' ? new Intl.NumberFormat(current).format(v) : v;
  });
}

function resolve(locale: Locale, key: string, vars?: Vars): string {
  const messages = LOCALES.find((l) => l.code === locale)!.messages as Messages;
  let leaf = lookup(messages, key);
  if (leaf === undefined || leaf === '') leaf = lookup(en, key);
  if (leaf === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key "${key}"`);
    return key;
  }
  if (typeof leaf !== 'string') {
    const count = typeof vars?.count === 'number' ? vars.count : 0;
    const form = count === 0 && leaf.zero ? 'zero' : new Intl.PluralRules(locale).select(count);
    leaf = leaf[form] || leaf.other;
  }
  return interpolate(leaf, vars);
}

/** Translate outside React. Prefer `useT()` in components. */
export const t: TFunction = (key, vars) => resolve(current, key, vars);

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nValue>({ locale: current, setLocale: () => {}, t });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(current);

  const setLocale = useCallback((l: Locale) => {
    current = l;
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* storage blocked: the choice lasts until reload */
    }
    setLocaleState(l);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t: (key, vars) => resolve(locale, key, vars) }), [locale, setLocale]);

  // Re-mount the tree when the language changes, so module-level helpers
  // (dates, numbers) re-render everywhere, not just in components using t().
  return (
    <I18nContext.Provider value={value}>
      <Fragment key={locale}>{children}</Fragment>
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

/** The translate function for the active language. */
export function useT() {
  return useContext(I18nContext).t;
}
