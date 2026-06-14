import { render, screen } from '@testing-library/react';
import { ControlPlaneSkeleton } from './control-plane-skeleton';

describe('ControlPlaneSkeleton', () => {
  it('uses a compact loading status without explanatory filler', () => {
    render(<ControlPlaneSkeleton language="zh" />);

    const skeleton = screen.getByRole('status', { name: '同步中' });
    expect(skeleton).toBeInTheDocument();
    expect(screen.queryByText('正在同步控制面')).not.toBeInTheDocument();
    expect(screen.queryByText('正在并行拉取主机、客户节点、端口转发、订阅和审计证据。')).not.toBeInTheDocument();
    expect(skeleton.querySelectorAll('[data-skeleton-card="true"]')).toHaveLength(0);
    expect(screen.queryByText(/小秘书/)).not.toBeInTheDocument();
  });
});
