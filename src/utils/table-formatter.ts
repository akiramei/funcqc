import chalk from 'chalk';

export interface TableColumn {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  color?: (value: string) => string;
}

export interface TableRow {
  [key: string]: string | number;
}

export class TableFormatter {
  private columns: TableColumn[];
  private rows: TableRow[] = [];

  constructor(columns: TableColumn[]) {
    this.columns = columns;
  }

  addRow(row: TableRow): void {
    this.rows.push(row);
  }

  addRows(rows: TableRow[]): void {
    this.rows.push(...rows);
  }

  render(): string {
    if (this.rows.length === 0) return '';

    const output: string[] = [];
    
    // Header
    const headerRow = this.columns
      .map(col => this.padCell(chalk.bold(col.header), col.width, col.align))
      .join(' │ ');
    output.push(`│ ${headerRow} │`);

    // Separator
    const separator = this.columns
      .map(col => '─'.repeat(col.width))
      .join('─┼─');
    output.push(`├─${separator}─┤`);

    // Rows
    this.rows.forEach(row => {
      const rowStr = this.columns
        .map(col => {
          const value = String(row[col.header] || '');
          const coloredValue = col.color ? col.color(value) : value;
          return this.padCell(coloredValue, col.width, col.align);
        })
        .join(' │ ');
      output.push(`│ ${rowStr} │`);
    });

    // Top border
    const topBorder = '┌─' + separator.replace(/┼/g, '┬') + '─┐';
    // Bottom border  
    const bottomBorder = '└─' + separator.replace(/┼/g, '┴') + '─┘';

    return [topBorder, ...output, bottomBorder].join('\n');
  }

  private padCell(content: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
    // Remove ANSI codes for length calculation
    const cleanContent = content.replace(/\u001b\[[0-9;]*m/g, '');
    const padding = width - cleanContent.length;
    
    if (padding <= 0) {
      return content.slice(0, width);
    }

    switch (align) {
      case 'right':
        return ' '.repeat(padding) + content;
      case 'center': {
        const leftPad = Math.floor(padding / 2);
        const rightPad = padding - leftPad;
        return ' '.repeat(leftPad) + content + ' '.repeat(rightPad);
      }
      default:
        return content + ' '.repeat(padding);
    }
  }
}

// Convenience function
export function createTable(columns: TableColumn[]): TableFormatter {
  return new TableFormatter(columns);
}

// Simple list formatter for non-tabular data
export function formatList(items: string[], options: {
  bullet?: string;
  indent?: number;
  maxItems?: number;
} = {}): string {
  const { bullet = '•', indent = 2, maxItems } = options;
  const displayItems = maxItems ? items.slice(0, maxItems) : items;
  const indentStr = ' '.repeat(indent);
  
  const formatted = displayItems.map(item => `${indentStr}${bullet} ${item}`);
  
  if (maxItems && items.length > maxItems) {
    formatted.push(`${indentStr}... and ${items.length - maxItems} more`);
  }
  
  return formatted.join('\n');
}