import { render, screen } from '@testing-library/react';
import { MobileMetricStrip, WorkspaceCockpit, WorkspaceCockpitScroller } from './responsive-page';

describe('responsive workspace containers', () => {
  it('lets cockpit pages own vertical scrolling instead of clipping desktop content', () => {
    render(
      <WorkspaceCockpit aria-label="Test cockpit">
        <WorkspaceCockpitScroller aria-label="Test workspace">
          <div>workspace content</div>
        </WorkspaceCockpitScroller>
      </WorkspaceCockpit>
    );

    const cockpit = screen.getByRole('region', { name: 'Test cockpit' });
    const workspace = screen.getByRole('region', { name: 'Test workspace' });

    expect(cockpit.className).not.toContain('md:max-h');
    expect(cockpit.className).not.toContain('md:overflow-hidden');
    expect(workspace.className).not.toContain('md:max-h');
    expect(workspace.className).not.toContain('md:overflow-y-auto');
    expect(workspace).toHaveClass('overflow-visible');
  });

  it('adds mobile bottom-nav clearance to cockpit scrollers', () => {
    render(
      <WorkspaceCockpit aria-label="Test cockpit">
        <WorkspaceCockpitScroller aria-label="Test workspace">
          <div>workspace content</div>
        </WorkspaceCockpitScroller>
      </WorkspaceCockpit>
    );

    expect(screen.getByRole('region', { name: 'Test workspace' })).toHaveClass(
      'max-md:pb-[calc(7rem+env(safe-area-inset-bottom))]'
    );
  });

  it('keeps mobile metric tones on explicit OU palette colors instead of default template utilities', () => {
    const { container } = render(
      <MobileMetricStrip
        className="mobile-metric-strip"
        items={[
          { label: 'Command', value: '12', tone: 'blue' },
          { label: 'Runtime', value: '8', tone: 'emerald' },
          { label: 'Verify', value: '3', tone: 'amber' },
          { label: 'Blocked', value: '1', tone: 'red' },
          { label: 'Idle', value: '0', tone: 'slate' }
        ]}
      />
    );

    const markup = container.querySelector('.mobile-metric-strip')?.outerHTML ?? '';

    expect(markup).toContain('#1E3AFF');
    expect(markup).toContain('#00A878');
    expect(markup).toContain('#D9FF00');
    expect(markup).toContain('#DC2626');
    expect(markup).toContain('#07111F');
    expect(markup).not.toMatch(/\b(?:border|bg|text|ring)-(?:blue|emerald|amber|red|slate)-/u);
    expect(markup).not.toMatch(/\b(?:dark:)?(?:border|bg|text|ring)-(?:blue|emerald|amber|red|slate)-/u);
  });
});
