// Minimal multi-language support: a dictionary + a [data-i18n] DOM pass.
// English is the source; Arabic ships alongside it. Untranslated strings fall
// back to English so partial catalogs never render blanks.

import type { Language } from '../shared/contracts';

export type { Language };

const AR: Record<string, string> = {
  'nav.new-task': 'مهمة جديدة',
  'nav.project': 'افتح مشروعًا',
  'nav.attention': 'الانتباه',
  'nav.search': 'بحث',
  'nav.automation': 'الأتمتة',
  'nav.toolkit': 'الأدوات',
  'nav.settings': 'الإعدادات',
  'branch': 'branch',
  'attention.title': 'الانتباه',
  'attention.summary': 'طلبات وأسئلة من كل وكيل في مكان واحد.',
  'attention.close': 'إغلاق',
  'settings.title': 'الإعدادات',
  'settings.summary': 'المظهر والموفّرون والسلوك — تُحفظ التغييرات تلقائيًا.',
  'settings.close': 'إغلاق الإعدادات',
  'automation.title': 'الأتمتة',
  'automation.summary': 'شغّل موجهًا أو افتح صفحة بجدول — تعمل المهام أثناء فتح Relay.',
  'automation.close': 'إغلاق الأتمتة',
  'composer.placeholder': 'صِف ما تريد بناءه…',
  'composer.hint.enter': 'Enter للإرسال',
  'toolkit.skills': 'المهارات',
  'toolkit.plugins': 'الإضافات',
  'toolkit.connectors': 'الموصلات',
  'toolkit.search': 'ابحث في الأدوات والنماذج…',
};

const EN: Record<string, string> = {
  'nav.new-task': 'New task',
  'nav.project': 'Open project',
  'nav.attention': 'Attention',
  'nav.search': 'Search',
  'nav.automation': 'Automation',
  'nav.toolkit': 'Toolkit',
  'nav.settings': 'Settings',
  'branch': 'branch',
  'attention.title': 'Attention',
  'attention.summary': 'Requests and questions from every agent, in one place.',
  'attention.close': 'Close',
  'settings.title': 'Settings',
  'settings.summary': 'Appearance, providers and behavior — changes save as you go.',
  'settings.close': 'Close settings',
  'automation.title': 'Automation',
  'automation.summary': 'Run an agent prompt or open a page on a schedule — jobs run while Relay is open.',
  'automation.close': 'Close automation',
  'composer.placeholder': 'Describe what you’d like to build…',
  'composer.hint.enter': 'Enter to send',
  'toolkit.skills': 'Skills',
  'toolkit.plugins': 'Plugins',
  'toolkit.connectors': 'Connectors',
  'toolkit.search': 'Search skills, plugins and connectors…',
};

const CATALOGS: Record<Language, Record<string, string>> = { en: EN, ar: AR };

export function t(key: string, language: Language = 'en'): string {
  return CATALOGS[language][key] ?? EN[key] ?? key;
}

// Apply a language to the live document. Strings tagged with data-i18n are set to
// textContent; data-i18n-placeholder fills placeholders instead.
export function applyLanguage(language: Language): void {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n ?? '';
    const value = t(key, language);
    if (value !== key) node.textContent = value;
  }
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    const key = node.dataset.i18nPlaceholder ?? '';
    const value = t(key, language);
    if (value !== key) node.setAttribute('placeholder', value);
  }
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    const key = node.dataset.i18nAriaLabel ?? '';
    const value = t(key, language);
    if (value !== key) node.setAttribute('aria-label', value);
  }
}
