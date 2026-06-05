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
  const [isCheckingSession, setIsCheckingSession] = useState(
    runtimeConfig.controlPlaneMode === 'http' && Boolean(runtimeConfig.controlPlaneBaseUrl)
  );

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
      runtimeConfig.controlPlaneMode !== 'http' ||
      !runtimeConfig.controlPlaneBaseUrl
    ) {
      setIsCheckingSession(false);
      return;
    }

    let cancelled = false;

    setIsCheckingSession(true);
    void fetch(createOperatorSessionUrl(runtimeConfig.controlPlaneBaseUrl), {
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (runtimeConfig.controlPlaneMode !== 'http') {
      if (username === runtimeConfig.loginUsername && password === runtimeConfig.loginPassword) {
        setHasError(false);
        onAuthenticated();
        return;
      }

      setHasError(true);
      return;
    }

    if (!runtimeConfig.controlPlaneBaseUrl) {
      setHasError(true);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(createOperatorSessionUrl(runtimeConfig.controlPlaneBaseUrl), {
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
            <GlowButton className="mt-4 w-full py-3.5 text-sm font-bold tracking-widest" disabled={isSubmitting} type="submit">
              {t.submit}
            </GlowButton>
          </div>
        </form>
      </div>
    </div>
  );
}
