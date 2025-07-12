/**
 * Global type declarations for test environment
 */

declare global {
  var __TEST_TRACK_CONNECTION__: ((connection: any) => void) | undefined;
  var __TEST_UNTRACK_CONNECTION__: ((connection: any) => void) | undefined;
  
  namespace NodeJS {
    interface Global {
      __TEST_TRACK_CONNECTION__?: (connection: any) => void;
      __TEST_UNTRACK_CONNECTION__?: (connection: any) => void;
    }
  }
}

export {};