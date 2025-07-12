/**
 * Type declarations for test environment globals
 * Used only when NODE_ENV is test
 */

interface TestConnection {
  close(): Promise<void>;
  [key: string]: unknown;
}

declare global {
  // eslint-disable-next-line no-var
  // reason: [type-safety] Global variable declarations require var in ambient context
  var __TEST_TRACK_CONNECTION__: ((connection: TestConnection) => void) | undefined;
  // eslint-disable-next-line no-var
  // reason: [type-safety] Global variable declarations require var in ambient context
  var __TEST_UNTRACK_CONNECTION__: ((connection: TestConnection) => void) | undefined;
}

export {};