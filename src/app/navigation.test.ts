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
    const operations = groups.find((group) => group.id === 'operations');
    const delivery = groups.find((group) => group.id === 'delivery');
    const evidence = groups.find((group) => group.id === 'evidence');

    expect(operations).toBeDefined();
    expect(delivery).toBeDefined();
    expect(evidence).toBeDefined();

    const operationsIds = flattenEntryPageIds(operations?.children ?? []);
    const deliveryIds = flattenEntryPageIds(delivery?.children ?? []);
    const evidenceIds = flattenEntryPageIds(evidence?.children ?? []);

    expect(operationsIds).toEqual(expect.arrayContaining(['dashboard', 'nodes', 'customerNodes', 'forwarding', 'subscriptions']));
    expect(operationsIds).not.toContain('permissions');
    expect(operationsIds).not.toContain('tasks');
    expect(operationsIds).not.toContain('audit');
    expect(deliveryIds).toEqual(expect.arrayContaining(['customers', 'routing', 'tuning', 'telegram']));
    expect(deliveryIds).not.toContain('adminAccounts');
    expect(evidenceIds).toEqual(expect.arrayContaining(['tasks', 'audit', 'adminAccounts']));
    expect(evidenceIds).not.toContain('permissions');
  });

  it('uses the same control-plane grouping in English navigation', () => {
    const groups = getNavigationGroups('en');
    const operations = groups.find((group) => group.id === 'operations');
    const delivery = groups.find((group) => group.id === 'delivery');
    const evidence = groups.find((group) => group.id === 'evidence');

    const operationsIds = flattenEntryPageIds(operations?.children ?? []);
    const deliveryIds = flattenEntryPageIds(delivery?.children ?? []);
    const evidenceIds = flattenEntryPageIds(evidence?.children ?? []);

    expect(operationsIds).toEqual(expect.arrayContaining(['dashboard', 'nodes', 'customerNodes', 'forwarding', 'subscriptions']));
    expect(operationsIds).not.toContain('permissions');
    expect(operationsIds).not.toContain('tasks');
    expect(operationsIds).not.toContain('audit');
    expect(deliveryIds).toEqual(expect.arrayContaining(['customers', 'routing', 'tuning', 'telegram']));
    expect(deliveryIds).not.toContain('adminAccounts');
    expect(evidenceIds).toEqual(expect.arrayContaining(['tasks', 'audit', 'adminAccounts']));
    expect(evidenceIds).not.toContain('permissions');
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
