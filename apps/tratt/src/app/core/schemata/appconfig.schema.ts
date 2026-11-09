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
    visp: {
      description:
        'VISP integration (deployment-mounted). Only used when TRATT is opened with ?workspace=visp&projectId=<id>; stand-alone installations leave it out.',
      type: 'object',
      required: ['serverUrl', 'mediaOrigin', 'transcriptionLevel'],
      properties: {
        serverUrl: {
          type: 'string',
          pattern: '^wss?://',
          description:
            "emu-webapp-server's websocket, proxied on TRATT's own host, e.g. wss://tratt.example.org/emu-ws",
        },
        mediaOrigin: {
          type: 'string',
          pattern: '^https?://',
          description:
            'The origin emu-webapp-server puts in audio URLs (its MEDIA_FILE_BASE_URL), e.g. https://artic.example.org. Audio is fetched from the same path on TRATT\'s own host.',
        },
        transcriptionLevel: {
          type: 'string',
          minLength: 1,
          description:
            "The SEGMENT level in each project's VISP_DBconfig.json that TRATT transcribes into. Every other level is left untouched.",
        },
      },
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
        branding: {
          properties: {
            node: {
              properties: {
                name: { type: 'string', description: 'Name of the hosting node, used as the logo’s alt text.' },
                logo: { type: 'string', description: 'URL or asset path of the node’s logo (SVG preferred).' },
                url: { type: 'string', description: 'Where the logo links to.' },
              },
              required: ['name', 'logo', 'url'],
              type: 'object',
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
