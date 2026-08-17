import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { RecordingDevicesService } from './recording-devices.service';

type MdShim = {
  enumerateDevices: jest.Mock<() => Promise<MediaDeviceInfo[]>>;
  addEventListener: jest.Mock;
  getUserMedia: jest.Mock<() => Promise<MediaStream>>;
};

function mockMediaDevices(devices: Partial<MediaDeviceInfo>[]): MdShim {
  const shim: MdShim = {
    enumerateDevices: jest.fn(async () => devices as MediaDeviceInfo[]),
    addEventListener: jest.fn(),
    getUserMedia: jest.fn(
      async () =>
        ({
          getTracks: () => [{ stop: () => undefined }],
        }) as unknown as MediaStream,
    ),
  };
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: shim as unknown as MediaDevices,
  });
  return shim;
}

describe('RecordingDevicesService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('hydrates selections from localStorage', () => {
    localStorage.setItem('octra.recording.deviceId.audio', 'mic-1');
    localStorage.setItem('octra.recording.deviceId.video', 'cam-2');
    mockMediaDevices([]);
    const svc = new RecordingDevicesService();
    expect(svc.selectedAudioId$.value).toBe('mic-1');
    expect(svc.selectedVideoId$.value).toBe('cam-2');
  });

  it('refresh() populates devices$ split by kind and flips hasPermission$ when labels present', async () => {
    mockMediaDevices([
      { kind: 'audioinput', deviceId: 'a1', label: 'Mic 1' },
      { kind: 'audioinput', deviceId: 'a2', label: 'Mic 2' },
      { kind: 'videoinput', deviceId: 'v1', label: 'Cam 1' },
      { kind: 'audiooutput', deviceId: 'o1', label: 'Speaker' },
    ]);
    const svc = new RecordingDevicesService();
    await svc.refresh();
    expect(svc.devices$.value.audio).toHaveLength(2);
    expect(svc.devices$.value.video).toHaveLength(1);
    expect(svc.hasPermission$.value).toBe(true);
  });

  it('selectAudio writes through to localStorage', () => {
    mockMediaDevices([]);
    const svc = new RecordingDevicesService();
    svc.selectAudio('mic-x');
    expect(localStorage.getItem('octra.recording.deviceId.audio')).toBe(
      'mic-x',
    );
    svc.selectAudio(null);
    expect(localStorage.getItem('octra.recording.deviceId.audio')).toBeNull();
  });

  it('clears selection when previously chosen device disappears', async () => {
    localStorage.setItem('octra.recording.deviceId.audio', 'gone');
    mockMediaDevices([
      { kind: 'audioinput', deviceId: 'still-here', label: 'Mic' },
    ]);
    const svc = new RecordingDevicesService();
    await svc.refresh();
    expect(svc.selectedAudioId$.value).toBeNull();
    expect(svc.selectionCleared$.value).toBe('audio');
  });

  it('keeps hasPermission$ false when only blank labels are returned', async () => {
    mockMediaDevices([
      { kind: 'audioinput', deviceId: 'a1', label: '' },
      { kind: 'videoinput', deviceId: 'v1', label: '' },
    ]);
    const svc = new RecordingDevicesService();
    await svc.refresh();
    expect(svc.hasPermission$.value).toBe(false);
    expect(svc.devices$.value.audio).toHaveLength(1);
  });
});
