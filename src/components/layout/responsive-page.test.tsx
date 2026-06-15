import { render, screen } from '@testing-library/react';
import { WorkspaceCockpit, WorkspaceCockpitScroller } from './responsive-page';

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
});
