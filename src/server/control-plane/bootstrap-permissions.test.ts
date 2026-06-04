import { createBootstrapPermissionGrants } from './bootstrap-permissions';

describe('bootstrap permission grants', () => {
  it('grants the first operator both tunnel-group and Agent enrollment permissions', () => {
    const grants = createBootstrapPermissionGrants({
      actor: 'operator_abc123',
      operatorGroupId: 'owner',
      resourceGroupId: 'group-premium'
    });

    expect(grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectType: 'user',
          subjectId: 'operator_abc123',
          resourceType: 'tunnel-group',
          resourceId: 'group-premium',
          permissions: expect.arrayContaining(['read', 'operate', 'configure', 'grant'])
        }),
        expect.objectContaining({
          subjectType: 'user',
          subjectId: 'operator_abc123',
          resourceType: 'agent',
          resourceId: 'group-premium',
          permissions: expect.arrayContaining(['read', 'operate', 'configure', 'grant'])
        }),
        expect.objectContaining({
          subjectType: 'group',
          subjectId: 'owner',
          resourceType: 'agent',
          resourceId: 'group-premium',
          permissions: expect.arrayContaining(['configure'])
        })
      ])
    );
  });
});
