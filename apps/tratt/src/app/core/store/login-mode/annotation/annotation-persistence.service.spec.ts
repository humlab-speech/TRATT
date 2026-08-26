import { describe, expect, it, jest } from '@jest/globals';
import { TaskDto, TaskStatus } from '@octra/api-types';
import { AnnotationPersistenceService } from './annotation-persistence.service';

describe('AnnotationPersistenceService', () => {
  function createService(saveTask = jest.fn()) {
    const apiService = { saveTask } as never;
    const audio = {
      audioManager: {
        resource: {
          info: {
            fullname: 'audio.wav',
            sampleRate: 16000,
            duration: { clone: () => 'duration-clone' },
          },
        },
      },
    } as never;
    const service = new AnnotationPersistenceService(apiService, audio);
    return { service, saveTask };
  }

  function createState(overrides: Record<string, unknown> = {}) {
    return {
      onlineMode: {
        transcript: {
          // serialize() returning a falsy annotation makes
          // AnnotJSONConverter#export() take its "no annotation" branch,
          // so saveTaskToServer produces no output file.
          clone: () => ({
            serialize: jest.fn().mockReturnValue(undefined),
          }),
        },
        audio: { fileName: 'audio.wav' },
        currentSession: {
          currentProject: { id: 'project-1' },
          task: { id: 'task-1' },
          assessment: 'ok',
          comment: 'a comment',
        },
        logging: { logs: undefined },
        ...overrides,
      },
    } as never;
  }

  it('returns undefined without calling the API when there is no audio resource', (done) => {
    const { service, saveTask } = createService();
    (service as unknown as { audio: { audioManager: undefined } }).audio = {
      audioManager: undefined,
    } as never;

    service
      .saveTaskToServer(createState(), TaskStatus.paused)
      .subscribe((result: TaskDto | undefined) => {
        expect(result).toBeUndefined();
        expect(saveTask).not.toHaveBeenCalled();
        done();
      });
  });

  it('calls apiService.saveTask with project id, task id, properties, and status', () => {
    const returned = { id: 'task-1' };
    const saveTask = jest.fn().mockReturnValue({ subscribe: jest.fn() });
    const { service } = createService(saveTask);
    const state = createState();

    service.saveTaskToServer(state, TaskStatus.finished);

    expect(saveTask).toHaveBeenCalledTimes(1);
    const [projectId, taskId, properties, log, outputs] = saveTask.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
      File | undefined,
      File[],
    ];
    expect(projectId).toBe('project-1');
    expect(taskId).toBe('task-1');
    expect(properties).toEqual({
      assessment: 'ok',
      comment: 'a comment',
      status: TaskStatus.finished,
    });
    expect(log).toBeUndefined();
    expect(outputs).toEqual([]);
    void returned;
  });

  it('passes a log File when logging.logs is set', () => {
    const saveTask = jest.fn().mockReturnValue({ subscribe: jest.fn() });
    const { service } = createService(saveTask);
    const state = createState({ logging: { logs: [{ type: 'x' }] } });

    service.saveTaskToServer(state, TaskStatus.paused);

    const [, , , log] = saveTask.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
      File | undefined,
    ];
    expect(log).toBeInstanceOf(File);
    expect(log?.name).toBe('log.json');
  });
});
