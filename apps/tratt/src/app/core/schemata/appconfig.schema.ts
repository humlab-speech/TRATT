import { JSONSchema4 } from 'json-schema';

export const AppConfigSchema: JSONSchema4 = {
  $id: '2.0.0',
  required: ['version', 'tratt'],
  type: 'object',
  properties: {
    version: {
      type: 'string',
      description:
        'The version shows which version of TRATT is compatible with this configuration.',
    },
    api: {
      required: ['url', 'appToken'],
      properties: {
        url: {
          type: 'string',
          description: 'URL to the Octra-Backend API',
        },
        appToken: {
          type: 'string',
          description: 'Apptoken offered by the Octra-Backend.',
        },
      },
      type: 'object',
    },
    tratt: {
      required: ['database', 'supportEmail', 'allowed_browsers', 'languages'],
      properties: {
        database: {
          required: ['name'],
          properties: {
            name: {
              type: 'string',
              description:
                "Set the name of the local database that is found in the user's browser. This attribute must be set.",
            },
          },
          type: 'object',
        },
        supportEmail: {
          type: 'string',
          description: 'Email address visible if the server is offline.',
        },
        manual: {
          properties: {
            url: {
              type: 'string',
              description:
                'Base URL of the TRATT user manual. Every manual page is expected directly under this URL. Defaults to the manual in the TRATT repository.',
            },
            pageExtension: {
              type: 'string',
              description:
                "Extension appended to a manual page name, e.g. '.md' for the Markdown sources on GitHub or '.html' for a generated static site.",
            },
            locales: {
              items: {
                type: 'string',
              },
              type: 'array',
              description:
                'Languages the manual is published in, most preferred first. The first entry is the default and lives at the root of the manual site; every other language lives in a subdirectory named after its code. The manual is linked in the interface language when it is available.',
            },
          },
          type: 'object',
        },
        login: {
          properties: {
            enabled: {
              type: 'boolean',
              description:
                'Defines if users are allowed to use the Online Mode.',
            },
          },
          type: 'object',
        },
        allowed_browsers: {
          items: {
            properties: {
              name: {
                type: 'string',
              },
              version: {
                type: 'string',
              },
            },
            type: 'object',
          },
          type: 'array',
          description:
            "You can define the browsers which can be used. Because TRATT was tested in Chrome it's recommended to use Chrome. If there is no entry all browsers are allowed.",
        },
        languages: {
          items: {
            type: 'string',
          },
          type: 'array',
          description:
            'If you translated TRATT to other languages, you can define these in this array. For each language there has to be one octra_[lang].json',
        },
        audioExamples: {
          type: 'array',
          items: {
            required: ['language', 'url'],
            type: 'object',
            properties: {
              language: {
                type: 'string',
                pattern: '[a-z]{2}',
              },
              url: {
                type: 'string',
              },
              description: {
                type: 'string',
              },
            },
          },
        },
        inactivityNotice: {
          type: 'object',
          properties: {
            showAfter: {
              type: 'number',
              description:
                'Set the time in minutes after that a notice because of inactivity is shown.',
            },
          },
        },
        maintenanceNotification: {
          type: 'object',
          description:
            'Set the time after that a notice because of inactivity is shown.',
          required: ['active', 'apiURL'],
          properties: {
            active: {
              type: 'string',
              enum: ['active', 'inactive'],
            },
            apiURL: {
              type: 'string',
              pattern: '^https?://',
            },
          },
        },
        tracking: {
          type: 'object',
          properties: {
            active: {
              type: 'string',
              enum: ['matomo', ''],
            },
            matomo: {
              type: 'object',
              description: 'Settings for matomo',
              properties: {
                host: {
                  type: 'string',
                },
                siteID: {
                  type: 'number',
                },
              },
            },
          },
        },
        oldVersion: {
          type: 'object',
          required: ['url'],
          description:
            'If set TRATT shows a link to a previous version on the login page.',
          properties: {
            url: {
              type: 'string',
            },
          },
        },
      },
      type: 'object',
    },
    trattBackend: {
      required: ['enabled', 'url'],
      type: 'object',
      description: 'Defines if the OCB shall be integrated into TRATT.',
      properties: {
        enabled: {
          type: 'boolean',
        },
        url: {
          type: 'string',
        },
      },
    },
  },
};
