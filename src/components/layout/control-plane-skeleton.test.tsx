import { render, screen } from '@testing-library/react';
import { ControlPlaneSkeleton } from './control-plane-skeleton';

describe('ControlPlaneSkeleton', () => {
  it('uses formal production control-plane copy while loading the workspace', () => {
    render(<ControlPlaneSkeleton language="zh" />);

    expect(screen.getByRole('status', { name: '正在同步控制面' })).toBeInTheDocument();
    expect(screen.getByText('正在并行拉取主机、客户节点、端口转发、订阅和审计证据。')).toBeInTheDocument();
    expect(screen.queryByText(/小秘书/)).not.toBeInTheDocument();
  });
});
