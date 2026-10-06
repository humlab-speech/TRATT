import { describe, expect, it } from '@jest/globals';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { BundleReattachMismatchModalComponent } from './bundle-reattach-mismatch-modal.component';

function modal(
  overrides: Partial<BundleReattachMismatchModalComponent>,
): BundleReattachMismatchModalComponent {
  const component = new BundleReattachMismatchModalComponent(
    {} as NgbActiveModal,
  );
  Object.assign(component, {
    expectedName: 'a.wav',
    expectedSize: 10,
    actualName: 'a.wav',
    actualSize: 10,
    ...overrides,
  });
  return component;
}

// Copied or re-synced files keep name and size but get a new mtime; the
// dialog used to show two identical lines and no hint why they "differ".
describe('BundleReattachMismatchModalComponent.onlyModifiedDiffers', () => {
  it('is true when only the modification time differs', () => {
    expect(
      modal({
        expectedModified: new Date(1000),
        actualModified: new Date(2000),
      }).onlyModifiedDiffers,
    ).toBe(true);
  });

  it('is false when the name or size differs too, or a time is unknown', () => {
    const times = {
      expectedModified: new Date(1000),
      actualModified: new Date(2000),
    };
    expect(modal({ ...times, actualSize: 11 }).onlyModifiedDiffers).toBe(false);
    expect(modal({ ...times, actualName: 'b.wav' }).onlyModifiedDiffers).toBe(
      false,
    );
    expect(modal({ actualModified: new Date(2000) }).onlyModifiedDiffers).toBe(
      false,
    );
  });
});
