/**
 * Unified Analyze Command - Command Protocol準拠版 (DEPRECATED)
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { analyzeCommand } from './analyze';

export class UnifiedAnalyzeCommand implements Command {
  async getRequires(subCommand: string[]): Promise<DependencyType[]> {
    // Analyze typically requires existing snapshot data for analysis
    const dependencies: DependencyType[] = ['BASIC'];
    
    if (subCommand.includes('--call-graph')) dependencies.push('CALL_GRAPH');
    if (subCommand.includes('--types')) dependencies.push('TYPE_SYSTEM');
    if (subCommand.includes('--coupling')) dependencies.push('COUPLING');
    
    return [...new Set(dependencies)];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    const analyzeFn = analyzeCommand(options);
    await analyzeFn(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--call-graph')) options.callGraph = true;
    if (subCommand.includes('--types')) options.types = true;
    if (subCommand.includes('--coupling')) options.coupling = true;
    
    const scopeIndex = subCommand.indexOf('--scope');
    if (scopeIndex >= 0 && scopeIndex < subCommand.length - 1) {
      options.scope = subCommand[scopeIndex + 1];
    }
    
    return options;
  }
}