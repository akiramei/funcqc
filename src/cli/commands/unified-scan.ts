/**
 * Unified Scan Command - Command Protocol準拠版 (DEPRECATED)
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { scanCommand } from './scan';

export class UnifiedScanCommand implements Command {
  async getRequires(subCommand: string[]): Promise<DependencyType[]> {
    // Scan creates new snapshots, so requires SNAPSHOT + analysis types
    const dependencies: DependencyType[] = ['SNAPSHOT', 'BASIC'];
    
    if (subCommand.includes('--with-basic')) dependencies.push('BASIC');
    if (subCommand.includes('--call-graph')) dependencies.push('CALL_GRAPH');  
    if (subCommand.includes('--types')) dependencies.push('TYPE_SYSTEM');
    if (subCommand.includes('--coupling')) dependencies.push('COUPLING');
    
    return [...new Set(dependencies)];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    const scanFn = scanCommand(options);
    await scanFn(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--force')) options.force = true;
    if (subCommand.includes('--with-basic')) options.withBasic = true;
    if (subCommand.includes('--call-graph')) options.callGraph = true;
    if (subCommand.includes('--types')) options.types = true;
    if (subCommand.includes('--coupling')) options.coupling = true;
    
    const labelIndex = subCommand.indexOf('--label');
    if (labelIndex >= 0 && labelIndex < subCommand.length - 1) {
      options.label = subCommand[labelIndex + 1];
    }
    
    const scopeIndex = subCommand.indexOf('--scope');
    if (scopeIndex >= 0 && scopeIndex < subCommand.length - 1) {
      options.scope = subCommand[scopeIndex + 1];
    }
    
    return options;
  }
}