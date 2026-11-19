// Minimal multi-language support: a dictionary + a [data-i18n] DOM pass.
// English is the source; Arabic ships alongside it. Untranslated strings fall
// back to English so partial catalogs never render blanks.

import type { Language } from '../shared/contracts';

export type { Language };

const AR: Record<string, string> = {
  'nav.new-task': 'مهمة جديدة',
  'nav.project': 'افتح مشروعًا',
  'nav.attention': 'انتباهي',
  'nav.design': 'التصميم',
  'nav.workspaces': 'مساحات العمل',
  'nav.search': 'بحث',
  'nav.automation': 'الأتمتة',
  'nav.atlas': 'أطلس',
  'atlas.title': 'أطلس',
  'nav.toolkit': 'الأدوات',
  'nav.settings': 'الإعدادات',
  'branch': 'branch',
  'attention.title': 'الانتباه',
  'attention.summary': 'طلبات وأسئلة من كل وكيل في مكان واحد.',
  'attention.close': 'إغلاق',
  'design.title': 'التصميم',
  'design.summary': 'صفحات لمشروعك، تُعاين مباشرة وتصبح كودًا عندما تكون راضيًا.',
  'motion.title': 'الحركة',
  'motion.summary': 'مشاهد متحركة لمشروعك — تُشغَّل إطارًا بإطار وتُحفظ نسخها مع كل جولة.',
  'settings.title': 'الإعدادات',
  'settings.summary': 'المظهر والموفّرون والسلوك — تُحفظ التغييرات تلقائيًا.',
  'settings.close': 'إغلاق الإعدادات',
  'automation.title': 'الأتمتة',
  'automation.summary': 'شغّل موجهًا أو افتح صفحة بجدول — تعمل المهام أثناء فتح Relay.',
  'automation.close': 'إغلاق الأتمتة',
  'composer.placeholder': 'صِف ما تريد بناءه…',
  'composer.hint.enter': 'Enter للإرسال',
  'scope.no-folder': 'بدون مجلد',
  'scope.choose-folder': 'اختر مجلدًا…',
  'toolkit.skills': 'المهارات',
  'toolkit.plugins': 'الإضافات',
  'toolkit.connectors': 'الموصلات',
  'toolkit.search': 'ابحث في الأدوات والنماذج…',
};

const EN: Record<string, string> = {
  'nav.new-task': 'New task',
  'nav.project': 'Open project',
  'nav.attention': 'My Attention',
  'nav.design': 'Design',
  'nav.workspaces': 'Workspaces',
  'nav.search': 'Search',
  'nav.automation': 'Automations',
  'nav.atlas': 'Atlas',
  'atlas.title': 'Atlas',
  'nav.toolkit': 'Toolkit',
  'nav.settings': 'Settings',
  'branch': 'branch',
  'attention.title': 'Attention',
  'attention.summary': 'Requests and questions from every agent, in one place.',
  'attention.close': 'Close',
  'design.title': 'Design',
  'design.summary': 'Pages for this project, previewed live and turned into code when you are happy.',
  'motion.title': 'Motion',
  'motion.summary': 'Animated scenes for this project — scrubbed frame by frame and versioned on every turn.',
  'settings.title': 'Settings',
  'settings.summary': 'Appearance, providers and behavior — changes save as you go.',
  'settings.close': 'Close settings',
  'automation.title': 'Automation',
  'automation.summary': 'Run an agent prompt or open a page on a schedule — jobs run while Relay is open.',
  'automation.close': 'Close automation',
  'composer.placeholder': 'Describe what you’d like to build…',
  'composer.hint.enter': 'Enter to send',
  'scope.no-folder': 'No folder',
  'scope.choose-folder': 'Choose folder…',
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
