import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ou-agent install script contract', () => {
  const script = readFileSync(resolve(process.cwd(), 'public/install/ou-agent.sh'), 'utf8');

  it('executes explicit health and telemetry commands instead of treating them as acknowledged no-ops', () => {
    expect(script).toContain('def health_command(state_dir, command):');
    expect(script).toContain('def telemetry_command(state_dir, command):');
    expect(script).toContain('elif command.get("type") == "health":');
    expect(script).toContain('elif command.get("type") == "telemetry":');
    expect(script).toContain('"runtime": "healthy" if not failed_checks else "unhealthy"');
    expect(script).toContain('"runtime": "telemetry_collected"');
    expect(script).not.toContain('"runtime": "acknowledged"');
  });

  it('reports unsupported Agent command types as failed results', () => {
    expect(script).toContain('raise RuntimeError(f"unsupported Agent command type: {command.get(\'type\')}")');
    expect(script).toContain('"status": "failed"');
    expect(script).toContain('"failureReason": str(error)');
  });
});
