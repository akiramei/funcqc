import { CommandEnvironment } from './environment';
import { AsyncReader } from './reader';

/**
 * Base type for all command options
 */
export interface BaseCommandOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

/**
 * Command is a Reader function that reads from CommandEnvironment
 * and accepts options to produce some result
 */
export type Command<TOptions extends BaseCommandOptions, TResult = void> = (
  options: TOptions
) => AsyncReader<CommandEnvironment, TResult>;

/**
 * Simple command that doesn't return a value
 */
export type VoidCommand<TOptions extends BaseCommandOptions> = Command<TOptions, void>;

/**
 * Command that returns data (useful for testing or composition)
 */
export type DataCommand<TOptions extends BaseCommandOptions, TData> = Command<TOptions, TData>;