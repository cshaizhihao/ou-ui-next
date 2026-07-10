import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OperatorWorkbenchPanel, type OperatorWorkbenchItem } from './operator-workbench-panel';

const items: OperatorWorkbenchItem[] = [
  {
    id: 'ready',
    label: 'Runtime verified',
    value: '4 ready',
    state: 'ready',
    meta: 'agent-result verified',
    description: 'All selected runtime evidence is verified.'
  },
  {
    id: 'attention',
    label: 'Needs review',
    value: '2 warnings',
    state: 'attention',
    actionLabel: 'Open review',
    onAction: vi.fn()
  },
  {
    id: 'blocked',
    label: 'Blocked',
    value: '1 failed',
    state: 'blocked'
  },
  {
    id: 'waiting',
    label: 'Waiting',
    value: '3 pending',
    state: 'waiting'
  }
];

describe('OperatorWorkbenchPanel', () => {
  it('renders all operation states with semantic data attributes', () => {
    const { container } = render(<OperatorWorkbenchPanel title="Operator Triage" items={items} />);

    expect(screen.getByRole('region', { name: 'Operator Triage' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operator-workbench-state="ready"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-operator-workbench-state="attention"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-operator-workbench-state="blocked"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-operator-workbench-state="waiting"]')).toHaveLength(3);
  });

  it('exposes copy diagnostics and item actions as labeled controls', async () => {
    const user = userEvent.setup();
    const onCopyDiagnostics = vi.fn();
    const onAction = vi.fn();

    render(
      <OperatorWorkbenchPanel
        copyLabel="Copy diagnostics"
        items={[{ ...items[1], onAction }]}
        onCopyDiagnostics={onCopyDiagnostics}
        subtitle="State derived from runtime evidence."
        title="Delivery Triage"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    await user.click(screen.getByRole('button', { name: 'Open review' }));

    expect(onCopyDiagnostics).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText('State derived from runtime evidence.')).toBeInTheDocument();
  });
});
