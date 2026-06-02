import { type FormEvent, useState } from 'react';
import { BrandLogo } from '../../components/layout/brand-logo';
import { GlassInput } from '../../components/ui/glass-input';
import { GlowButton } from '../../components/ui/glow-button';
import { cn } from '../../lib/cn';

type LoginOverlayProps = {
  authenticated: boolean;
  onAuthenticated: () => void;
};

export function LoginOverlay({ authenticated, onAuthenticated }: LoginOverlayProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hasError, setHasError] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (username === 'admin' && password === 'admin') {
      setHasError(false);
      onAuthenticated();
      return;
    }

    setHasError(true);
  }

  return (
    <div id="login-overlay" className={cn(authenticated && 'hidden-overlay')}>
      <div className={cn('login-box', hasError && 'login-box-shake')}>
        <form className="login-content flex flex-col bg-transparent p-8" onSubmit={handleSubmit}>
          <div className="mb-6 flex justify-center">
            <BrandLogo size="lg" />
          </div>
          <h2 className="mb-1 text-center text-2xl font-bold uppercase tracking-widest text-slate-800 dark:text-white">
            矩阵控制中心
          </h2>
          <p className="mb-8 text-center font-mono text-[11px] text-blue-600 opacity-80 dark:text-primary">
            初始化安全连接
          </p>

          <div className="space-y-4">
            <GlassInput
              className="font-mono"
              placeholder="用户名 (admin)"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <GlassInput
              className="font-mono"
              placeholder="密码 (admin)"
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
              访问拒绝：认证失败
            </p>
            <GlowButton className="mt-4 w-full py-3.5 text-sm font-bold tracking-widest" type="submit">
              安全登录
            </GlowButton>
          </div>
        </form>
      </div>
    </div>
  );
}
