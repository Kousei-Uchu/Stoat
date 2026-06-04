import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './assets/locales/en/en.json';
import tr from './assets/locales/tr/tr.json';
import vi from './assets/locales/vi/vi.json';
import type { DropdownOption } from './components/Dropdown';

export const resources = {
  en: { translation: en },
  tr: { translation: tr },
  vi: { translation: vi }
} as const;

// export type LanguageCodes = keyof typeof resources;

export const supportedLanguagesDropdownOptions: DropdownOption<keyof typeof resources>[] = [
  { label: `English`, value: 'en' },
  { label: `Turkish`, value: 'tr' },
  { label: `Vietnamese`, value: 'vi' }
  // { label: `Francais`, value: 'fr' },
];

// window.api may not exist yet during mobile boot (shim attached by mobile/index.tsx).
// Safely fall back to 'en' if unavailable — the app re-reads the setting after hydration.
let initialLanguage = 'en';
try {
  const settings = await (window as any).api?.settings?.getUserSettings?.();
  if (settings?.language) initialLanguage = settings.language;
} catch { /* mobile / first load — default to English */ }

// eslint-disable-next-line import/no-named-as-default-member
i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: { escapeValue: false } // React is safe from xss attacks
});

export default i18n;