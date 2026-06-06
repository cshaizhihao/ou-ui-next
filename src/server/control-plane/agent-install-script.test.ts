import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ou-agent install script contract', () => {
  const script = readFileSync(resolve(process.cwd(), 'public/install/ou-agent.sh'), 'utf8');

  it('executes explicit health and telemetry commands instead of treating them as acknowledged no-ops', () => {
    expect(script).toContain('def health_command(state_dir, command):');
    expect(script).toContain('def telemetry_command(state_dir, command):');
    expect(script).toContain('def collect_load_average():');
    expect(script).toContain('def collect_runtime_service_health(state_dir):');
    expect(script).toContain('"loadAverage1m": round(one, 2),');
    expect(script).toContain('"runtimeServices": collect_runtime_service_health(state_dir),');
    expect(script).toContain('add(os.environ.get("OU_AGENT_SERVICE_NAME", "ou-ui-agent"), "agent", True)');
    expect(script).toContain('add("ou-ui-xray.service", "xray", has_xray_inbounds)');
    expect(script).toContain('add(entry["unit"], "port-forwarding", True, {"listener": entry.get("listener")})');
    expect(script).toContain('if not unit_path.exists():\n        return "missing"');
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

  it('submits the install profile as registration capabilities', () => {
    expect(script).toContain('json_array_from_csv()');
    expect(script).toContain('capabilities_json="$(json_array_from_csv "${OU_INSTALL_PROFILE}")"');
    expect(script).toContain('\\"capabilities\\":${capabilities_json}');
  });

  it('installs a local Agent doctor command without printing runtime tokens', () => {
    const doctorSlice = script.slice(
      script.indexOf('show_doctor()'),
      script.indexOf('do_uninstall()')
    );

    expect(script).toContain('show_doctor()');
    expect(script).toContain('doctor|diagnose|d)');
    expect(script).toContain('7|d|D|doctor|DOCTOR) show_doctor ;;');
    expect(script).toContain('doctor     运行本机诊断，不输出 Agent token');
    expect(doctorSlice).toContain('OU-UI Agent 本机诊断');
    expect(doctorSlice).toContain('Token: ${token_state}');
    expect(doctorSlice).toContain('Pending events: ${pending_count}');
    expect(doctorSlice).toContain('Event seq: ${event_seq}');
    expect(doctorSlice).toContain('Last seen command seq: ${last_seen_seq}');
    expect(doctorSlice).toContain('Xray binary: $(command_path_summary xray)');
    expect(doctorSlice).toContain('GOST binary: $(command_path_summary gost)');
    expect(doctorSlice).toContain('Host runtime state: $(file_present_summary "${runtime_dir}/host-agent.json")');
    expect(doctorSlice).toContain('Port-forwarding runtime state: $(file_present_summary "${runtime_dir}/port-forwarding.json")');
    expect(doctorSlice).toContain('Xray guardrails: $(file_present_summary "${runtime_dir}/xray-client-guardrails.json")');
    expect(doctorSlice).not.toContain('${OU_AGENT_TOKEN}');
  });

  it('installs a local Agent acceptance evidence bundle command with redacted logs', () => {
    const acceptanceSlice = script.slice(
      script.indexOf('run_agent_acceptance()'),
      script.indexOf('do_uninstall()')
    );

    expect(script).toContain('run_agent_acceptance()');
    expect(script).toContain('redact_agent_evidence_stream()');
    expect(script).toContain('agent_acceptance_file_manifest_json()');
    expect(script).toContain('8|qa|QA|acceptance|ACCEPTANCE|evidence|EVIDENCE) run_agent_acceptance ;;');
    expect(script).toContain('acceptance|qa|evidence|evidence-bundle)');
    expect(script).toContain('acceptance 生成 Agent 验收证据包，包含 doctor、服务状态、脱敏日志尾部和 SHA-256 manifest');
    expect(acceptanceSlice).toContain('"schemaVersion":"ou-ui-agent.acceptance-bundle.v1"');
    expect(acceptanceSlice).toContain('show_doctor >"${doctor_log}" 2>&1');
    expect(acceptanceSlice).toContain('systemctl status "${SERVICE_NAME}" --no-pager >"${service_status_log}" 2>&1');
    expect(acceptanceSlice).toContain('tail -n 300 "${agent_log}" | redact_agent_evidence_stream >"${agent_log_tail}"');
    expect(acceptanceSlice).toContain('"evidence":{"doctorLog":${doctor_file_manifest}');
    expect(acceptanceSlice).not.toContain('${OU_AGENT_TOKEN}');
    expect(script).toContain("s/(OU_AGENT_TOKEN=)[^[:space:]]+/\\1[redacted]/g");
    expect(script).toContain("s/([Bb]earer )[A-Za-z0-9._~+\\/=-]+/\\1[redacted]/g");
    expect(script).toContain('s/("agentToken"[[:space:]]*:[[:space:]]*")[^"]+/\\1[redacted]/g');
  });

  it('installs a local Agent acceptance evidence verifier command', () => {
    const verifierSlice = script.slice(
      script.indexOf('verify_agent_acceptance()'),
      script.indexOf('do_uninstall()')
    );

    expect(script).toContain('verify_agent_acceptance()');
    expect(script).toContain('9|qv|QV|acceptance-verify|ACCEPTANCE-VERIFY|qa-verify|QA-VERIFY|evidence-verify|EVIDENCE-VERIFY)');
    expect(script).toContain('acceptance-verify|qa-verify|qv|evidence-verify)');
    expect(script).toContain('acceptance-verify 校验 Agent 验收证据包 manifest 中记录的文件大小和 SHA-256');
    expect(verifierSlice).toContain('manifest.get("schemaVersion") != "ou-ui-agent.acceptance-bundle.v1"');
    expect(verifierSlice).toContain('"doctorLog": "doctor.txt"');
    expect(verifierSlice).toContain('"serviceStatus": "service-status.txt"');
    expect(verifierSlice).toContain('"agentLogTail": "agent-log-tail.txt"');
    expect(verifierSlice).toContain('Agent 验收证据包完整性校验通过。');
    expect(verifierSlice).toContain('大小不匹配');
    expect(verifierSlice).toContain('SHA-256 不匹配');
  });

  it('rotates runtime credentials before expiry and reloads the updated env on the next runner loop', () => {
    expect(script).toContain('RUNTIME_CREDENTIAL_ROTATE_WINDOW_SECONDS = 72 * 60 * 60');
    expect(script).toContain('def maybe_rotate_runtime_credential(state_dir, master_poll_url, token, agent_id, session_id):');
    expect(script).toContain('rotate_url = master_poll_url.rstrip("/").rsplit("/", 1)[0] + "/credentials/rotate"');
    expect(script).toContain('"reason": "agent.runtime_credential_renewal"');
    expect(script).toContain('"OU_AGENT_TOKEN": next_token,');
    expect(script).toContain('write_agent_env_file(updates)');
    expect(script).toContain('os.environ.update(updates)');
    expect(script).toContain('token = maybe_rotate_runtime_credential(state_dir, master, token, agent_id, session_id)');
    expect(script).toContain('while true; do\n  # shellcheck disable=SC1091\n  source "${CONFIG_DIR}/agent.env"');
  });

  it('drops non-retryable stale Agent event conflicts from the pending queue', () => {
    expect(script).toContain('NON_RETRYABLE_AGENT_EVENT_ERROR_CODES = {');
    expect(script).toContain('"agent_event.command_deadline_expired"');
    expect(script).toContain('"agent_event.sequence_replay"');
    expect(script).toContain('def read_http_error_code(error):');
    expect(script).toContain('def is_non_retryable_agent_event_error(error):');
    expect(script).toContain('if is_non_retryable_agent_event_error(error):\n                log(state_dir, f"dropped non-retryable pending Agent event {event.get(\'eventId\')}: {error}")');
    expect(script).toContain('remaining.pop(0)\n                save_pending_events(state_dir, remaining)\n                continue');
    expect(script).toContain('if is_non_retryable_agent_event_error(error):\n            log(state_dir, f"dropped non-retryable Agent event {event.get(\'eventId\')}: {error}")');
    expect(script).toContain('log(state_dir, f"dropped expired Agent command {command.get(\'commandId\')} after ACK rejection: {error}")');
    expect(script).toContain('return command_seq');
  });

  it('sends bounded command output as Agent log chunk events before the command result', () => {
    const processCommand = script.slice(
      script.indexOf('def process_command'),
      script.indexOf('def main()')
    );

    expect(script).toContain('OU_AGENT_COMMAND_LOG_MAX_CHUNKS=${OU_AGENT_COMMAND_LOG_MAX_CHUNKS:-20}');
    expect(script).toContain('COMMAND_LOG_CHUNK_MAX_CHARS = 60_000');
    expect(script).toContain('def reset_command_log_buffer():');
    expect(script).toContain('def record_command_log(stream, content):');
    expect(script).toContain('def send_command_log_chunks(state_dir, master_poll_url, token, command, minimum_seq, payload):');
    expect(script).toContain('read_positive_int_env("OU_AGENT_COMMAND_LOG_MAX_CHUNKS", 20');
    expect(script).toContain('output_limit = max(0, max_chunks - 1)');
    expect(script).toContain('"outputTruncated": output_truncated');
    expect(script).toContain('record_command_log("runtime", f"$ {command_line}\\nexitCode={result.returncode}")');
    expect(script).toContain('record_command_log("stdout", result.stdout)');
    expect(script).toContain('record_command_log("stderr", result.stderr)');
    expect(script).toContain('"log_chunk"');
    expect(script).toContain('"chunkSeq": chunk_seq');
    expect(script).toContain('"content": entry["content"]');
    expect(processCommand).toContain('reset_command_log_buffer()');
    expect(processCommand.indexOf('send_command_log_chunks(state_dir, master_poll_url, token, command, ack_event["seq"], payload)')).toBeLessThan(
      processCommand.indexOf('result_event = build_command_event(state_dir, command, "result", payload, minimum_seq=ack_event["seq"])')
    );
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

  it('removes stale TCP and UDP forwarding units when forwarding rules are edited or deleted', () => {
    const applyForwardingArtifact = script.slice(
      script.indexOf('def apply_forwarding_artifact'),
      script.indexOf('def apply_artifact')
    );

    expect(script).toContain('def forwarding_service_units(service_name, protocol=None):');
    expect(script).toContain('protocols = forward_protocols(protocol) if protocol else ["tcp", "udp"]');
    expect(script).toContain('*[systemd_unit_dir() / unit for unit in forwarding_service_units(service_name)],');
    expect(script).toContain('def stop_and_remove_forwarding_units(state_dir, service_name, protocol=None):');
    expect(applyForwardingArtifact).toContain('changed.extend(stop_and_remove_forwarding_units(state_dir, service_name))');
    expect(applyForwardingArtifact.indexOf('changed.extend(stop_and_remove_forwarding_units(state_dir, service_name))')).toBeLessThan(
      applyForwardingArtifact.indexOf('delete_forwarding_counter_rules(service_name)')
    );
    expect(applyForwardingArtifact.lastIndexOf('changed.extend(stop_and_remove_forwarding_units(state_dir, service_name))')).toBeLessThan(
      applyForwardingArtifact.indexOf('for unit_protocol in forward_protocols(protocol):\n        assert_port_available')
    );
    expect(applyForwardingArtifact).toContain('if rule.get("enabled") is False:');
    expect(applyForwardingArtifact).toContain('"runtime": "disabled"');
  });

  it('records the Xray systemd unit when deleting the last customer node stops the runtime', () => {
    const applyXrayArtifact = script.slice(
      script.indexOf('def apply_xray_artifact'),
      script.indexOf('def forward_protocols')
    );

    expect(applyXrayArtifact).toContain('unit_path = systemd_unit_dir() / "ou-ui-xray.service"');
    expect(applyXrayArtifact).toContain('unit_existed = unit_path.exists()');
    expect(applyXrayArtifact).toContain('stop_and_remove_unit(state_dir, "ou-ui-xray.service")');
    expect(applyXrayArtifact).toContain('if unit_existed:\n            changed.append(str(unit_path))');
    expect(applyXrayArtifact.indexOf('unit_existed = unit_path.exists()')).toBeLessThan(
      applyXrayArtifact.indexOf('stop_and_remove_unit(state_dir, "ou-ui-xray.service")')
    );
  });

  it('collects monthly Xray client traffic counters from the Agent runtime', () => {
    expect(script).toContain('"profiles.d" / f"{tag}.json"');
    expect(script).toContain('"api": {"tag": "ou-api", "services": ["StatsService"]}');
    expect(script).toContain('def collect_xray_client_counters(state_dir):');
    expect(script).toContain('[xray_bin, "api", "statsquery", "--server", f"127.0.0.1:{xray_api_port()}"]');
    expect(script).toContain('"xray-client-traffic-baselines.json"');
    expect(script).toContain('def enforce_xray_client_guardrails(state_dir, profiles, samples):');
    expect(script).toContain('def xray_guardrail_evaluations_to_samples(evaluations, sampled_at):');
    expect(script).toContain('"xray-client-guardrails.json"');
    expect(script).toContain('"xray_client_monthly_quota_exceeded"');
    expect(script).toContain('"source": "xray-guardrail"');
    expect(script).toContain('return xray_guardrail_evaluations_to_samples(evaluations, sampled_at)');
    expect(script).toContain('"source": "xray-stats"');
    expect(script).toContain('"xrayClientCounters": collect_xray_client_counters(state_dir)');
  });

  it('restores only host-guardrail-stopped runtime units after policy recovery', () => {
    const hostGuardrailSlice = script.slice(
      script.indexOf('def stop_managed_runtime_units'),
      script.indexOf('def update_monthly_traffic_baseline')
    );
    const telemetrySlice = script.slice(
      script.indexOf('def collect_telemetry'),
      script.indexOf('def send_heartbeat')
    );

    expect(hostGuardrailSlice).toContain('def restore_host_guardrail_units(state_dir, units):');
    expect(hostGuardrailSlice).toContain('current_managed_units = set(managed_runtime_units(state_dir))');
    expect(hostGuardrailSlice).toContain('unit not in current_managed_units');
    expect(hostGuardrailSlice).toContain('systemctl(state_dir, "enable", "--now", unit, check=False)');
    expect(hostGuardrailSlice).toContain('previous_stopped_units = previous_state.get("stoppedUnits", [])');
    expect(hostGuardrailSlice).toContain('state["restoredUnits"] = restore_host_guardrail_units(state_dir, previous_stopped_units)');
    expect(telemetrySlice).toContain('"hostGuardrailStoppedUnits": guardrail.get("stoppedUnits", [])');
    expect(telemetrySlice).toContain('"hostGuardrailRestoredUnits": guardrail.get("restoredUnits", [])');
  });
});
