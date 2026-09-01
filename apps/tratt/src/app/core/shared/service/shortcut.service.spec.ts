import { describe, expect, it } from '@jest/globals';
import { ShortcutService } from './shortcut.service';

describe('ShortcutService.unregisterShortcutGroup scopes removal (C14)', () => {
  it('removes only the named group, leaving unrelated groups registered', () => {
    const service = new ShortcutService();
    service.registerShortcutGroup({ name: 'editor group', items: [] } as any);
    service.registerShortcutGroup({ name: 'overview modal', items: [] } as any);

    service.unregisterShortcutGroup('editor group');

    const names = service.groups.map((g: any) => g.name);
    expect(names).not.toContain('editor group');
    expect(names).toContain('overview modal');
  });

  it('destroy() (the old behavior) wipes everything, demonstrating why editors must not call it', () => {
    const service = new ShortcutService();
    service.registerShortcutGroup({ name: 'editor group', items: [] } as any);
    service.registerShortcutGroup({ name: 'overview modal', items: [] } as any);

    service.destroy();

    expect(service.groups.length).toBe(0);
  });
});
