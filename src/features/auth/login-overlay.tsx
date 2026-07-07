import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { resolveAppRuntimeConfig } from '../../app/runtime-config';
import { BrandLogo } from '../../components/layout/brand-logo';
import { GlassInput } from '../../components/ui/glass-input';
import { GlowButton } from '../../components/ui/glow-button';
import { LanguageSwitch } from '../../components/ui/language-switch';
import { cn } from '../../lib/cn';
import type { AppLanguage } from '../../app/app-store';
import { createOperatorSessionUrl } from './operator-session-url';

const appDocumentTitle = 'OU-UI Next';
const localMockOperatorSessionId = 'operator-session-local-current';

type LoginOverlayProps = {
  authenticated: boolean;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  onAuthenticated: (input?: { csrfToken?: string; operatorSessionId?: string }) => void;
};

const copy = {
  zh: {
    title: 'OU-UI Next 控制面板',
    subtitle: '初始化安全连接',
    bannerLabel: '实时控制通道',
    bannerChips: ['会话校验', '策略同步', '审计留痕', '工作区就绪'],
    usernameLabel: '用户名',
    passwordLabel: '密码',
    usernamePlaceholder: '输入管理员用户名',
    passwordPlaceholder: '输入管理员密码',
    error: '访问拒绝：认证失败',
    submit: '安全登录',
    languageSwitcher: '语言切换'
  },
  en: {
    title: 'OU-UI Next Control Panel',
    subtitle: 'Initialize secure connection',
    bannerLabel: 'Live control channel',
    bannerChips: ['Session check', 'Policy sync', 'Audit trail', 'Workspace ready'],
    usernameLabel: 'Username',
    passwordLabel: 'Password',
    usernamePlaceholder: 'Enter admin username',
    passwordPlaceholder: 'Enter admin password',
    error: 'Access denied: authentication failed',
    submit: 'Secure Login',
    languageSwitcher: 'Language switcher'
  }
} as const;

async function readOperatorSessionState(response: Response) {
  try {
    const payload = (await response.json()) as { data?: { csrfToken?: unknown; sessionId?: unknown } };
    return {
      csrfToken: typeof payload.data?.csrfToken === 'string' ? payload.data.csrfToken : undefined,
      operatorSessionId: typeof payload.data?.sessionId === 'string' ? payload.data.sessionId : undefined
    };
  } catch {
    return {};
  }
}

