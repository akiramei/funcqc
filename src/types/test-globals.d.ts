/**
 * Type declarations for test environment globals
 * Used only when NODE_ENV is test
 */

interface TestConnection {
  close(): Promise<void>;
  [key: string]: unknown;
}

/* eslint-disable no-var */
// reason: [type-safety] Global variable declarations require var in ambient context
declare global {
  var __TEST_TRACK_CONNECTION__: ((connection: TestConnection) => void) | undefined;
  var __TEST_UNTRACK_CONNECTION__: ((connection: TestConnection) => void) | undefined;
}
/* eslint-enable no-var */

export {};