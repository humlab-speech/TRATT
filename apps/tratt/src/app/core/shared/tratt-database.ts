import { ProjectDto } from '@octra/api-types';
import { IAnnotJSON, ILevel, ILink, OAnnotJSON } from '@tratt/annotation';
import { removeEmptyProperties } from '@tratt/utilities';
import Dexie, { Transaction } from 'dexie';
import 'dexie-export-import';
import {
  firstValueFrom,
  from,
  map,
  mergeMap,
  Observable,
  of,
  Subject,
} from 'rxjs';
import { LoginMode } from '../store';
import { DEFAULT_BUNDLE_ID } from '../store/login-mode/annotation/local-bundle-collection';
import type { BundleRunState } from '../store/pipeline-queue';

/**
 * Database names used before the rename from OCTRA to TRATT. Deployments that
 * switch their appconfig to a TRATT-named database keep reading these, see
 * resolveDatabaseName().
 */
export const LEGACY_DB_NAMES = ['tratt-2', 'octra'];

export class TrattDatabase extends Dexie {
  public demoData!: Dexie.Table<IIDBEntry, string>;
  public onlineData!: Dexie.Table<IIDBEntry, string>;
  public urlData!: Dexie.Table<IIDBEntry, string>;
  public localData!: Dexie.Table<IIDBEntry, string>;
  public app_options!: Dexie.Table<IIDBEntry, string>;
  public bundles!: Dexie.Table<IBundleEntry, [string, string]>;
  public onReady: Subject<void>;

  //...other tables goes here...

  constructor(dbName: string) {
    super(dbName);
    this.onReady = new Subject<void>();
  }

  public async init() {
    let currentVersion = 0;

    try {
      const db = await this.open();
      currentVersion = db.verno;
      db.close();
    } catch (error: any) {
      // ignore
    }

    if (currentVersion > 0 && currentVersion < 0.6) {
      try {
        await this.backupCurrentDatabase();
      } catch (e) {
        this.onReady.error(
          new Error(
            `Failed to back up existing database before upgrading it. This can happen if storage quota is exceeded (a backup roughly doubles storage use). Your existing data has not been modified. Original error: ${e}`,
          ),
        );
        throw e;
      }
    }

    this.version(0.2)
      .stores({
        annotation_levels: 'id',
        annotation_links: 'id',
        logs: 'timestamp',
        options: 'name, value',
      })
      .upgrade(this.upgradeToDatabaseV2);

    this.version(0.3)
      .stores({
        annotation_levels: 'id',
        annotation_links: 'id',
        logs: 'timestamp',
        options: 'name, value',
      })
      .upgrade(this.upgradeToDatabaseV3);

    // INTRODUCTION OF OCTRA 2
    this.version(0.4)
      .stores({
        annotation_levels: 'id',
        annotation_links: 'id',
        logs: 'timestamp',
        options: 'name, value',
        demo_data: '&name, value',
        online_data: '&name, value',
        local_data: '&name, value',
        url_data: '&name, value',
        app_options: '&name, value',
      })
      .upgrade(this.upgradeToDatabaseV4);

    this.version(0.5)
      .stores({
        annotation_levels: null,
        annotation_links: null,
        logs: null,
        options: null,
        demo_data: '&name, value',
        online_data: '&name, value',
        local_data: '&name, value',
        url_data: '&name, value',
        app_options: '&name, value',
      })
      .upgrade(this.upgradeToDatabaseV5);

    this.version(0.6)
      .stores({
        demo_data: '&name, value',
        online_data: '&name, value',
        local_data: '&name, value',
        url_data: '&name, value',
        app_options: '&name, value',
        bundles: '[bundleId+name]',
      })
      .upgrade(this.upgradeToDatabaseV6);

    this.demoData = this.table('demo_data');
    this.onlineData = this.table('online_data');
    this.localData = this.table('local_data');
    this.urlData = this.table('url_data');

    this.app_options = this.table('app_options');
    this.bundles = this.table('bundles');

    try {
      await this.open();
    } catch (e) {
      this.onReady.error(
        new Error(
          `Failed to open IndexedDB database. This may happen in private browsing mode. Original error: ${e}`,
        ),
      );
      throw e; // propagate — nothing downstream can react to onReady.error alone
    }
    try {
      await this.checkAndFillPopulation();
      this.onReady.next();
      this.onReady.complete();
    } catch (e) {
      this.onReady.error(e);
      throw e;
    }
  }

