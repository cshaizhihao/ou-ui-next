import { describe, expect, it } from 'vitest';
import { getNavigationGroups, type NavigationEntry, type PageId } from './navigation';

function flattenEntryPageIds(entries: NavigationEntry[]): PageId[] {
  return entries.flatMap((entry) => (entry.type === 'item' ? [entry.item.id] : flattenEntryPageIds(entry.children)));
}

describe('navigation groups', () => {
  it('keeps low-frequency admin workspaces out of the core path', () => {
    const groups = getNavigationGroups('zh');
    const core = groups.find((group) => group.id === 'core');
    const advanced = groups.find((group) => group.id === 'advanced');

    expect(core).toBeDefined();
    expect(advanced).toBeDefined();

    const coreIds = flattenEntryPageIds(core?.children ?? []);
    const advancedIds = flattenEntryPageIds(advanced?.children ?? []);

    expect(coreIds).not.toContain('permissions');
    expect(coreIds).not.toContain('tasks');
    expect(coreIds).not.toContain('audit');
    expect(advancedIds).toEqual(expect.arrayContaining(['permissions', 'tasks', 'audit']));
  });

  it('uses the same low-frequency isolation in English navigation', () => {
    const groups = getNavigationGroups('en');
    const core = groups.find((group) => group.id === 'core');
    const advanced = groups.find((group) => group.id === 'advanced');

    const coreIds = flattenEntryPageIds(core?.children ?? []);
    const advancedIds = flattenEntryPageIds(advanced?.children ?? []);

    expect(coreIds).not.toContain('permissions');
    expect(coreIds).not.toContain('tasks');
    expect(coreIds).not.toContain('audit');
    expect(advancedIds).toEqual(expect.arrayContaining(['permissions', 'tasks', 'audit']));
  });
});
