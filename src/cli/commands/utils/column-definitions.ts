/**
 * Column Definitions for Different Data Types
 * 
 * Defines how different data types should be displayed in table format
 * Each type has its own optimized column configuration
 */

import { ColumnConfig } from './table-formatter';

/**
 * Column definitions for function data (--type functions)
 */
export const FUNCTION_COLUMNS: ColumnConfig[] = [
  {
    key: 'name',
    header: 'Name',
    getValue: (func: any) => func.displayName || func.name,
    align: 'left',
    minWidth: 8,
    maxWidth: 30
  },
  {
    key: 'file',
    header: 'File',
    getValue: (func: any) => {
      const path = func.filePath;
      // For functions, show relative path from src/
      if (path.startsWith('src/')) {
        return path.substring(4); // Remove 'src/' prefix
      }
      return path;
    },
    align: 'left',
    minWidth: 10,
    maxWidth: 35
  },
  {
    key: 'line',
    header: 'Line',
    getValue: (func: any) => func.startLine,
    align: 'right',
    minWidth: 4,
    maxWidth: 6
  },
  {
    key: 'cc',
    header: 'CC',
    getValue: (func: any) => func.metrics?.cyclomaticComplexity || '-',
    align: 'right',
    minWidth: 2,
    maxWidth: 4
  },
  {
    key: 'type',
    header: 'Type',
    getValue: (func: any) => {
      const type = func.functionType || 'function';
      // Abbreviate common types
      const typeMap: Record<string, string> = {
        'function': 'func',
        'method': 'meth', 
        'arrow': 'arrow',
        'local': 'local'
      };
      return typeMap[type] || type;
    },
    align: 'left',
    minWidth: 4,
    maxWidth: 8
  },
  {
    key: 'export',
    header: 'Export',
    getValue: (func: any) => func.isExported ? 'Yes' : 'No',
    align: 'left',
    minWidth: 3,
    maxWidth: 6
  }
];

/**
 * Column definitions for file data (--type files)
 */
export const FILE_COLUMNS: ColumnConfig[] = [
  {
    key: 'path',
    header: 'Path',
    getValue: (file: any) => file.filePath,
    align: 'left',
    minWidth: 10,
    maxWidth: 50
  },
  {
    key: 'lang',
    header: 'Lang',
    getValue: (file: any) => file.language || 'unknown',
    align: 'left',
    minWidth: 4,
    maxWidth: 10
  },
  {
    key: 'size',
    header: 'Size',
    getValue: (file: any) => formatFileSize(file.fileSizeBytes),
    align: 'right',
    minWidth: 4,
    maxWidth: 10
  },
  {
    key: 'lines',
    header: 'Lines',
    getValue: (file: any) => file.lineCount.toLocaleString(),
    align: 'right',
    minWidth: 5,
    maxWidth: 7
  },
  {
    key: 'funcs',
    header: 'Funcs',
    getValue: (file: any) => file.functionCount.toString(),
    align: 'right',
    minWidth: 5,
    maxWidth: 6
  }
];

/**
 * Format file size for display (copied from inspect.ts)
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}