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
    expect(script).toContain('"telemetry": telemetry,');
    expect(script).toContain('telemetry_agent_id = command.get("agentId") or os.environ.get("OU_AGENT_ID")');
    expect(script).toContain('telemetry_session_id = command.get("sessionId") or os.environ.get("OU_AGENT_SESSION_ID")');
    expect(script).toContain('"telemetry_sample"');
    expect(script).toContain('minimum_seq=ack_event["seq"],');
    expect(script).toContain('send_event_or_queue(state_dir, master_poll_url, token, telemetry_event, queue_on_failure=True)');
    expect(script).not.toContain('"runtime": "acknowledged"');
  });

  it('reports unsupported Agent command types as failed results', () => {
    expect(script).toContain('raise RuntimeError(f"unsupported Agent command type: {command.get(\'type\')}")');
    expect(script).toContain('"status": "failed"');
    expect(script).toContain('"failureReason": str(error)');
  });

  it('queues automatic heartbeat and telemetry events when delivery fails', () => {
    expect(script).toContain('heartbeat_event = build_agent_event(');
    expect(script).toContain('"heartbeat",');
    expect(script).toContain('heartbeat_event,');
    expect(script).toContain('queue_on_failure=True,');
    expect(script).toContain('telemetry_event = build_agent_event(state_dir, agent_id, session_id, "telemetry_sample", payload)');
    expect(script).toContain('send_event_or_queue(state_dir, master_poll_url, token, telemetry_event, queue_on_failure=True)');
    expect(script).toContain('marker_path.parent.mkdir(parents=True, exist_ok=True)');
    expect(script).toContain('marker_path.write_text(str(now), encoding="utf-8")');
  });
});
