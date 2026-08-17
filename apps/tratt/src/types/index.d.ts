/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { TrattGuidelines } from '@tratt/assets';

export interface TrattValidationItem {
  start: number;
  length: number;
  code: string;
}

export {};

declare global {
  export const validateAnnotation: (
    transcript: string,
    guidelines: TrattGuidelines,
  ) => TrattValidationItem[];
  export const tidyUpAnnotation: (
    transcript: string,
    guidelines: TrattGuidelines,
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
