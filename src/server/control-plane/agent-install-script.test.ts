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
    expect(script).toContain('"runtime": "command_failed"');
    expect(script).toContain('"commandType": command.get("type")');
  });

  it('verifies runtime artifact integrity before taking a local snapshot or applying files', () => {
    expect(script).toContain('def checksum_json(value):');
    expect(script).toContain('hashlib.sha256(normalized.encode("utf-8")).hexdigest()');
    expect(script).toContain('def verify_artifact_integrity(command, artifact):');
    expect(script).toContain('runtime artifact checksum mismatch');
    expect(script).toContain('runtime artifact signature does not match checksum');
    expect(script.indexOf('verify_artifact_integrity(command, artifact)')).toBeLessThan(
      script.indexOf('snapshot_manifest = create_local_snapshot')
    );
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

  it('calculates monthly host and forwarding traffic windows in the Agent runtime', () => {
    expect(script).toContain('def effective_monthly_reset_day(year, month, reset_day):');
    expect(script).toContain('if now.tm_mday < effective_monthly_reset_day(year, month, reset_day):');
    expect(script).toContain('"trafficBillingPeriod": period_key,');
    expect(script).toContain('def update_forwarding_counter_baseline(baselines, service_name, counter, reset_day):');
    expect(script).toContain('"forwarding-traffic-baselines.json"');
    expect(script).toContain('"trafficBillingPeriod": monthly_counter["trafficBillingPeriod"],');
    expect(script).toContain('billed_bytes = forwarding_rule_billed_bytes(rule, monthly_counter)');
  });

  it('collects monthly Xray client traffic counters from the Agent runtime', () => {
    expect(script).toContain('"profiles.d" / f"{tag}.json"');
    expect(script).toContain('"api": {"tag": "ou-api", "services": ["StatsService"]}');
    expect(script).toContain('def collect_xray_client_counters(state_dir):');
    expect(script).toContain('[xray_bin, "api", "statsquery", "--server", f"127.0.0.1:{xray_api_port()}"]');
    expect(script).toContain('"xray-client-traffic-baselines.json"');
    expect(script).toContain('def enforce_xray_client_guardrails(state_dir, profiles, samples):');
    expect(script).toContain('"xray-client-guardrails.json"');
    expect(script).toContain('"xray_client_monthly_quota_exceeded"');
    expect(script).toContain('"source": "xray-stats"');
    expect(script).toContain('"xrayClientCounters": collect_xray_client_counters(state_dir)');
  });
});