  private upgradeToDatabaseV2(transaction: Transaction) {
    return transaction.table('options').bulkPut([
      {
        name: 'submitted',
        value: false,
      },
      {
        name: 'version',
        value: 3,
      },
      {
        name: 'easyMode',
        value: false,
      },
      {
        name: 'audioURL',
        value: undefined,
      },
      {
        name: 'comment',
        value: '',
      },
      {
        name: 'dataID',
        value: undefined,
      },
      {
        name: 'feedback',
        value: undefined,
      },
      {
        name: 'language',
        value: undefined,
      },
      {
        name: 'sessionfile',
        value: undefined,
      },
      {
        name: 'usemode',
        value: undefined,
      },
      {
        name: 'user',
        value: undefined,
      },
      {
        name: 'interface',
        value: undefined,
      },
      {
        name: 'logging',
        value: true,
      },
      {
        name: 'showMagnifier',
        value: false,
      },
      {
        name: 'prompttext',
        value: '',
      },
      {
        name: 'servercomment',
        value: '',
      },
      {
        name: 'secondsPerLine',
        value: 5,
      },
      {
        name: 'audioSettings',
        value: {
          volume: 1,
          speed: 1,
        },
      },
      {
        name: 'highlightingEnabled',
        value: false,
      },
      {
        name: 'console',
        value: [],
      },
    ]);
  }

  private async upgradeToDatabaseV3(transaction: Transaction) {
    return transaction
      .table('options')
      .toCollection()
      .modify((option: IIDBEntry) => {
        if (option.name === 'uselocalmode') {
          option.name = 'usemode';
          if (option.value === false) {
            option.value = 'online';
          } else if (option.value === true) {
            option.value = 'local';
          }
        }
      });
  }

  private async upgradeToDatabaseV4(tr: Transaction) {
    const optionKeys = [
      'accessCode',
      'audioSettings',
      'easymode',
      'interface',
      'logging',
      'maus',
      'secondsPerLine',
      'sessionfile',
      'showFeedbackNotice',
      'showLoupe',
      'usemode',
      'user',
      'userProfile',
      'version',
    ];
    const options = (await tr.table('options').bulkGet(optionKeys)).filter(
      (a) => a !== undefined,
    );

    for (let i = 0; i < options.length; i++) {
      const option = options[i];

      if (option.name === 'audioSettings') {
        await tr.table('app_options').put(option);
      } else if (option.name === 'easymode') {
        await tr.table('app_options').put({
          name: 'easyMode',
          value: option.value,
        });
      } else if (option.name === 'interface') {
        await tr.table('app_options').put(option);
      } else if (option.name === 'secondsPerLine') {
        await tr.table('app_options').put(option);
      } else if (option.name === 'showFeedbackNotice') {
        await tr.table('app_options').put(option);
      } else if (option.name === 'showLoupe') {
        await tr.table('app_options').put({
          name: 'showMagnifier',
          value: option.value,
        });
      } else if (option.name === 'usemode') {
        await tr.table('app_options').put(option);
      } else if (option.name === 'userProfile') {
        await tr.table('app_options').put(option);
      } else if (option.name === 'version') {
        await tr.table('app_options').put({
          name: 'version',
          value: '2.0.0',
        });
      }
    }

    // Legacy ASR-related options ('asr', 'accessCode', 'maus') were validated
    // against ASRStateSettings, a type that no longer exists now that cloud
    // ASR has been removed. Rather than reconstruct a typed value for them,
    // drop any of these rows that survived from a pre-upgrade browser.
    for (const legacyKey of ['asr', 'accessCode', 'maus'] as const) {
      if (options.some((a) => a.name === legacyKey)) {
        await tr.table('app_options').delete(legacyKey);
      }
    }

    // if usemode is local, copy all data to new tables for online mode
    // before v4 only one active mode with data was valid. So we only need to check for local mode
    const usemode = (await tr.table('options').get('usemode'))?.value;
    if (usemode === 'local') {
      const oldSessionFile:
        | {
            name: 'sessionfile';
            value: {
              name: string;
              type: string;
              size: number;
            };
          }
        | undefined = await tr.table('options').get('sessionfile');
      const oldLogging: { name: 'logging'; value: boolean } | undefined =
        await tr.table('options').get('logging');
      const newLocalModeOptions: IIDBModeOptions = {
        sessionfile: oldSessionFile?.value,
        logging: oldLogging?.value,
      };
      await tr.table('local_data').put({
        name: 'options',
        value: newLocalModeOptions,
      });

      const oldAnnotationLevels:
        | {
            id: number;
            level: ILevel;
          }[]
        | undefined = await tr.table('annotation_levels').toArray();
      const oldAnnotationLinks:
        | {
            id: number;
            link: ILink;
          }[]
        | undefined = await tr.table('annotation_links').toArray();

      if (
        oldSessionFile?.value?.name &&
        ((oldAnnotationLevels && oldAnnotationLevels.length > 0) ||
          (oldAnnotationLinks && oldAnnotationLinks.length > 0))
      ) {
        const audioFileName = oldSessionFile.value.name;
        const newAnnotation: OAnnotJSON | undefined =
          !oldSessionFile?.value?.name ||
          (!oldAnnotationLevels && !oldAnnotationLinks)
            ? undefined
            : new OAnnotJSON(
                audioFileName,
                audioFileName.replace(/\.wav$/g, ''),
                -1,
                oldAnnotationLevels?.map((a) => a.level),
                oldAnnotationLinks?.map((a) => a.link),
              );
        await tr.table('local_data').put({
          name: 'annotation',
          value: newAnnotation,
        });

        let oldLogs = await tr.table('logs').toArray();
        oldLogs.sort((a, b) => {
          if (a.timestamp > b.timestamp) {
            return 1;
          }
          return a.timestamp < b.timestamp ? -1 : 0;
        });

        if (oldLogs.length > 0) {
          const firstTimeStamp = oldLogs[0].timestamp;
          oldLogs = oldLogs.map((a) => ({
            ...a,
            timestamp: a.timestamp - firstTimeStamp,
          }));
        }

        await tr.table('local_data').put({
          name: 'logs',
          value: oldLogs,
        });
      }
    }
  }

