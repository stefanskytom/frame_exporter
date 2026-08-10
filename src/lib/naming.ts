import type { ExportSettings } from '../types';

export function resolveNamingTemplate(settings: ExportSettings): string {
  if (settings.namingPattern === 'custom') {
    return settings.customNaming || '{name}_{####}';
  }
  return settings.namingPattern;
}

export function formatFrameName(
  template: string,
  options: {
    name: string;
    anim: string;
    frame: number;
    index: number;
    paddingDigits: number;
  },
): string {
  const padded = String(options.frame).padStart(options.paddingDigits, '0');
  const indexPadded = String(options.index).padStart(options.paddingDigits, '0');

  return template
    .replaceAll('{name}', options.name)
    .replaceAll('{anim}', options.anim)
    .replaceAll('{####}', padded)
    .replaceAll('{frame}', String(options.frame))
    .replaceAll('{index}', indexPadded)
    .replace(/\.png$/i, '');
}

export function sanitizeFolderName(name: string): string {
  return (
    name
      .split('')
      .map((ch) => {
        const code = ch.charCodeAt(0);
        if (code < 32) return '_';
        if ('<>:"/\\|?*'.includes(ch)) return '_';
        return ch;
      })
      .join('')
      .trim() || 'export'
  );
}
