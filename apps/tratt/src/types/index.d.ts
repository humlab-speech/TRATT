/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { OctraGuidelines } from '@octra/assets';

export interface OctraValidationItem {
  start: number;
  length: number;
  code: string;
}

export {};

declare global {
  export const validateAnnotation: (
    transcript: string,
    guidelines: OctraGuidelines,
  ) => OctraValidationItem[];
  export const tidyUpAnnotation: (
    transcript: string,
    guidelines: OctraGuidelines,
  ) => string;

  interface FileSystemEntry {
    readonly isFile: boolean;
    readonly isDirectory: boolean;
    readonly name: string;
    readonly fullPath: string;
  }

  interface FileSystemFileEntry extends FileSystemEntry {
    file(
      successCallback: (file: File) => void,
      errorCallback?: (error: DOMException) => void,
    ): void;
  }

  interface FileSystemDirectoryReader {
    readEntries(
      successCallback: (entries: FileSystemEntry[]) => void,
      errorCallback?: (error: DOMException) => void,
    ): void;
  }

  interface FileSystemDirectoryEntry extends FileSystemEntry {
    createReader(): FileSystemDirectoryReader;
  }
}
