import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { OAudiofile, SampleUnit } from '@tratt/media';
import { ExportFilesModalComponent } from './export-files-modal.component';

// The workbench exports a file whose audio isn't attached by passing the
// media it resolved (registration info / transcript timing). Without it the
// dialog read AudioService.current and threw.
describe('ExportFilesModalComponent with passed media and no audio', () => {
  const realCreateObjectURL = window.URL.createObjectURL;
  const realRevokeObjectURL = window.URL.revokeObjectURL;

  beforeEach(() => {
    window.URL.createObjectURL = jest.fn(() => 'blob:x') as any;
    window.URL.revokeObjectURL = jest.fn() as any;
  });
  afterEach(() => {
    window.URL.createObjectURL = realCreateObjectURL;
    window.URL.revokeObjectURL = realRevokeObjectURL;
  });

  function create() {
    const serialize = jest.fn(() => ({ serialized: true }));
    const component = new ExportFilesModalComponent(
      { bypassSecurityTrustUrl: (u: string) => u } as any,
      { current: undefined } as any,
      {
        transcript: { levels: [{}], serialize },
        breakMarker: undefined,
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    component.uiService = { addElementFromEvent: jest.fn() } as any;
    const oAudioFile = new OAudiofile();
    oAudioFile.name = 'restored.wav';
    oAudioFile.sampleRate = 16000;
    oAudioFile.duration = 48000;
    component.media = {
      oAudioFile,
      sampleRate: 16000,
      duration: new SampleUnit(48000, 16000),
    };
    return { component, serialize, oAudioFile };
  }

  it('opens, names the file and logs without a current audio manager', () => {
    const { component } = create();

    expect(() => component.ngOnInit()).not.toThrow();
    expect(component.audioFileName).toBe('restored.wav');
  });

  it('serializes and exports against the passed media', async () => {
    const { component, serialize, oAudioFile } = create();
    const exportFn = jest.fn(() => ({
      file: { name: 'restored.txt', content: 'x', type: 'text/plain' },
    }));
    const converter = {
      name: 'PlainText',
      multitiers: false,
      multiTierExport: false,
      export: exportFn,
    } as any;

    component.updateParentFormat(converter, 0);
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(serialize).toHaveBeenCalledWith(
      'restored.wav',
      16000,
      component.media!.duration,
    );
    expect(exportFn).toHaveBeenCalledWith(
      { serialized: true },
      oAudioFile,
      0,
      undefined,
    );
    expect(component.parentformat.download).toBe('restored.txt');
  });

  it('names the protocol file after the recording', () => {
    const { component } = create();
    (component.annotationStoreService as any).extractUI = () => ({});
    component.uiService = { elements: [] } as any;

    component.getProtocol();

    expect(component.parentformat.download).toBe('restored.json');
  });
});
