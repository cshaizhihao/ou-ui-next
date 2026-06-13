import { describe, expect, it } from 'vitest';
import { getNavigationGroups, type NavigationEntry, type PageId } from './navigation';

function flattenEntryPageIds(entries: NavigationEntry[]): PageId[] {
  return entries.flatMap((entry) => (entry.type === 'item' ? [entry.item.id] : flattenEntryPageIds(entry.children)));
}

describe('navigation groups', () => {
  it('keeps the core path focused on control-plane operations', () => {
    const groups = getNavigationGroups('zh');
    const core = groups.find((group) => group.id === 'core');
    const advanced = groups.find((group) => group.id === 'advanced');

    expect(core).toBeDefined();
    expect(advanced).toBeDefined();

    const coreIds = flattenEntryPageIds(core?.children ?? []);
    const advancedIds = flattenEntryPageIds(advanced?.children ?? []);

    expect(coreIds).toEqual(expect.arrayContaining(['dashboard', 'nodes', 'customerNodes', 'forwarding', 'subscriptions']));
    expect(coreIds).not.toContain('permissions');
    expect(coreIds).not.toContain('tasks');
    expect(coreIds).not.toContain('audit');
    expect(advancedIds).toEqual(expect.arrayContaining(['permissions', 'tasks', 'audit', 'customers', 'routing', 'tuning', 'telegram', 'adminAccounts']));
  });

  it('uses the same control-plane grouping in English navigation', () => {
    const groups = getNavigationGroups('en');
    const core = groups.find((group) => group.id === 'core');
    const advanced = groups.find((group) => group.id === 'advanced');

    const coreIds = flattenEntryPageIds(core?.children ?? []);
    const advancedIds = flattenEntryPageIds(advanced?.children ?? []);

    expect(coreIds).toEqual(expect.arrayContaining(['dashboard', 'nodes', 'customerNodes', 'forwarding', 'subscriptions']));
    expect(coreIds).not.toContain('permissions');
    expect(coreIds).not.toContain('tasks');
    expect(coreIds).not.toContain('audit');
    expect(advancedIds).toEqual(expect.arrayContaining(['permissions', 'tasks', 'audit', 'customers', 'routing', 'tuning', 'telegram', 'adminAccounts']));
  });
});
