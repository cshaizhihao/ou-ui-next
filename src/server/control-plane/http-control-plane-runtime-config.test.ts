import { resolveHttpControlPlaneRuntimeConfig } from './http-control-plane-runtime-config';

describe('resolveHttpControlPlaneRuntimeConfig', () => {
  it('defaults to localhost memory storage', () => {
    expect(resolveHttpControlPlaneRuntimeConfig({})).toEqual({
      host: '127.0.0.1',
      port: 4010,
      initialState: 'empty',
      storage: {
        type: 'memory'
      }
    });
  });

  it('maps file storage environment variables', () => {
    expect(
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_HOST: '0.0.0.0',
        OU_UI_CONTROL_PLANE_PORT: '4011',
        OU_UI_CONTROL_PLANE_STORAGE: 'file',
        OU_UI_CONTROL_PLANE_STATE_FILE: 'D:\\ou-ui\\control-plane-state.json',
        OU_UI_CONTROL_PLANE_INITIAL_STATE: 'empty'
      })
    ).toEqual({
      host: '0.0.0.0',
      port: 4011,
      initialState: 'empty',
      storage: {
        type: 'file',
        stateFilePath: 'D:\\ou-ui\\control-plane-state.json'
      }
    });
  });

  it('maps operator and Agent bearer token environment variables', () => {
    expect(
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_OPERATOR_TOKEN: 'operator-secret',
        OU_UI_CONTROL_PLANE_OPERATOR_ACTOR: 'operator:alice',
        OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID: 'owner',
        OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID: 'group-premium',
        OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON: JSON.stringify({
          'agent-hkg-01': 'agent-hkg-secret'
        })
      })
    ).toEqual({
      host: '127.0.0.1',
      port: 4010,
      initialState: 'empty',
      storage: {
        type: 'memory'
      },
      auth: {
        operatorTokens: {
          'operator-secret': {
            actor: 'operator:alice',
            operatorGroupId: 'owner',
            resourceGroupId: 'group-premium'
          }
        },
        agentTokens: {
          'agent-hkg-secret': {
            agentId: 'agent-hkg-01'
          }
        }
      }
    });
  });

  it('rejects unknown storage modes', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_STORAGE: 'sqlite'
      })
    ).toThrow('OU_UI_CONTROL_PLANE_STORAGE must be either "memory" or "file".');
  });

  it('requires a state file path for file storage', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_STORAGE: 'file'
      })
    ).toThrow('OU_UI_CONTROL_PLANE_STATE_FILE is required when OU_UI_CONTROL_PLANE_STORAGE=file.');
  });

  it('rejects invalid ports', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_PORT: '70000'
      })
    ).toThrow('OU_UI_CONTROL_PLANE_PORT must be an integer between 1 and 65535.');
  });

  it('rejects malformed Agent token JSON', () => {
    expect(() =>
      resolveHttpControlPlaneRuntimeConfig({
        OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON: '{bad-json'
      })
    ).toThrow('OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON must be a JSON object mapping agentId to token.');
  });
});
