import { render, screen } from '@testing-library/react';
import { EnvironmentBackdrop } from '../components/layout/environment-backdrop';
import { GlassCard } from '../components/ui/glass-card';
import { GlassInput } from '../components/ui/glass-input';
import { GlassPanel } from '../components/ui/glass-panel';
import { GlassToggle } from '../components/ui/glass-toggle';
import { GlowButton } from '../components/ui/glow-button';
import { visualClassNames, visualTokens } from './visual-constitution';

describe('visual constitution', () => {
  it('keeps the mandatory OU-UI Next visual tokens', () => {
    expect(visualTokens.colors.primary).toBe('#00F0FF');
    expect(visualTokens.colors.secondary).toBe('#7000FF');
    expect(visualTokens.darkModeStrategy).toBe('class');
    expect(visualTokens.fontFamilySans).toContain('SF Pro Text');
  });

  it('exports every class that must survive the React migration', () => {
    expect(visualClassNames).toEqual(
      expect.arrayContaining([
        'bg-env',
        'ambient-orb',
        'orb-1',
        'orb-2',
        'bg-grid',
        'app-container',
        'app-ready',
        'island-panel',
        'island-card',
        'btn-glow',
        'glass-input',
        'glass-select-control',
        'glass-toggle',
        'logo-cat',
        'page-view',
        'active',
        'stagger-1',
        'stagger-2',
        'tilt-card',
        'svg-flow-stop-1',
        'svg-flow-stop-2',
        'svg-line-dash',
        'nav-item',
        'nav-active',
        'overlay',
        'open',
        'drawer-panel',
        'modal-panel',
        'status-dot',
        'status-online'
      ])
    );
  });

  it('renders glass primitives with the preserved visual classes', () => {
    render(
      <>
        <EnvironmentBackdrop />
        <GlassPanel data-testid="panel" />
        <GlassCard data-testid="card" />
        <GlowButton>部署任务</GlowButton>
        <GlassInput aria-label="agent name" />
        <GlassToggle aria-label="BlockOther" />
      </>
    );

    expect(screen.getByTestId('panel')).toHaveClass('island-panel');
    expect(screen.getByTestId('card')).toHaveClass('island-card');
    expect(screen.getByRole('button', { name: '部署任务' })).toHaveClass('btn-glow');
    expect(screen.getByLabelText('agent name')).toHaveClass('glass-input');
    expect(screen.getByLabelText('BlockOther')).toHaveClass('glass-toggle');
    expect(document.querySelector('.bg-env')).toBeInTheDocument();
    expect(document.querySelector('.ambient-orb.orb-1')).toBeInTheDocument();
    expect(document.querySelector('.ambient-orb.orb-2')).toBeInTheDocument();
    expect(document.querySelector('.bg-grid')).toBeInTheDocument();
  });
});
