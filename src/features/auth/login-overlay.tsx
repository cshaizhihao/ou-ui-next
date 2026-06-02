import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { resolveAppRuntimeConfig } from '../../app/runtime-config';
import { BrandLogo } from '../../components/layout/brand-logo';
import { GlassInput } from '../../components/ui/glass-input';
import { GlowButton } from '../../components/ui/glow-button';
import { cn } from '../../lib/cn';
import type { AppLanguage } from '../../app/app-store';

type LoginOverlayProps = {
  authenticated: boolean;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  onAuthenticated: () => void;
};

const copy = {
  zh: {
    title: '矩阵控制中心',
    subtitle: '初始化安全连接',
    usernamePlaceholder: '用户名 (admin)',
    passwordPlaceholder: '密码 (admin)',
    error: '访问拒绝：认证失败',
    submit: '安全登录',
    languageSwitcher: '语言切换'
  },
  en: {
    title: 'Matrix Control Center',
    subtitle: 'Initialize secure connection',
    usernamePlaceholder: 'Username (admin)',
    passwordPlaceholder: 'Password (admin)',
    error: 'Access denied: authentication failed',
    submit: 'Secure Login',
    languageSwitcher: 'Language switcher'
  }
} as const;

export function LoginOverlay({ authenticated, language, onLanguageChange, onAuthenticated }: LoginOverlayProps) {
  const runtimeConfig = useMemo(() => resolveAppRuntimeConfig(), []);
  const t = copy[language];
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (runtimeConfig.disableInAppLogin && !authenticated) {
      onAuthenticated();
    }
  }, [authenticated, onAuthenticated, runtimeConfig.disableInAppLogin]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (username === 'admin' && password === 'admin') {
      setHasError(false);
      onAuthenticated();
      return;
    }

    setHasError(true);
  }

  if (runtimeConfig.disableInAppLogin) {
    return <div id="login-overlay" aria-hidden="true" className="hidden-overlay" />;
  }

  return (
    <div id="login-overlay" aria-hidden={authenticated} className={cn(authenticated && 'hidden-overlay')}>
      <div className={cn('login-box', hasError && 'login-box-shake')}>
        <form className="login-content flex flex-col bg-transparent p-8" onSubmit={handleSubmit}>
          <div
            aria-label={t.languageSwitcher}
            className="mb-5 flex justify-end rounded-full border border-slate-200 bg-slate-100 p-1 dark:border-white/10 dark:bg-white/5"
            role="group"
          >
            {(['zh', 'en'] as const).map((item) => (
              <button
                className={cn(
                  'min-w-16 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors',
                  language === item
                    ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20 dark:bg-primary dark:text-black'
                    : 'text-slate-500 hover:text-slate-800 dark:text-white/50 dark:hover:text-white'
                )}
                key={item}
                onClick={() => onLanguageChange(item)}
                type="button"
              >
                {item === 'zh' ? '中文' : 'English'}
              </button>
            ))}
          </div>
          <div className="mb-6 flex justify-center">
            <BrandLogo size="lg" />
          </div>
          <h2 className="mb-1 text-center text-2xl font-bold uppercase tracking-widest text-slate-800 dark:text-white">
            {t.title}
          </h2>
          <p className="mb-8 text-center font-mono text-[11px] text-blue-600 opacity-80 dark:text-primary">
            {t.subtitle}
          </p>

          <div className="space-y-4">
            <GlassInput
              className="font-mono"
              placeholder={t.usernamePlaceholder}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <GlassInput
              className="font-mono"
              placeholder={t.passwordPlaceholder}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p
              className={cn(
                'mt-2 text-center text-[10px] font-bold tracking-wide text-red-500',
                !hasError && 'hidden'
              )}
            >
              {t.error}
            </p>
            <GlowButton className="mt-4 w-full py-3.5 text-sm font-bold tracking-widest" type="submit">
              {t.submit}
            </GlowButton>
          </div>
        </form>
      </div>
    </div>
  );
}
