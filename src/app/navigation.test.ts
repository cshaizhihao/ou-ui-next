import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    expect(advancedIds).toEqual(expect.arrayContaining(['tasks', 'audit', 'customers', 'routing', 'tuning', 'telegram', 'adminAccounts']));
    expect(advancedIds).not.toContain('permissions');
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
    expect(advancedIds).toEqual(expect.arrayContaining(['tasks', 'audit', 'customers', 'routing', 'tuning', 'telegram', 'adminAccounts']));
    expect(advancedIds).not.toContain('permissions');
  });

  it('does not keep the removed access and quota workspace as a hidden frontend module', () => {
    const projectRoot = process.cwd();
    const removedWorkspacePath = resolve(projectRoot, 'src/features/permissions');
    const glassCss = readFileSync(resolve(projectRoot, 'src/styles/glass.css'), 'utf8');
    const browserSmoke = readFileSync(resolve(projectRoot, 'scripts/production-browser-smoke.cjs'), 'utf8');

    expect(existsSync(removedWorkspacePath)).toBe(false);
    expect(glassCss).not.toContain('permissions-safety');
    expect(browserSmoke).not.toContain('权限与配额');
    expect(browserSmoke).not.toContain('Group Authorization');
  });
});