  private async upgradeToDatabaseV5(transaction: Transaction) {}

  private async upgradeToDatabaseV6(tr: Transaction) {
    const localDataTable = tr.table('local_data');
    const bundlesTable = tr.table('bundles');
    const rows = await localDataTable.toArray();
    for (const row of rows) {
      await bundlesTable.put({
        bundleId: DEFAULT_BUNDLE_ID,
        name: row.name,
        value: row.value,
      });
    }
  }

  /**
   * Returns every distinct bundleId present in the `bundles` table. The
   * table's only index is the compound `[bundleId+name]` primary key — no
   * secondary index on bundleId alone — so this is a full-table-scan of
   * primary keys, not an indexed query. Fine at expected row counts (a
   * handful of rows per bundle).
   */
  public async listLocalBundleIds(): Promise<string[]> {
    const keys = await this.bundles.toCollection().primaryKeys();
    return Array.from(new Set(keys.map((k) => k[0])));
  }

  /**
   * Deletes every row belonging to the given bundle ids — the full
   * counterpart to listLocalBundleIds()/createBundle's persistence: a
   * bundle removed from the store must not resurrect on the next boot's
   * listLocalBundleIds() walk.
   */
  public async deleteLocalBundles(bundleIds: string[]): Promise<void> {
    await this.bundles
      .filter((entry) => bundleIds.includes(entry.bundleId))
      .delete();
  }

  private async backupCurrentDatabase() {
    await this.open();
    const backup = await this.export({ prettyJson: true });
    this.close();
    const dexie = await Dexie.import(backup, {
      name: `${this.name}_backup_${Date.now()}`,
    });
    await dexie.open();
    dexie.close();
  }

  private getTableFromString(mode: LoginMode): Dexie.Table<IIDBEntry, string> {
    let table: Dexie.Table<IIDBEntry, string> = undefined as any;

    switch (mode) {
      case LoginMode.DEMO:
        table = this.demoData;
        break;
      case LoginMode.LOCAL:
        table = this.localData;
        break;
      case LoginMode.ONLINE:
        table = this.onlineData;
        break;
      case LoginMode.URL:
        table = this.urlData;
        break;
    }

    return table;
  }

