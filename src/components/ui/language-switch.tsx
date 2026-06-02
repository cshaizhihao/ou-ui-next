import type { AppLanguage } from '../../app/app-store';
import { cn } from '../../lib/cn';

type LanguageSwitchProps = {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  ariaLabel: string;
  variant?: 'topbar' | 'login';
  className?: string;
};

export function LanguageSwitch({
  language,
  onLanguageChange,
  ariaLabel,
  variant = 'topbar',
  className
}: LanguageSwitchProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn('language-switch', variant === 'login' && 'language-switch-login', className)}
      data-language={language}
      role="group"
    >
      <span aria-hidden="true" className="language-switch__thumb" />
      {(['zh', 'en'] as const).map((item) => (
        <button
          aria-pressed={language === item}
          className="language-switch__option"
          data-active={language === item}
          key={item}
          onClick={() => onLanguageChange(item)}
          type="button"
        >
          {item === 'zh' ? '中文' : 'English'}
        </button>
      ))}
    </div>
  );
}
