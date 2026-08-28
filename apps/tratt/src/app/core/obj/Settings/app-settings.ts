export interface AppSettings {
  version: string;
  api?: {
    url: string;
    appToken: string;
  };
  tratt: {
    database: {
      name: string;
    };
    supportEmail: string;
    manual?: {
      url?: string;
      pageExtension?: string;
      locales?: string[];
    };
    login?: {
      enabled: boolean;
    };
    plugins?: {
      asr?: ASRSettings;
    };
    allowed_browsers: {
      name: string;
      version: string;
    }[];
    languages: string[];
    tracking?: {
      active: string;
      matomo: {
        host: string;
        siteID: number;
      };
    };
    audioExamples: {
      language: string;
      url: string;
      description: string;
    }[];
    inactivityNotice?: {
      showAfter: number;
    };
    maintenanceNotification: {
      active: string;
      apiURL: string;
    };
    oldVersion?: {
      url?: string;
    };
  };
  trattBackend?: {
    enabled: boolean;
    url: string;
  };
}

export interface ServiceProvider {
  provider: string;
  basName?: string;
  maxSignalDuration?: number;
  maxSignalSize?: number;
  quotaPerMonth?: number;
  knownIssues?: string;
  usedQuota?: number;
  type: string;
  termsURL: string;
  dataStoragePolicy: string;
  homepageURL: string;
  logoURL: string;
  host: string;
}

export interface ASRSettings {
  enabled: boolean;
  shibbolethURL: string;
  calls: string[];
  services: ServiceProvider[];
  asrInfoURL?: string;
  basConfigURL?: string;
  asrQuotaInfoURL?: string;
}
