import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { resolveAppRuntimeConfig } from '../../app/runtime-config';
import { BrandLogo } from '../../components/layout/brand-logo';
import { GlassInput } from '../../components/ui/glass-input';
import { GlowButton } from '../../components/ui/glow-button';
import { LanguageSwitch } from '../../components/ui/language-switch';
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
    title: 'OU-UI Next 控制面板',
    subtitle: '初始化安全连接',
    usernamePlaceholder: '用户名',
    passwordPlaceholder: '密码',
    error: '访问拒绝：认证失败',
    submit: '安全登录',
    languageSwitcher: '语言切换'
  },
  en: {
    title: 'OU-UI Next Control Panel',
    subtitle: 'Initialize secure connection',
    usernamePlaceholder: 'Username',
    passwordPlaceholder: 'Password',
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

  if (authenticated || runtimeConfig.disableInAppLogin) {
    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (username === runtimeConfig.loginUsername && password === runtimeConfig.loginPassword) {
      setHasError(false);
      onAuthenticated();
      return;
    }

    setHasError(true);
  }

  return (
    <div id="login-overlay">
      <div className={cn('login-box', hasError && 'login-box-shake')}>
        <form className="login-content flex flex-col bg-transparent p-8" onSubmit={handleSubmit}>
          <LanguageSwitch
            ariaLabel={t.languageSwitcher}
            className="mx-auto mb-6"
            language={language}
            variant="login"
            onLanguageChange={onLanguageChange}
          />
          <p className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.35em] text-slate-500 dark:text-white/40">
            OU-UI NEXT
          </p>
          <div className="mb-6 flex justify-center">
            <BrandLogo size="lg" />
          </div>
          <div className="login-copy-transition" key={language}>
            <h2 className="mb-1 text-center text-2xl font-bold tracking-wide text-slate-800 dark:text-white">
              {t.title}
            </h2>
            <p className="mb-8 text-center font-mono text-[11px] text-blue-600 opacity-80 dark:text-primary">
              {t.subtitle}
            </p>
          </div>

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
