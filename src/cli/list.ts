import { ListCommandOptions, FunctionInfo } from '../types';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';

export async function listCommand(
  options: ListCommandOptions
): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    const storage = new PGLiteStorageAdapter(config.storage.path!);
    await storage.init();
    
    try {
      const functions = await storage.queryFunctions({
        sort: 'file_path,start_line'
      });
      
      if (functions.length === 0) {
        console.log('No functions found. Run `funcqc scan` first.');
        return;
      }
      
      if (options.json) {
        outputJSON(functions);
      } else {
        outputFormatted(functions);
      }
    } finally {
      await storage.close();
    }
    
  } catch (error) {
    console.error('Failed to list functions:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function outputJSON(functions: FunctionInfo[]): void {
  const output = {
    meta: {
      total: functions.length,
      timestamp: new Date().toISOString()
    },
    functions: functions.map(func => ({
      id: func.id,
      name: func.name,
      file: func.filePath,
      signature: func.signature,
      startLine: func.startLine,
      endLine: func.endLine,
      isExported: func.isExported,
      isAsync: func.isAsync,
      metrics: func.metrics
    }))
  };
  
  console.log(JSON.stringify(output, null, 2));
}

function outputFormatted(functions: FunctionInfo[]): void {
  console.log('ID       Name                            CC File                                     Location');
  console.log('-------- ------------------------------- -- ---------------------------------------- --------');
  
  for (const func of functions) {
    const id = func.id.substring(0, 8);
    const name = func.name.length > 31 ? func.name.substring(0, 28) + '...' : func.name;
    const complexity = String(func.metrics?.cyclomaticComplexity || 1);
    const filePath = func.filePath.length > 40 ? '...' + func.filePath.substring(func.filePath.length - 37) : func.filePath;
    const location = `${func.startLine}-${func.endLine}`;
    
    console.log(`${id.padEnd(8)} ${name.padEnd(31)} ${complexity.padStart(2)} ${filePath.padEnd(40)} ${location}`);
  }
}