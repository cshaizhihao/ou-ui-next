import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { EnvironmentBackdrop } from '../components/layout/environment-backdrop';
import { GlassCard } from '../components/ui/glass-card';
import { GlassInput } from '../components/ui/glass-input';
import { GlassPanel } from '../components/ui/glass-panel';
import { GlassToggle } from '../components/ui/glass-toggle';
import { GlowButton } from '../components/ui/glow-button';
import { visualClassNames, visualTokens } from './visual-constitution';

function collectProductionUiFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectProductionUiFiles(path);
    }

    if (!/\.(css|tsx?)$/.test(entry.name) || /\.test\./.test(entry.name)) {
      return [];
    }

    return [path];
  });
}

describe('visual constitution', () => {
  it('keeps the mandatory OU-UI Next visual tokens', () => {
    expect(visualTokens.colors.primary).toBe('#E61919');
    expect(visualTokens.colors.secondary).toBe('#050505');
    expect(visualTokens.colors.accent).toBe('#E61919');
    expect(visualTokens.colors.lightBackground).toBe('#f4f4f0');
    expect(visualTokens.colors.lightSurface).toBe('#fffffb');
    expect(visualTokens.colors.lightSurfaceMuted).toBe('#e7e3da');
    expect(visualTokens.colors.border).toBe('#111111');
    expect(visualTokens.colors.textStrong).toBe('#050505');
    expect(visualTokens.colors.textMuted).toBe('#3f3b33');
    expect(visualTokens.colors.darkBackground).toBe('#0a0a0a');
    expect(visualTokens.colors.darkSurface).toBe('#141414');
    expect(visualTokens.visualDialect).toBe('industrial-brutalist');
    expect(visualTokens.darkModeStrategy).toBe('class');
    expect(visualTokens.fontFamilySans).toContain('Geist');
  });

  it('removes the legacy blue orange glass palette from shared theme sources', () => {
    const sharedThemeSources = [
      'tailwind.config.ts',
      'src/styles/visual-constitution.ts',
      'src/styles/globals.css',
      'src/styles/glass.css',
      'src/styles/animations.css'
    ].map((filePath) => readFileSync(join(process.cwd(), filePath), 'utf8').toLowerCase());

    expect(sharedThemeSources.join('\n')).not.toMatch(/#2563eb|#1d4ed8|#60a5fa|#f97316|#fb923c/);
  });

  it('exports every class that must survive the React migration', () => {
    expect(visualClassNames).toEqual(
      expect.arrayContaining([
        'bg-env',
        'bg-grid',
        'app-container',
        'app-ready',
        'ou-shell',
        'ou-shell-backdrop',
        'ou-shell-grid',
        'ou-shell-ribbon',
        'ou-surface',
        'ou-surface-muted',
        'ou-card',
        'ou-card-strong',
        'ou-page-enter',
        'ou-card-enter',
        'ou-fade-in',
        'ou-stagger-1',
        'ou-stagger-2',
        'ou-stagger-3',
        'ou-stagger-4',
        'ou-skeleton',
        'ou-scroll-glow',
        'island-panel',
        'island-card',
        'btn-glow',
        'ou-input',
        'ou-toggle',
        'ou-panel',
        'ou-select',
        'glass-input',
        'glass-toggle',
        'ou-surface',
        'ou-surface-muted',
        'ou-card',
        'ou-card-strong',
        'logo-cat',
        'page-view',
        'active',
        'stagger-1',
        'stagger-2',
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
        'status-idle',
        'status-online'
      ])
    );
    expect(visualClassNames).not.toEqual(expect.arrayContaining(['ambient-orb', 'orb-1', 'orb-2']));
  });

  it('does not preserve stale tilt-card affordances in production UI', () => {
    expect(visualClassNames).not.toContain('tilt-card');

    const filesWithTiltCards = collectProductionUiFiles(join(process.cwd(), 'src'))
      .filter((filePath) => readFileSync(filePath, 'utf8').includes('tilt-card'))
      .map((filePath) => filePath.replace(`${process.cwd()}/`, ''));

    expect(filesWithTiltCards).toEqual([]);
  });

  it('renders glass primitives without decorative orb backgrounds', () => {
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
    expect(document.querySelector('.ou-shell-backdrop')).toBeInTheDocument();
    expect(document.querySelector('.ou-shell-grid')).toBeInTheDocument();
  });
});
