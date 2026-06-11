import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function extractShellFunctionBefore(script: string, functionName: string, nextFunctionName: string) {
  const start = script.indexOf(`${functionName}() {`);
  const end = script.indexOf(`\n${nextFunctionName}()`, start);

  if (start < 0 || end < 0) {
    throw new Error(`Unable to extract ${functionName}`);
  }

  return script.slice(start, end);
}

function extractAgentExecutorPython(script: string) {
  const marker = 'cat >"${INSTALL_ROOT}/bin/ou-agent-executor.py" <<\'PY\'';
  const start = script.indexOf(marker);
  const bodyStart = script.indexOf('\n', start) + 1;
  const end = script.indexOf('\nPY\n\n  cat >"${INSTALL_ROOT}/bin/ou-agent-runner"', bodyStart);

  if (start < 0 || bodyStart <= 0 || end < 0) {
    throw new Error('Unable to extract Agent executor Python');
  }

  return script.slice(bodyStart, end);
}

function sha256Text(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function runAgentRuntimeSummary(script: string) {
  const directory = mkdtempSync(join(tmpdir(), 'ou-ui-agent-runtime-summary-'));
  const stateDir = join(directory, 'state');
  const runtimeDir = join(stateDir, 'runtime');
  const outputPath = join(directory, 'runtime-summary.json');

  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'xray.json'),
    JSON.stringify({
      moduleKind: 'xray',
      runtime: 'running',
      inboundCount: 2,
      artifactVersion: 'ou-ui.runtime.xray-inbound.v1',
      artifact: {
        clientId: 'client-secret-uuid',
        clientEmail: 'secret@example.com'
      }
    })
  );
  writeFileSync(
    join(runtimeDir, 'port-forwarding.json'),
    JSON.stringify({
      moduleKind: 'port-forwarding',
      runtime: 'running',
      services: ['ou-forward-secret-tcp.service', 'ou-forward-secret-udp.service'],
      runtimeEngines: ['gost'],
      bind: '0.0.0.0:2443',
      upstream: '10.0.0.8:443',
      trafficCounterRuntime: 'nftables'
    })
  );
  writeFileSync(
    join(runtimeDir, 'port-forwarding-guardrails.json'),
    JSON.stringify({
      rules: [
        {
          ruleId: 'forward-secret',
          serviceName: 'ou-forward-secret',
          quotaExceeded: true,
          runtimeDisabledByPolicy: true,
          stoppedUnits: ['ou-forward-secret-tcp.service']
        }
      ]
    })
  );
  writeFileSync(
    join(runtimeDir, 'xray-client-guardrails.json'),
    JSON.stringify({
      rules: [
        {
          inboundId: 'inbound-secret',
          clientEmail: 'secret@example.com',
          clientId: 'client-secret-uuid',
          quotaExceeded: true,
          clientExpired: true,
          runtimeDisabledByPolicy: true
        }
      ]
    })
  );
  writeFileSync(join(runtimeDir, 'pending-events.json'), JSON.stringify([{ eventId: 'evt-secret' }]));

  const runtimeScript = [
    'set -Eeuo pipefail',
    `STATE_DIR=${JSON.stringify(stateDir)}`,
    `OU_AGENT_STATE_DIR=${JSON.stringify(stateDir)}`,
    extractShellFunctionBefore(script, 'write_agent_runtime_summary', 'run_agent_acceptance'),
    `write_agent_runtime_summary ${JSON.stringify(outputPath)}`,
    `cat ${JSON.stringify(outputPath)}`
  ].join('\n');

  try {
    const output = execFileSync('bash', ['-c', runtimeScript], { encoding: 'utf8' });
    return JSON.parse(output) as Record<string, unknown>;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeAgentAcceptanceBundleFixture(options: { finalSummaryEvidence?: boolean; runtimeEvidence?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ou-ui-agent-acceptance-verify-'));
  const bundleDir = join(root, '20260606T120000Z');
  const paths = {
    doctorLog: join(bundleDir, 'doctor.txt'),
    serviceStatus: join(bundleDir, 'service-status.txt'),
    agentLogTail: join(bundleDir, 'agent-log-tail.txt'),
    runtimeSummary: join(bundleDir, 'runtime-summary.json'),
    finalVerifyLog: join(bundleDir, 'final-acceptance-verify.txt'),
    finalSummary: join(bundleDir, 'final-acceptance-summary.json'),
    manifest: join(bundleDir, 'manifest.json')
  };
  const runtimeSummary = options.runtimeEvidence
    ? {
        schemaVersion: 'ou-ui-agent.runtime-summary.v1',
        status: 'ok',
        modules: [
          {
            moduleKind: 'xray',
            present: true,
            runtime: 'running',
            inboundCount: 1
          },
          {
            moduleKind: 'port-forwarding',
            present: true,
            runtime: 'running',
            serviceCount: 1
          }
        ],
        guardrails: {
          host: {
            present: true,
            quotaExceeded: false,
            hostExpired: false,
            runtimeDisabledByPolicy: false
          },
          portForwarding: {
            present: true,
            enforcementErrorCount: 0
          },
          xrayClients: {
            present: true,
            enforcementErrorCount: 0
          }
        },
        pendingEvents: {
          count: 0
        }
      }
    : {
        schemaVersion: 'ou-ui-agent.runtime-summary.v1',
        status: 'ok',
        modules: [],
        guardrails: {},
        pendingEvents: {
          count: 0
        }
      };
  const files = {
    doctorLog: 'doctor ok\n',
    serviceStatus: 'service ok\n',
    agentLogTail: 'log tail ok\n',
    runtimeSummary: `${JSON.stringify(runtimeSummary)}\n`,
    finalVerifyLog: ['[OK] Agent runtime evidence gate: passed', 'Agent 验收证据包完整性校验通过。'].join('\n') + '\n'
  };

  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(paths.doctorLog, files.doctorLog);
  writeFileSync(paths.serviceStatus, files.serviceStatus);
  writeFileSync(paths.agentLogTail, files.agentLogTail);
  writeFileSync(paths.runtimeSummary, files.runtimeSummary);

  const manifest = {
    schemaVersion: 'ou-ui-agent.acceptance-bundle.v1',
    createdAt: '2026-06-06T12:00:00Z',
    bundleDirectory: bundleDir,
    agentId: 'agent-redacted',
    master: 'https://master.example.test',
    profile: 'default',
    version: 'test',
    doctorStatus: 0,
    serviceStatus: 0,
    runtimeSummaryStatus: 0,
    runtimeSummary: paths.runtimeSummary,
    evidence: {
      doctorLog: {
        path: paths.doctorLog,
        sizeBytes: Buffer.byteLength(files.doctorLog),
        sha256: sha256Text(files.doctorLog)
      },
      serviceStatus: {
        path: paths.serviceStatus,
        sizeBytes: Buffer.byteLength(files.serviceStatus),
        sha256: sha256Text(files.serviceStatus)
      },
      agentLogTail: {
        path: paths.agentLogTail,
        sizeBytes: Buffer.byteLength(files.agentLogTail),
        sha256: sha256Text(files.agentLogTail)
      },
      runtimeSummary: {
        path: paths.runtimeSummary,
        sizeBytes: Buffer.byteLength(files.runtimeSummary),
        sha256: sha256Text(files.runtimeSummary)
      }
    }
  };
  const manifestText = `${JSON.stringify(manifest)}\n`;
  writeFileSync(paths.manifest, manifestText);

  if (options.finalSummaryEvidence) {
    writeFileSync(paths.finalVerifyLog, files.finalVerifyLog);
    const finalSummary = {
      schemaVersion: 'ou-ui-agent.final-acceptance-summary.v1',
      status: 'passed',
      createdAt: '2026-06-06T12:00:00Z',
      bundleDirectory: bundleDir,
      strictGates: {
        runtimeEvidence: true
      },
      manifest: {
        path: paths.manifest,
        sizeBytes: Buffer.byteLength(manifestText),
        sha256: sha256Text(manifestText)
      },
      finalVerifyLog: {
        path: paths.finalVerifyLog,
        sizeBytes: Buffer.byteLength(files.finalVerifyLog),
        sha256: sha256Text(files.finalVerifyLog)
      }
    };
    writeFileSync(paths.finalSummary, `${JSON.stringify(finalSummary)}\n`);
  }

  return { root, bundleDir, paths };
}

function runAgentAcceptanceVerifier(script: string, args: string[], entrypoint = 'verify_agent_acceptance') {
  const verifierScript = [
    'set -Eeuo pipefail',
    'APP_NAME="OU-UI Agent"',
    'fail() { printf "[%s] %s\\n" "${APP_NAME}" "$1" >&2; exit 1; }',
    extractShellFunctionBefore(script, 'verify_agent_acceptance', 'do_uninstall'),
    `${entrypoint} "$@"`
  ].join('\n');

  return spawnSync('bash', ['-s', '--', ...args], {
    input: verifierScript,
    encoding: 'utf8'
  });
}

function runAgentFinalAcceptance(script: string) {
  const directory = mkdtempSync(join(tmpdir(), 'ou-ui-agent-final-acceptance-'));
  const configDir = join(directory, 'config');
  const stateDir = join(directory, 'state');
  const runtimeSummary = {
    schemaVersion: 'ou-ui-agent.runtime-summary.v1',
    status: 'ok',
    modules: [
      {
        moduleKind: 'xray',
        present: true,
        runtime: 'running',
        inboundCount: 1
      },
      {
        moduleKind: 'port-forwarding',
        present: true,
        runtime: 'running',
        serviceCount: 1
      }
    ],
    guardrails: {
      host: {
        present: true,
        quotaExceeded: false,
        hostExpired: false,
        runtimeDisabledByPolicy: false
      },
      portForwarding: {
        present: true,
        enforcementErrorCount: 0
      },
      xrayClients: {
        present: true,
        enforcementErrorCount: 0
      }
    },
    pendingEvents: {
      count: 0
    }
  };

  mkdirSync(join(stateDir, 'logs'), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, 'agent.env'),
    [
      'OU_AGENT_ID=agent-test',
      'OU_MASTER=https://master.example.test/api/v1/agents/poll',
      'OU_INSTALL_PROFILE=host-agent,xray,port-forwarding',
      'OU_AGENT_VERSION=test',
      `OU_AGENT_STATE_DIR=${stateDir}`,
      `OU_AGENT_CONFIG_DIR=${configDir}`
    ].join('\n')
  );
  writeFileSync(join(stateDir, 'logs', 'agent.log'), 'Agent log token Bearer secret-token\n');

  const finalScript = [
    'set -Eeuo pipefail',
    'APP_NAME="OU-UI Agent"',
    `CONFIG_DIR=${JSON.stringify(configDir)}`,
    `STATE_DIR=${JSON.stringify(stateDir)}`,
    'SERVICE_NAME="ou-ui-agent"',
    'INSTALL_ROOT="/opt/ou-ui-agent"',
    'fail() { printf "[%s] %s\\n" "${APP_NAME}" "$1" >&2; exit 1; }',
    'log() { printf "[%s] %s\\n" "${APP_NAME}" "$1"; }',
    'require_root() { :; }',
    'show_doctor() { printf "doctor ok\\n"; }',
    'systemctl() { if [[ "${1:-}" == "status" ]]; then printf "service ok\\n"; return 0; fi; return 0; }',
    `write_agent_runtime_summary() { printf '%s\\n' ${JSON.stringify(JSON.stringify(runtimeSummary))} >"$1"; }`,
    extractShellFunctionBefore(script, 'json_escape_string', 'write_agent_runtime_summary'),
    extractShellFunctionBefore(script, 'run_agent_acceptance', 'verify_agent_acceptance'),
    extractShellFunctionBefore(script, 'verify_agent_acceptance', 'do_uninstall'),
    'run_agent_final_acceptance'
  ].join('\n');

  try {
    const result = spawnSync('bash', ['-c', finalScript], { encoding: 'utf8' });
    const bundleDir = result.stdout.match(/Agent 验收证据包: (.+)/)?.[1]?.trim() ?? '';
    const paths = {
      manifest: bundleDir ? join(bundleDir, 'manifest.json') : '',
      finalVerifyLog: bundleDir ? join(bundleDir, 'final-acceptance-verify.txt') : '',
      finalSummary: bundleDir ? join(bundleDir, 'final-acceptance-summary.json') : ''
    };
    const manifestText = paths.manifest && existsSync(paths.manifest) ? readFileSync(paths.manifest, 'utf8') : '';
    const finalVerifyLog =
      paths.finalVerifyLog && existsSync(paths.finalVerifyLog) ? readFileSync(paths.finalVerifyLog, 'utf8') : '';
    const finalSummaryText =
      paths.finalSummary && existsSync(paths.finalSummary) ? readFileSync(paths.finalSummary, 'utf8') : '';

    return {
      status: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
      bundleDir,
      paths,
      manifestText,
      manifest: manifestText ? JSON.parse(manifestText) : undefined,
      finalVerifyLog,
      finalSummaryText,
      finalSummary: finalSummaryText ? JSON.parse(finalSummaryText) : undefined
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('ou-agent install script contract', () => {
  const script = readFileSync(resolve(process.cwd(), 'public/install/ou-agent.sh'), 'utf8');

  it('executes explicit health and telemetry commands instead of treating them as acknowledged no-ops', () => {
    expect(script).toContain('def health_command(state_dir, command):');
    expect(script).toContain('def telemetry_command(state_dir, command):');
    expect(script).toContain('def upgrade_command(state_dir, command):');
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
    expect(script).toContain('elif command.get("type") == "upgrade":');
    expect(script).toContain('"runtime": "healthy" if not failed_checks else "unhealthy"');
    expect(script).toContain('"runtime": "telemetry_collected"');
    expect(script).toContain('"runtime": "agent_upgraded" if succeeded else "agent_upgrade_failed"');
    expect(script).toContain('"OU_AGENT_DEFER_RESTART": "1"');
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
    expect(script).toContain('failure_reason = bounded_failure_reason(error)');
    expect(script).toContain('"failureReason": failure_reason');
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
    expect(script).toContain('def runtime_capabilities_from_install_profile():');
    expect(script).toContain('"capabilities": runtime_capabilities_from_install_profile(),');
    expect(script).toContain('heartbeat_event = build_agent_event(');
    expect(script).toContain('"heartbeat",');
    expect(script).toContain('heartbeat_event,');
    expect(script).toContain('queue_on_failure=True,');
    expect(script).toContain('telemetry_event = build_agent_event(state_dir, agent_id, session_id, "telemetry_sample", payload)');
    expect(script).toContain('send_event_or_queue(state_dir, master_poll_url, token, telemetry_event, queue_on_failure=True)');
    expect(script).toContain('except (FileNotFoundError, ValueError):');
    expect(script).toContain('seq_path.parent.mkdir(parents=True, exist_ok=True)');
    expect(script).toContain('marker_path.parent.mkdir(parents=True, exist_ok=True)');
    expect(script).toContain('marker_path.write_text(str(now), encoding="utf-8")');
  });

  it('defaults polling and telemetry sampling to one second and reports the actual interval', () => {
    expect(script).toContain('OU_AGENT_POLL_INTERVAL_SECONDS=${OU_AGENT_POLL_INTERVAL_SECONDS:-1}');
    expect(script).toContain('OU_AGENT_TELEMETRY_INTERVAL_SECONDS=${OU_AGENT_TELEMETRY_INTERVAL_SECONDS:-1}');
    expect(script).toContain('"sampleIntervalSeconds": read_telemetry_interval_seconds(state_dir),');
  });

  it('falls back to a default ping target when host probe config is absent or null', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ou-ui-agent-probe-target-'));
    const configDir = join(directory, 'config');
    const stateDir = join(directory, 'state');
    const executorPath = join(directory, 'ou-agent-executor.py');

    mkdirSync(configDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(executorPath, extractAgentExecutorPython(script));

    try {
      const result = spawnSync(
        'python3',
        [
          '-',
          executorPath,
          stateDir,
          configDir
        ],
        {
          input: `
import importlib.util
import json
import os
import pathlib
import sys

spec = importlib.util.spec_from_file_location("ou_agent_executor", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

state_dir = sys.argv[2]
config_dir = pathlib.Path(sys.argv[3])

print(module.read_probe_target(state_dir))
(config_dir / "host-agent.json").write_text(json.dumps({"hostProfile": {"probeConfig": None}}), encoding="utf-8")
print(module.read_probe_target(state_dir))
(config_dir / "host-agent.json").write_text(json.dumps({"hostProfile": {"probeConfig": {"pingTarget": "9.9.9.9"}}}), encoding="utf-8")
print(module.read_probe_target(state_dir))
`,
          encoding: 'utf8',
          env: {
            ...process.env,
            OU_AGENT_CONFIG_DIR: configDir,
            OU_PING_TARGET: ''
          }
        }
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout.trim().split('\n')).toEqual(['1.1.1.1', '1.1.1.1', '9.9.9.9']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('submits the install profile as registration capabilities', () => {
    expect(script).toContain('json_array_from_csv()');
    expect(script).toContain('json_array_append_unique()');
    expect(script).toContain('capabilities_json="$(json_array_append_unique "$(json_array_from_csv "${OU_INSTALL_PROFILE}")" "self-update")"');
    expect(script).toContain('\\"capabilities\\":${capabilities_json}');
  });

  it('continues installing when all Agent runtime dependencies already exist', () => {
    expect(script).toContain('[[ "${missing}" == "yes" ]] || return 0');
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
    const runtimeSummarySlice = script.slice(
      script.indexOf('write_agent_runtime_summary()'),
      script.indexOf('run_agent_acceptance()')
    );
    const acceptanceSlice = script.slice(
      script.indexOf('run_agent_acceptance()'),
      script.indexOf('do_uninstall()')
    );

    expect(script).toContain('run_agent_acceptance()');
    expect(script).toContain('verify_agent_final_acceptance_bundle()');
    expect(script).toContain('redact_agent_evidence_stream()');
    expect(script).toContain('write_agent_runtime_summary()');
    expect(script).toContain('agent_acceptance_file_manifest_json()');
    expect(script).toContain('8|qa|QA|acceptance|ACCEPTANCE|evidence|EVIDENCE) run_agent_acceptance ;;');
    expect(script).toContain('10|qf|QF|final-acceptance|FINAL-ACCEPTANCE|acceptance-final|ACCEPTANCE-FINAL|field-acceptance|FIELD-ACCEPTANCE) run_agent_final_acceptance ;;');
    expect(script).toContain('11|qvf|QVF|final-acceptance-verify|FINAL-ACCEPTANCE-VERIFY|verify-final-acceptance|VERIFY-FINAL-ACCEPTANCE|field-acceptance-verify|FIELD-ACCEPTANCE-VERIFY)');
    expect(script).toContain('acceptance|qa|evidence|evidence-bundle)');
    expect(script).toContain('final-acceptance|acceptance-final|field-acceptance|qf)');
    expect(script).toContain('final-acceptance-verify|verify-final-acceptance|field-acceptance-verify|qvf)');
    expect(script).toContain('acceptance 生成 Agent 验收证据包，包含 doctor、服务状态、脱敏日志尾部、脱敏 runtime 摘要和 SHA-256 manifest');
    expect(script).toContain('final-acceptance 生成 Agent 验收证据包并立即执行严格 runtime qv 校验');
    expect(script).toContain('final-acceptance-verify 一次性复核 Agent 最终验收包的 runtime 和 final summary strict gate');
    expect(runtimeSummarySlice).toContain('"schemaVersion": "ou-ui-agent.runtime-summary.v1"');
    expect(runtimeSummarySlice).toContain('file_summary("xray", Path("runtime/xray.json"))');
    expect(runtimeSummarySlice).toContain('module_summary("port-forwarding", "port-forwarding.json")');
    expect(runtimeSummarySlice).toContain('rule_guardrail_summary("xray-client-guardrails.json", "xray-client")');
    expect(runtimeSummarySlice).not.toContain('"artifact":');
    expect(acceptanceSlice).toContain('"schemaVersion":"ou-ui-agent.acceptance-bundle.v1"');
    expect(acceptanceSlice).toContain('show_doctor >"${doctor_log}" 2>&1');
    expect(acceptanceSlice).toContain('systemctl status "${SERVICE_NAME}" --no-pager >"${service_status_log}" 2>&1');
    expect(acceptanceSlice).toContain('tail -n 300 "${agent_log}" | redact_agent_evidence_stream >"${agent_log_tail}"');
    expect(acceptanceSlice).toContain('write_agent_runtime_summary "${runtime_summary}"');
    expect(acceptanceSlice).toContain('runtime-summary.json');
    expect(acceptanceSlice).toContain('"runtimeSummaryStatus":${runtime_summary_status}');
    expect(acceptanceSlice).toContain('"runtimeSummary":${runtime_summary_file_manifest}');
    expect(acceptanceSlice).toContain('"evidence":{"doctorLog":${doctor_file_manifest}');
    expect(acceptanceSlice).not.toContain('${OU_AGENT_TOKEN}');
    expect(script).toContain("s/(OU_AGENT_TOKEN=)[^[:space:]]+/\\1[redacted]/g");
    expect(script).toContain("s/([Bb]earer )[A-Za-z0-9._~+\\/=-]+/\\1[redacted]/g");
    expect(script).toContain('s/("agentToken"[[:space:]]*:[[:space:]]*")[^"]+/\\1[redacted]/g');
  });

  it('writes sanitized Agent runtime summaries for acceptance evidence', () => {
    const summary = runAgentRuntimeSummary(script);

    expect(summary).toMatchObject({
      schemaVersion: 'ou-ui-agent.runtime-summary.v1',
      status: 'ok',
      modules: expect.arrayContaining([
        expect.objectContaining({
          moduleKind: 'xray',
          present: true,
          runtime: 'running',
          inboundCount: 2
        }),
        expect.objectContaining({
          moduleKind: 'port-forwarding',
          present: true,
          runtime: 'running',
          serviceCount: 2,
          runtimeEngines: ['gost'],
          trafficCounterRuntime: 'nftables'
        })
      ]),
      guardrails: {
        portForwarding: expect.objectContaining({
          ruleCount: 1,
          quotaExceededCount: 1,
          runtimeDisabledByPolicyCount: 1,
          stoppedUnitCount: 1
        }),
        xrayClients: expect.objectContaining({
          ruleCount: 1,
          quotaExceededCount: 1,
          runtimeDisabledByPolicyCount: 1,
          clientExpiredCount: 1
        })
      },
      pendingEvents: {
        count: 1
      }
    });
    expect(JSON.stringify(summary)).not.toContain('secret@example.com');
    expect(JSON.stringify(summary)).not.toContain('client-secret-uuid');
    expect(JSON.stringify(summary)).not.toContain('10.0.0.8');
    expect(JSON.stringify(summary)).not.toContain('ou-forward-secret-tcp.service');
  });

  it('installs a local Agent acceptance evidence verifier command', () => {
    const verifierSlice = script.slice(
      script.indexOf('verify_agent_acceptance()'),
      script.indexOf('do_uninstall()')
    );

    expect(script).toContain('verify_agent_acceptance()');
    expect(script).toContain('9|qv|QV|acceptance-verify|ACCEPTANCE-VERIFY|qa-verify|QA-VERIFY|evidence-verify|EVIDENCE-VERIFY)');
    expect(script).toContain('acceptance-verify|qa-verify|qv|evidence-verify)');
    expect(script).toContain('追加 --require-runtime-evidence 可强制校验 manifest.createdAt 为有效 UTC ISO 时间');
    expect(script).toContain('非空 manifest.bundleDirectory、主 manifest 证据路径');
    expect(script).toContain('最终摘要 createdAt 有效、bundleDirectory 非空且与 manifest.bundleDirectory 一致');
    expect(script).toContain('--require-runtime-evidence');
    expect(script).toContain('--require-final-summary');
    expect(verifierSlice).toContain('manifest.get("schemaVersion") != "ou-ui-agent.acceptance-bundle.v1"');
    expect(verifierSlice).toContain('"doctorLog": "doctor.txt"');
    expect(verifierSlice).toContain('"serviceStatus": "service-status.txt"');
    expect(verifierSlice).toContain('"agentLogTail": "agent-log-tail.txt"');
    expect(verifierSlice).toContain('"runtimeSummary": "runtime-summary.json"');
    expect(verifierSlice).toContain("runtimeSummary={manifest.get('runtimeSummaryStatus', 'not-recorded')}");
    expect(verifierSlice).toContain('validate_runtime_summary');
    expect(verifierSlice).toContain('Agent runtime evidence gate: passed');
    expect(verifierSlice).toContain('Agent final acceptance summary gate: passed');
    expect(verifierSlice).toContain('Agent 验收证据包完整性校验通过。');
    expect(verifierSlice).toContain('大小不匹配');
    expect(verifierSlice).toContain('SHA-256 不匹配');

    const fixture = writeAgentAcceptanceBundleFixture({ finalSummaryEvidence: true, runtimeEvidence: true });
    const invalidManifestCreatedAtFixture = writeAgentAcceptanceBundleFixture({ runtimeEvidence: true });
    const invalidManifestEvidencePathFixture = writeAgentAcceptanceBundleFixture({ runtimeEvidence: true });
    const missingRuntimeFixture = writeAgentAcceptanceBundleFixture();
    const missingFinalSummaryFixture = writeAgentAcceptanceBundleFixture({ runtimeEvidence: true });

    try {
      const defaultResult = runAgentAcceptanceVerifier(script, [fixture.bundleDir]);
      expect(defaultResult.status).toBe(0);
      expect(defaultResult.stdout).toContain('Agent 验收证据包完整性校验通过');

      const strictResult = runAgentAcceptanceVerifier(script, ['--require-runtime-evidence', fixture.bundleDir]);
      expect(strictResult.status).toBe(0);
      expect(strictResult.stdout).toContain('[OK] Agent runtime evidence gate: passed');

      const manifestWithoutBundleDirectory = JSON.parse(readFileSync(fixture.paths.manifest, 'utf8'));
      manifestWithoutBundleDirectory.bundleDirectory = '';
      writeFileSync(fixture.paths.manifest, `${JSON.stringify(manifestWithoutBundleDirectory)}\n`);
      const defaultMissingManifestBundleDirectoryResult = runAgentAcceptanceVerifier(script, [fixture.bundleDir]);
      expect(defaultMissingManifestBundleDirectoryResult.status).toBe(0);
      const strictMissingManifestBundleDirectoryResult = runAgentAcceptanceVerifier(script, [
        '--require-runtime-evidence',
        fixture.bundleDir
      ]);
      expect(strictMissingManifestBundleDirectoryResult.status).not.toBe(0);
      expect(strictMissingManifestBundleDirectoryResult.stderr).toContain('manifest.bundleDirectory 缺失或为空');

      const manifestWithInvalidCreatedAt = JSON.parse(readFileSync(invalidManifestCreatedAtFixture.paths.manifest, 'utf8'));
      manifestWithInvalidCreatedAt.createdAt = '20260606T120000Z';
      writeFileSync(invalidManifestCreatedAtFixture.paths.manifest, `${JSON.stringify(manifestWithInvalidCreatedAt)}\n`);
      const defaultInvalidManifestCreatedAtResult = runAgentAcceptanceVerifier(script, [
        invalidManifestCreatedAtFixture.bundleDir
      ]);
      expect(defaultInvalidManifestCreatedAtResult.status).toBe(0);
      const strictInvalidManifestCreatedAtResult = runAgentAcceptanceVerifier(script, [
        '--require-runtime-evidence',
        invalidManifestCreatedAtFixture.bundleDir
      ]);
      expect(strictInvalidManifestCreatedAtResult.status).not.toBe(0);
      expect(strictInvalidManifestCreatedAtResult.stderr).toContain('manifest.createdAt 无效');

      const manifestWithInvalidEvidencePath = JSON.parse(
        readFileSync(invalidManifestEvidencePathFixture.paths.manifest, 'utf8')
      );
      manifestWithInvalidEvidencePath.evidence.doctorLog.path = join(
        tmpdir(),
        'ou-ui-agent-detached-manifest-evidence',
        'doctor.txt'
      );
      writeFileSync(
        invalidManifestEvidencePathFixture.paths.manifest,
        `${JSON.stringify(manifestWithInvalidEvidencePath)}\n`
      );
      const defaultInvalidManifestEvidencePathResult = runAgentAcceptanceVerifier(script, [
        invalidManifestEvidencePathFixture.bundleDir
      ]);
      expect(defaultInvalidManifestEvidencePathResult.status).toBe(0);
      const strictInvalidManifestEvidencePathResult = runAgentAcceptanceVerifier(script, [
        '--require-runtime-evidence',
        invalidManifestEvidencePathFixture.bundleDir
      ]);
      expect(strictInvalidManifestEvidencePathResult.status).not.toBe(0);
      expect(strictInvalidManifestEvidencePathResult.stderr).toContain(
        'evidence.doctorLog.path 与当前证据包或 manifest.bundleDirectory 不匹配'
      );

      manifestWithoutBundleDirectory.bundleDirectory = fixture.bundleDir;
      writeFileSync(fixture.paths.manifest, `${JSON.stringify(manifestWithoutBundleDirectory)}\n`);

      const finalSummaryResult = runAgentAcceptanceVerifier(script, [
        '--require-runtime-evidence',
        '--require-final-summary',
        fixture.bundleDir
      ]);
      expect(finalSummaryResult.status).toBe(0);
      expect(finalSummaryResult.stdout).toContain('[OK] Agent runtime evidence gate: passed');
      expect(finalSummaryResult.stdout).toContain('[OK] Agent final acceptance summary gate: passed');

      const finalSummaryWithoutBundleDirectory = JSON.parse(readFileSync(fixture.paths.finalSummary, 'utf8'));
      finalSummaryWithoutBundleDirectory.bundleDirectory = '';
      writeFileSync(fixture.paths.finalSummary, `${JSON.stringify(finalSummaryWithoutBundleDirectory)}\n`);
      const missingFinalSummaryBundleDirectoryResult = runAgentAcceptanceVerifier(script, [
        '--require-final-summary',
        fixture.bundleDir
      ]);
      expect(missingFinalSummaryBundleDirectoryResult.status).not.toBe(0);
      expect(missingFinalSummaryBundleDirectoryResult.stderr).toContain('bundleDirectory 缺失或为空');

      finalSummaryWithoutBundleDirectory.bundleDirectory = `${fixture.bundleDir}-stale`;
      writeFileSync(fixture.paths.finalSummary, `${JSON.stringify(finalSummaryWithoutBundleDirectory)}\n`);
      const mismatchedFinalSummaryBundleDirectoryResult = runAgentAcceptanceVerifier(script, [
        '--require-final-summary',
        fixture.bundleDir
      ]);
      expect(mismatchedFinalSummaryBundleDirectoryResult.status).not.toBe(0);
      expect(mismatchedFinalSummaryBundleDirectoryResult.stderr).toContain(
        'bundleDirectory 与 manifest.bundleDirectory 不匹配'
      );

      finalSummaryWithoutBundleDirectory.createdAt = '2026-02-31T00:00:00Z';
      finalSummaryWithoutBundleDirectory.bundleDirectory = fixture.bundleDir;
      writeFileSync(fixture.paths.finalSummary, `${JSON.stringify(finalSummaryWithoutBundleDirectory)}\n`);
      const invalidFinalSummaryCreatedAtResult = runAgentAcceptanceVerifier(script, [
        '--require-final-summary',
        fixture.bundleDir
      ]);
      expect(invalidFinalSummaryCreatedAtResult.status).not.toBe(0);
      expect(invalidFinalSummaryCreatedAtResult.stderr).toContain('final-acceptance-summary.json createdAt 无效');

      finalSummaryWithoutBundleDirectory.createdAt = '2026-06-06T12:00:00Z';
      finalSummaryWithoutBundleDirectory.bundleDirectory = fixture.bundleDir;
      writeFileSync(fixture.paths.finalSummary, `${JSON.stringify(finalSummaryWithoutBundleDirectory)}\n`);

      finalSummaryWithoutBundleDirectory.manifest.path = join(
        tmpdir(),
        'ou-ui-agent-detached-final-summary',
        'manifest.json'
      );
      writeFileSync(fixture.paths.finalSummary, `${JSON.stringify(finalSummaryWithoutBundleDirectory)}\n`);
      const invalidFinalSummaryManifestPathResult = runAgentAcceptanceVerifier(script, [
        '--require-final-summary',
        fixture.bundleDir
      ]);
      expect(invalidFinalSummaryManifestPathResult.status).not.toBe(0);
      expect(invalidFinalSummaryManifestPathResult.stderr).toContain(
        'Agent final summary manifest.path 与当前证据包或 manifest.bundleDirectory 不匹配'
      );

      finalSummaryWithoutBundleDirectory.manifest.path = fixture.paths.manifest;
      writeFileSync(fixture.paths.finalSummary, `${JSON.stringify(finalSummaryWithoutBundleDirectory)}\n`);

      const finalVerifyShortcutResult = runAgentAcceptanceVerifier(
        script,
        [fixture.bundleDir],
        'verify_agent_final_acceptance_bundle'
      );
      expect(finalVerifyShortcutResult.status).toBe(0);
      expect(finalVerifyShortcutResult.stdout).toContain('[OK] Agent runtime evidence gate: passed');
      expect(finalVerifyShortcutResult.stdout).toContain('[OK] Agent final acceptance summary gate: passed');

      writeFileSync(fixture.paths.finalVerifyLog, 'tampered final verifier transcript\n');
      const tamperedFinalSummaryResult = runAgentAcceptanceVerifier(script, [
        '--require-final-summary',
        fixture.bundleDir
      ]);
      expect(tamperedFinalSummaryResult.status).not.toBe(0);
      expect(tamperedFinalSummaryResult.stderr).toContain('Agent final summary verifier transcript 大小不匹配');

      const missingRuntimeResult = runAgentAcceptanceVerifier(script, [
        '--require-runtime-evidence',
        missingRuntimeFixture.bundleDir
      ]);
      expect(missingRuntimeResult.status).not.toBe(0);
      expect(missingRuntimeResult.stderr).toContain('缺少 xray runtime 模块证据');

      const missingFinalSummaryResult = runAgentAcceptanceVerifier(script, [
        '--require-final-summary',
        missingFinalSummaryFixture.bundleDir
      ]);
      expect(missingFinalSummaryResult.status).not.toBe(0);
      expect(missingFinalSummaryResult.stderr).toContain('无法读取或解析 final-acceptance-summary.json');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(invalidManifestCreatedAtFixture.root, { recursive: true, force: true });
      rmSync(invalidManifestEvidencePathFixture.root, { recursive: true, force: true });
      rmSync(missingRuntimeFixture.root, { recursive: true, force: true });
      rmSync(missingFinalSummaryFixture.root, { recursive: true, force: true });
    }
  });

  it('runs final Agent field acceptance with archived strict verifier summary', () => {
    const result = runAgentFinalAcceptance(script);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Agent 验收证据包:');
    expect(result.stdout).toContain('[OK] Agent runtime evidence gate: passed');
    expect(result.stdout).toContain(`Agent 最终现场验收校验记录: ${result.paths.finalVerifyLog}`);
    expect(result.stdout).toContain(`Agent 最终现场验收摘要: ${result.paths.finalSummary}`);
    expect(result.finalVerifyLog).toContain('[OK] Agent runtime evidence gate: passed');
    expect(result.finalSummary).toMatchObject({
      schemaVersion: 'ou-ui-agent.final-acceptance-summary.v1',
      status: 'passed',
      bundleDirectory: result.bundleDir,
      strictGates: {
        runtimeEvidence: true
      },
      manifest: {
        path: result.paths.manifest,
        sizeBytes: Buffer.byteLength(result.manifestText),
        sha256: sha256Text(result.manifestText)
      },
      finalVerifyLog: {
        path: result.paths.finalVerifyLog,
        sizeBytes: Buffer.byteLength(result.finalVerifyLog),
        sha256: sha256Text(result.finalVerifyLog)
      }
    });
    expect(result.finalVerifyLog).not.toContain('secret-token');
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
