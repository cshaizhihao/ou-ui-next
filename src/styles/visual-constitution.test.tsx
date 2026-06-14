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
    expect(visualTokens.colors.primary).toBe('#1E3AFF');
    expect(visualTokens.colors.secondary).toBe('#07111F');
    expect(visualTokens.colors.accent).toBe('#FF3D18');
    expect(visualTokens.colors.lightBackground).toBe('#FDFFF1');
    expect(visualTokens.colors.lightSurface).toBe('#FFFDF5');
    expect(visualTokens.colors.lightSurfaceMuted).toBe('#EAF3D1');
    expect(visualTokens.colors.border).toBe('#07111F');
    expect(visualTokens.colors.textStrong).toBe('#07111F');
    expect(visualTokens.colors.textMuted).toBe('#35405A');
    expect(visualTokens.colors.darkBackground).toBe('#07111F');
    expect(visualTokens.colors.darkSurface).toBe('#101827');
    expect(visualTokens.visualDialect).toBe('fauvist-control-plane');
    expect(visualTokens.darkModeStrategy).toBe('class');
    expect(visualTokens.fontFamilySans).toContain('Geist');
  });

  it('uses a high-contrast fauvist control palette instead of the muted cobalt deck', () => {
    const sharedThemeSources = [
      'tailwind.config.ts',
      'src/styles/visual-constitution.ts',
      'src/styles/globals.css',
      'src/styles/glass.css',
      'src/styles/animations.css'
    ].map((filePath) => readFileSync(join(process.cwd(), filePath), 'utf8').toLowerCase());

    const sharedTheme = sharedThemeSources.join('\n');

    expect(sharedTheme).toMatch(/#1e3aff/);
    expect(sharedTheme).toMatch(/#ff3d18/);
    expect(sharedTheme).toMatch(/#00a878/);
    expect(sharedTheme).toMatch(/#d9ff00/);
    expect(sharedTheme).not.toMatch(/#2563eb|#1d4ed8|#60a5fa|#f97316|#fb923c|#2f55ff|#f15a24|#14b7aa|#f4b400/);
  });

  it('keeps shared cockpit CSS off the stale cobalt and orange RGB ramps', () => {
    const glassCss = readFileSync(join(process.cwd(), 'src/styles/glass.css'), 'utf8');

    expect(glassCss).toMatch(/rgba\(30,\s*58,\s*255,/);
    expect(glassCss).toMatch(/rgba\(255,\s*61,\s*24,/);
    expect(glassCss).not.toMatch(
      /rgba\((?:37,\s*99,\s*235|96,\s*165,\s*250|249,\s*115,\s*22|248,\s*250,\s*252|8,\s*15,\s*28),/
    );
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

  it('disables shared cockpit row motion for reduced-motion users', () => {
    const glassCss = readFileSync(join(process.cwd(), 'src/styles/glass.css'), 'utf8');
    const motionSelectorBlock = glassCss.match(
      /\.nodes-host-pill,[\s\S]*?\.customer-ops-row \{\s*transition:/u
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
    expect(rowSelectors).toContain('forwarding-ops-rule-row');
    expect(rowSelectors).toContain('subscription-ops-client-row');
    expect(rowSelectors).toContain('customer-ops-row');
    expect(rowSelectors.filter((selector) => !reducedSelectors.has(selector))).toEqual([]);
  });

  it('animates the global Fauvist backdrop and ribbon while disabling them for reduced-motion users', () => {
    const animationsCss = readFileSync(join(process.cwd(), 'src/styles/animations.css'), 'utf8');

    expect(animationsCss).toMatch(/\.ou-shell-backdrop\s*\{[\s\S]*animation:\s*ouBackdropSlide/u);
    expect(animationsCss).toMatch(/\.ou-shell-backdrop\s*\{[\s\S]*will-change:\s*background-position/u);
    expect(animationsCss).toMatch(/\.ou-shell-backdrop\s*\{[\s\S]*background-size:\s*124%\s+124%,\s*132%\s+132%,\s*128%\s+128%/u);
    expect(animationsCss).toMatch(/\.ou-shell-color-block\s*\{[\s\S]*animation:\s*ouColorBlockSlide/u);
    expect(animationsCss).toContain('@keyframes ouColorBlockSlide');
    expect(animationsCss).toMatch(/\.ou-shell-ribbon\s*\{[\s\S]*animation:\s*ouRibbonScroll/u);
    expect(animationsCss).toContain('@keyframes ouBackdropSlide');
    expect(animationsCss).toContain('@keyframes ouRibbonScroll');
    expect(animationsCss).toMatch(/@keyframes ouRibbonScroll[\s\S]*translate3d\(-42vw,\s*0,\s*0\)/u);
    expect(animationsCss).toMatch(/\.btn-glow,[\s\S]*\.glass-toggle\s*\{[\s\S]*transition:/u);
    expect(animationsCss).toMatch(/button:not\(\[disabled\]\):not\(\[aria-disabled='true'\]\):active\s*\{[\s\S]*translateY\(1px\)\s*scale\(0\.99\)/u);
    expect(animationsCss).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.ou-shell-backdrop,[\s\S]*\.ou-shell-color-block,[\s\S]*\.ou-shell-ribbon,[\s\S]*\.btn-glow/u);
  });

  it('animates dashboard host connectivity with a real dashed flow and reduced-motion fallback', () => {
    const animationsCss = readFileSync(join(process.cwd(), 'src/styles/animations.css'), 'utf8');

    expect(animationsCss).toMatch(/\.dashboard-connectivity-flow\.svg-line-dash\s*\{[\s\S]*stroke-dasharray:/u);
    expect(animationsCss).toMatch(/\.dashboard-connectivity-flow\.svg-line-dash\s*\{[\s\S]*animation:\s*ouConnectivityFlow/u);
    expect(animationsCss).toContain('@keyframes ouConnectivityFlow');
    expect(animationsCss).toMatch(/@keyframes ouConnectivityFlow[\s\S]*stroke-dashoffset:\s*-80/u);
    expect(animationsCss).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.dashboard-connectivity-flow\.svg-line-dash/u);
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