  private async checkAndFillPopulation(): Promise<void> {
    const subj = new Subject<void>();
    let optionsLength = (await this.app_options.toArray())?.length ?? 0;
    if (optionsLength === 0) {
      this.populateOptions();
    }

    optionsLength =
      (await this.demoData.get('options'))?.value === undefined ? 0 : 1;
    if (optionsLength === 0) {
      await firstValueFrom(this.populateModeOptions(LoginMode.DEMO));
    }
    optionsLength =
      (await this.onlineData.get('options'))?.value === undefined ? 0 : 1;
    if (optionsLength === 0) {
      await firstValueFrom(this.populateModeOptions(LoginMode.ONLINE));
    }
    // LOCAL mode's 'options' entry now lives in the bundles table (keyed by
    // [bundleId, name]), not local_data — saveModeData()/loadDataOfMode()
    // route LOCAL-mode reads/writes there. Checking local_data here would
    // never see writes made after this change and would keep re-populating
    // (overwriting) bundle-1's saved options on every init.
    optionsLength =
      (await this.bundles.get([DEFAULT_BUNDLE_ID, 'options']))?.value ===
      undefined
        ? 0
        : 1;
    if (optionsLength === 0) {
      await firstValueFrom(
        this.populateModeOptions(LoginMode.LOCAL, DEFAULT_BUNDLE_ID),
      );
    }
    optionsLength =
      (await this.urlData.get('options'))?.value === undefined ? 0 : 1;
    if (optionsLength === 0) {
      await firstValueFrom(this.populateModeOptions(LoginMode.URL));
    }
  }

  private countEntries(
    table: Dexie.Table<IIDBEntry, string>,
  ): Observable<number> {
    return from(
      new Promise<number>((resolve, reject) => {
        table
          .count()
          .then((count) => {
            resolve(count);
          })
          .catch(() => {
            reject();
          });
      }),
    );
  }

  private populateModeOptions(mode: LoginMode, bundleId?: string) {
    const modeOptions: IIDBModeOptions = {
      currentEditor: '2D-Editor',
      logging: true,
    };

    return this.saveModeData(mode, 'options', modeOptions, true, bundleId);
  }

  public saveModeData(
    mode: LoginMode,
    name: string,
    value: any,
    overwrite = false,
    bundleId?: string,
  ) {
    let prepared =
      typeof value === 'object' && value !== undefined && value !== null
        ? JSON.parse(JSON.stringify(value))
        : value;
    prepared = removeEmptyProperties(prepared, {
      removeNull: false,
      removeEmptyStrings: false,
      removeUndefined: true,
    });

    if (mode === LoginMode.LOCAL) {
      if (!bundleId) {
        console.error('saveModeData: bundleId is required for LOCAL mode');
        return of();
      }
      // write undefined or null
      if (overwrite) {
        return from(
          this.bundles.put(
            {
              bundleId,
              name,
              value: prepared,
            },
            [bundleId, name],
          ),
        ).pipe(
          map(() => {
            return;
          }),
        );
      } else {
        return from(
          this.bundles.update([bundleId, name], {
            value: prepared,
          }),
        ).pipe(
          mergeMap((updatedCount) => {
            if (updatedCount === 0) {
              // update() silently no-ops on a missing key instead of creating
              // one — the row for any bundle beyond DEFAULT_BUNDLE_ID/URL mode
              // (never pre-seeded by checkAndFillPopulation()) doesn't exist
              // yet on its first save. Fall back to put() so the first save
              // for a new bundle actually persists instead of vanishing.
              return from(
                this.bundles.put({ bundleId, name, value: prepared }, [
                  bundleId,
                  name,
                ]),
              );
            }
            return of(updatedCount);
          }),
          map(() => {
            return;
          }),
        );
      }
    }

    const table = this.getTableFromString(mode);

    if (!table) {
      console.error(`table ${table} not found!`);
    }

    if (table) {
      // write undefined or null
      if (overwrite) {
        return from(
          table.put(
            {
              name,
              value: prepared,
            },
            name,
          ),
        ).pipe(
          map(() => {
            return;
          }),
        );
      } else {
        return from(
          table.update(name, {
            value: prepared,
          }),
        ).pipe(
          map(() => {
            return;
          }),
        );
      }
    } else {
      return of();
    }
  }