export function LoginOverlay({ authenticated, language, onLanguageChange, onAuthenticated }: LoginOverlayProps) {
  const runtimeConfig = useMemo(() => resolveAppRuntimeConfig(), []);
  const t = copy[language];
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hasError, setHasError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(runtimeConfig.controlPlaneMode === 'http');
  const usernameInputId = 'operator-login-username';
  const passwordInputId = 'operator-login-password';
  const errorId = 'operator-login-error';

  useEffect(() => {
    document.title = authenticated || runtimeConfig.disableInAppLogin ? appDocumentTitle : t.title;
  }, [authenticated, runtimeConfig.disableInAppLogin, t.title]);

  useEffect(() => {
    if (runtimeConfig.disableInAppLogin && !authenticated) {
      onAuthenticated();
    }
  }, [authenticated, onAuthenticated, runtimeConfig.disableInAppLogin]);

  useEffect(() => {
    if (
      authenticated ||
      runtimeConfig.disableInAppLogin ||
      runtimeConfig.controlPlaneMode !== 'http'
    ) {
      setIsCheckingSession(false);
      return;
    }

    let cancelled = false;

    setIsCheckingSession(true);
    void fetch(createOperatorSessionUrl(runtimeConfig.controlPlaneBaseUrl ?? ''), {
      method: 'GET',
      credentials: 'include'
    })
      .then(async (response) => {
        if (!cancelled && response.ok) {
          onAuthenticated(await readOperatorSessionState(response));
        }
      })
      .catch(() => {
        // An absent or expired browser session should fall through to the login form.
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    authenticated,
    onAuthenticated,
    runtimeConfig.controlPlaneBaseUrl,
    runtimeConfig.controlPlaneMode,
    runtimeConfig.disableInAppLogin
  ]);

  if (authenticated || runtimeConfig.disableInAppLogin) {
    return null;
  }

  if (isCheckingSession) {
    return null;
  }

  const bannerChips = t.bannerChips;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (runtimeConfig.controlPlaneMode !== 'http') {
      if (username === runtimeConfig.loginUsername && password === runtimeConfig.loginPassword) {
        setHasError(false);
        onAuthenticated({ operatorSessionId: localMockOperatorSessionId });
        return;
      }

      setHasError(true);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(createOperatorSessionUrl(runtimeConfig.controlPlaneBaseUrl ?? ''), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username,
          password
        })
      });

      if (!response.ok) {
        setHasError(true);
        setIsSubmitting(false);
        return;
      }

      setHasError(false);
      setIsSubmitting(false);
      onAuthenticated(await readOperatorSessionState(response));
      return;
    } catch {
      setHasError(true);
    }

    setIsSubmitting(false);
  }

  return (
    <div id="login-overlay" className="login-overlay-centered grid content-center place-items-center">
      <div className={cn('login-box login-box-centered justify-self-center self-center', hasError && 'login-box-shake')}>
        <form className="login-content flex flex-col bg-transparent p-8" onSubmit={handleSubmit}>
          <LanguageSwitch
            ariaLabel={t.languageSwitcher}
            className="mx-auto mb-6"
            language={language}
            variant="login"
            onLanguageChange={onLanguageChange}
          />
          <div className="login-motion-banner" aria-hidden="true">
            <div className="login-motion-banner__header">
              <span className="login-motion-banner__badge">
                <span className="login-motion-banner__pulse" />
                LIVE
              </span>
              <span className="login-motion-banner__label">{t.bannerLabel}</span>
            </div>
            <div className="login-motion-banner__track">
              <div className="login-motion-banner__loop">
                {bannerChips.map((chip, index) => (
                  <span className={cn('login-motion-banner__chip', loginMotionChipToneClasses[index % loginMotionChipToneClasses.length])} key={`${chip}-${index}`}>
                    {chip}
                  </span>
                ))}
                {bannerChips.map((chip, index) => (
                  <span
                    className={cn('login-motion-banner__chip', loginMotionChipToneClasses[index % loginMotionChipToneClasses.length])}
                    key={`${chip}-repeat-${index}`}
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <p className="mb-3 text-center text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-white/40">
            OU-UI NEXT
          </p>
          <div className="mb-6 flex justify-center">
            <BrandLogo size="lg" />
          </div>
          <div className="login-copy-transition" key={language}>
            <h2 className="mb-1 text-center text-2xl font-semibold tracking-tight text-slate-800 dark:text-white">
              {t.title}
            </h2>
            <p className="mb-8 text-center font-mono text-[11px] text-blue-600 opacity-80 dark:text-primary">
              {t.subtitle}
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label
                className="block text-[11px] font-bold uppercase tracking-[0.14em] text-[#07111F] dark:text-white/80"
                htmlFor={usernameInputId}
              >
                {t.usernameLabel}
              </label>
              <GlassInput
                aria-describedby={hasError ? errorId : undefined}
                aria-invalid={hasError}
                autoComplete="username"
                className="font-mono"
                id={usernameInputId}
                placeholder={t.usernamePlaceholder}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label
                className="block text-[11px] font-bold uppercase tracking-[0.14em] text-[#07111F] dark:text-white/80"
                htmlFor={passwordInputId}
              >
                {t.passwordLabel}
              </label>
              <GlassInput
                aria-describedby={hasError ? errorId : undefined}
                aria-invalid={hasError}
                autoComplete="current-password"
                className="font-mono"
                id={passwordInputId}
                placeholder={t.passwordPlaceholder}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <p
              id={errorId}
              role={hasError ? 'alert' : undefined}
              className={cn(
                'mt-2 text-center text-[10px] font-bold tracking-wide text-red-500',
                !hasError && 'hidden'
              )}
            >
              {t.error}
            </p>
            <GlowButton className="mt-4 w-full py-3.5 text-sm font-bold tracking-widest" disabled={isSubmitting} type="submit">
              {t.submit}
            </GlowButton>
          </div>
        </form>
      </div>
    </div>
  );
}

const loginMotionChipToneClasses = [
  'border-[#1E3AFF] bg-[#1E3AFF] text-[#FDFFF1] dark:border-[#6B7CFF]/70 dark:bg-[#6B7CFF] dark:text-[#F4F8FF]',
  'border-[#07111F] bg-[#D9FF00] text-[#07111F] dark:border-[#EAFF5A]/70 dark:bg-[#EAFF5A] dark:text-[#07111F]',
  'border-[#FF3D18] bg-[#FF3D18] text-[#FFFDF5] dark:border-[#FF6A3A]/70 dark:bg-[#FF6A3A] dark:text-[#F4F8FF]'
] as const;
