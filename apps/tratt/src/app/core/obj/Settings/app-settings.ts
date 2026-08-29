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