  public clearDataOfMode(
    mode: LoginMode,
    name: string,
    bundleId: string = DEFAULT_BUNDLE_ID,
  ) {
    if (mode === LoginMode.LOCAL) {
      // LOCAL reads/writes live in `bundles` (see saveModeData/loadDataOfMode);
      // clearing the legacy `local_data` row left the real data in place.
      return from(
        this.bundles.put({ bundleId, name, value: null }, [bundleId, name]),
      ).pipe(map(() => undefined));
    }
    const table = this.getTableFromString(mode);
    if (table) {
      return from(
        table.put(
          {
            name: name,
            value: null,
          },
          name,
        ),
      ).pipe(
        map(() => {
          return;
        }),
      );
    } else {
      return of();
    }
  }

  public clear() {
    return this;
  }

  public loadDataOfMode<T>(
    mode: LoginMode,
    name: string,
    emptyValue: T,
    bundleId?: string,
  ) {
    if (mode === LoginMode.LOCAL) {
      if (!bundleId) {
        console.error('loadDataOfMode: bundleId is required for LOCAL mode');
        return of(emptyValue);
      }
      return from(this.bundles.get([bundleId, name])).pipe(
        map((result) => {
          if (result && result.value) {
            return result.value as T;
          } else {
            return emptyValue;
          }
        }),
      );
    }

    const table = this.getTableFromString(mode);
    if (table) {
      return from(table.get(name)).pipe(
        map((result) => {
          if (result && result.value) {
            return result.value as T;
          } else {
            return emptyValue;
          }
        }),
      );
    }
    return of(emptyValue);
  }

  private populateOptions() {
    return from(
      this.app_options.bulkPut([
        {
          name: 'version',
          value: 3,
        },
        {
          name: 'easyMode',
          value: false,
        },
        {
          name: 'language',
          value: undefined,
        },
        {
          name: 'usemode',
          value: undefined,
        },
        {
          name: 'userProfile',
          value: undefined,
        },
        {
          name: 'interface',
          value: undefined,
        },
        {
          name: 'showMagnifier',
          value: false,
        },
        {
          name: 'secondsPerLine',
          value: 5,
        },
        {
          name: 'audioSettings',
          value: {
            volume: 1,
            speed: 1,
          },
        },
        {
          name: 'highlightingEnabled',
          value: false,
        },
        {
          name: 'console',
          value: [],
        },
      ]),
    );
  }

  exportDatabase() {
    return this.export({
      prettyJson: true,
    });
  }

  importDatabase(file: File) {
    return this.import(file, {
      clearTablesBeforeImport: true,
    });
  }
}

export interface IAnnotation extends IIDBEntry {
  value: IAnnotJSON;
}

export interface IIDBEntry {
  name: string;
  value: any;
}

export interface IBundleEntry extends IIDBEntry {
  bundleId: string;
}

export interface IIDBLogs extends IIDBEntry {
  value: any[];
}

export interface IIDBModeOptions {
  transcriptID?: string | null;
  feedback?: any;
  sessionfile?: any;
  importConverter?: string;
  currentEditor?: string | null;
  currentLevel?: number | null;
  logging?: boolean | null;
  project?: ProjectDto | null;
  comment?: string | null;
  additionalSpeakerIds?: string[] | null;
  user?: {
    id: string;
    name: string;
    email: string;
  } | null;
  /**
   * Per-bundle pipeline run state (step 3b-i). 'queued'/'running' are
   * rehydrated as 'interrupted' at boot by BundleRestoreEffects — a run
   * never survives a reload.
   */
  runState?: BundleRunState;
}

export interface IIDBApplicationOptions {
  audioSettings?: {
    volume: number;
    speed: number;
  } | null;
  console?: any[] | null;
  easyMode?: boolean | null;
  highlightingEnabled?: boolean | null;
  interface?: string | null;
  language?: string | null;
  secondsPerLine?: number | null;
  showMagnifier?: boolean | null;
  useMode?: LoginMode | null;
  version?: number | null;
  editorFont?: string | null;
  playOnHover?: boolean | null;
  followPlayCursor?: boolean | null;
  showFeedbackNotice?: boolean | null;
  userProfile?: {
    name: string;
    email: string;
  } | null;
}

export type IDBApplicationOptionName =
  | 'audioSettings'
  | 'console'
  | 'easyMode'
  | 'highlightingEnabled'
  | 'interface'
  | 'language'
  | 'secondsPerLine'
  | 'showMagnifier'
  | 'useMode'
  | 'userProfile'
  | 'version'
  | 'editorFont'
  | 'playOnHover'
  | 'followPlayCursor'
  | 'showFeedbackNotice';

export const DefaultModeOptions: IIDBModeOptions = {
  logging: true,
};
