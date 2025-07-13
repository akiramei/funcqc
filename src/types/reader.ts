/**
 * Reader function type that reads from environment E and returns R
 */
export type Reader<E, R> = (env: E) => R;

/**
 * Async Reader function type
 */
export type AsyncReader<E, R> = (env: E) => Promise<R>;

/**
 * Helper to compose Reader functions
 */
export function map<E, A, B>(f: (a: A) => B): (reader: Reader<E, A>) => Reader<E, B> {
  return (reader) => (env) => f(reader(env));
}

/**
 * Helper to compose AsyncReader functions
 */
export function mapAsync<E, A, B>(
  f: (a: A) => Promise<B>
): (reader: AsyncReader<E, A>) => AsyncReader<E, B> {
  return (reader) => async (env) => f(await reader(env));
}

/**
 * Chain Reader functions
 */
export function flatMap<E, A, B>(
  f: (a: A) => Reader<E, B>
): (reader: Reader<E, A>) => Reader<E, B> {
  return (reader) => (env) => f(reader(env))(env);
}

/**
 * Chain AsyncReader functions
 */
export function flatMapAsync<E, A, B>(
  f: (a: A) => AsyncReader<E, B>
): (reader: AsyncReader<E, A>) => AsyncReader<E, B> {
  return (reader) => async (env) => f(await reader(env))(env);
}

/**
 * Pure value in Reader context
 */
export function pure<E, A>(value: A): Reader<E, A> {
  return () => value;
}

/**
 * Pure async value in Reader context
 */
export function pureAsync<E, A>(value: A): AsyncReader<E, A> {
  return () => Promise.resolve(value);
}

/**
 * Ask for the environment
 */
export function ask<E>(): Reader<E, E> {
  return (env) => env;
}

/**
 * Ask for the async environment
 */
export function askAsync<E>(): AsyncReader<E, E> {
  return (env) => Promise.resolve(env);
}