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
    expect(visualTokens.colors.primary).toBe('#2563EB');
    expect(visualTokens.colors.secondary).toBe('#0B1220');
    expect(visualTokens.colors.accent).toBe('#0891B2');
    expect(visualTokens.colors.success).toBe('#059669');
    expect(visualTokens.colors.warning).toBe('#CA8A04');
    expect(visualTokens.colors.danger).toBe('#DC2626');
    expect(visualTokens.colors.lightBackground).toBe('#F7F9FC');
    expect(visualTokens.colors.lightSurface).toBe('#FFFFFF');
    expect(visualTokens.colors.lightSurfaceMuted).toBe('#EEF2F7');
    expect(visualTokens.colors.border).toBe('#D7DEE8');
    expect(visualTokens.colors.textStrong).toBe('#0B1220');
    expect(visualTokens.colors.textMuted).toBe('#526174');
    expect(visualTokens.colors.darkBackground).toBe('#080D16');
    expect(visualTokens.colors.darkSurface).toBe('#101827');
    expect(visualTokens.visualDialect).toBe('ops-control-plane');
    expect(visualTokens.darkModeStrategy).toBe('class');
    expect(visualTokens.fontFamilySans).toContain('Inter');
  });

  it('uses a tokenized operations control palette instead of the old fauvist deck', () => {
    const sharedThemeSources = [
      'tailwind.config.ts',
      'src/styles/visual-constitution.ts',
      'src/styles/tokens.css',
      'src/styles/globals.css',
      'src/styles/glass.css',
      'src/styles/animations.css'
    ].map((filePath) => readFileSync(join(process.cwd(), filePath), 'utf8').toLowerCase());

    const sharedTheme = sharedThemeSources.join('\n');

    expect(sharedTheme).toMatch(/#2563eb/);
    expect(sharedTheme).toMatch(/#0891b2/);
    expect(sharedTheme).toMatch(/#059669/);
    expect(sharedTheme).toMatch(/#ca8a04/);
    expect(sharedTheme).toMatch(/#dc2626/);
    expect(sharedTheme).not.toMatch(/#1e3aff|#ff3d18|#d9ff00|#00a878|#fffdf5|#fdfff1|#dce1ff/);
  });

  it('defines the shared visual system as primitive, semantic, and component tokens', () => {
    const tokensCss = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

    expect(tokensCss).toContain('Primitive color ramps');
    expect(tokensCss).toContain('Semantic colors');
    expect(tokensCss).toContain('Component tokens');
    expect(tokensCss).toContain('--ou-state-verified');
    expect(tokensCss).toContain('--ou-state-pending');
    expect(tokensCss).toContain('--ou-state-failed');
    expect(tokensCss).toContain('--ou-focus-ring');
    expect(tokensCss).not.toMatch(/--ou-radius:\s*0;/u);
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

  it('disables shared cockpit row motion for reduced-motion users', () => {
    const glassCss = readFileSync(join(process.cwd(), 'src/styles/glass.css'), 'utf8');
    const motionSelectorBlock = glassCss.match(
      /\.nodes-host-pill,[\s\S]*?\.forwarding-runtime-path-card \{\s*transition:/u
    );
    const reducedMotionBlock = glassCss.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/u);

    expect(motionSelectorBlock?.[0]).toBeTruthy();
    expect(reducedMotionBlock?.[0]).toBeTruthy();

    const rowSelectors = Array.from(motionSelectorBlock?.[0].matchAll(/\.([a-z0-9-]+)(?=,|\s+\{)/gu) ?? []).map(
      (match) => match[1]
    );
    const reducedSelectors = new Set(
      Array.from(reducedMotionBlock?.[0].matchAll(/\.([a-z0-9-]+)(?=,|\s+\{)/gu) ?? []).map((match) => match[1])
    );

    expect(rowSelectors).toContain('tasks-release-row');
    expect(rowSelectors).toContain('nodes-customer-node-row');
    expect(rowSelectors).toContain('forwarding-ops-rule-row');
    expect(rowSelectors).toContain('forwarding-runtime-path-card');
    expect(rowSelectors).toContain('subscription-ops-client-row');
    expect(rowSelectors).toContain('customer-ops-row');
    expect(rowSelectors.filter((selector) => !reducedSelectors.has(selector))).toEqual([]);
  });

  it('keeps the global operations backdrop static while preserving reduced-motion safe transitions', () => {
    const animationsCss = readFileSync(join(process.cwd(), 'src/styles/animations.css'), 'utf8');

    expect(animationsCss).toMatch(/\.ou-shell-backdrop\s*\{[\s\S]*position:\s*fixed/u);
    expect(animationsCss).toMatch(/\.ou-shell-backdrop\s*\{[\s\S]*width:\s*100vw/u);
    expect(animationsCss).toMatch(/\.ou-shell-backdrop\s*\{[\s\S]*max-width:\s*100vw/u);
    expect(animationsCss).toMatch(/\.ou-shell-backdrop\s*\{[\s\S]*repeating-linear-gradient\(135deg/u);
    expect(animationsCss).toMatch(/\.ou-shell-backdrop\s*\{[\s\S]*var\(--ou-bg\)/u);
    expect(animationsCss).toMatch(/\.btn-glow,[\s\S]*\.ou-select,[\s\S]*summary\s*\{[\s\S]*transition:/u);
    expect(animationsCss).toMatch(/\.btn-glow:hover,[\s\S]*\.ou-select:hover,[\s\S]*summary:hover\s*\{[\s\S]*translateY\(-1px\)/u);
    expect(animationsCss).toMatch(/\.btn-glow:active,[\s\S]*\.ou-select:active,[\s\S]*summary:active\s*\{[\s\S]*translateY\(1px\)\s*scale\(0\.99\)/u);
    expect(animationsCss).toMatch(/button:not\(\[disabled\]\):not\(\[aria-disabled='true'\]\):active\s*\{[\s\S]*translateY\(1px\)\s*scale\(0\.99\)/u);
    expect(animationsCss).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.ou-shell-backdrop,[\s\S]*\.ou-page-enter,[\s\S]*\.ou-card-enter,[\s\S]*\.ou-fade-in,[\s\S]*\.btn-glow,[\s\S]*\.ou-select,[\s\S]*summary/u);
  });

  it('animates dashboard host connectivity with a real dashed flow and reduced-motion fallback', () => {
    const animationsCss = readFileSync(join(process.cwd(), 'src/styles/animations.css'), 'utf8');

    expect(animationsCss).toMatch(/\.dashboard-connectivity-flow\.svg-line-dash\s*\{[\s\S]*stroke-dasharray:/u);
    expect(animationsCss).toMatch(/\.dashboard-connectivity-flow\.svg-line-dash\s*\{[\s\S]*animation:\s*ouConnectivityFlow/u);
    expect(animationsCss).toMatch(/\.dashboard-connectivity-packet\s*\{[\s\S]*filter:\s*drop-shadow/u);
    expect(animationsCss).toMatch(/\.dashboard-connectivity-node\[data-connectivity-state='issues'\]\s*\{[\s\S]*animation-name:\s*ouConnectivityIssuePulse/u);
    expect(animationsCss).toMatch(/\.dashboard-connectivity-node\[data-connectivity-state='waiting'\]\s*\{[\s\S]*animation-name:\s*ouConnectivityWaitingPulse/u);
    expect(animationsCss).toContain('@keyframes ouConnectivityFlow');
    expect(animationsCss).toContain('@keyframes ouConnectivityIssuePulse');
    expect(animationsCss).toContain('@keyframes ouConnectivityWaitingPulse');
    expect(animationsCss).toMatch(/@keyframes ouConnectivityFlow[\s\S]*stroke-dashoffset:\s*-80/u);
    expect(animationsCss).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.dashboard-connectivity-flow\.svg-line-dash,[\s\S]*\.dashboard-connectivity-packet,[\s\S]*\.dashboard-connectivity-node/u);
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
    expect(document.querySelector('.ou-shell-color-block')).toBeNull();
    expect(document.querySelector('.ou-shell-ribbon')).toBeNull();
  });
});
