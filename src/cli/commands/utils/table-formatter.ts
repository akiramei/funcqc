/**
 * Unified Table Formatter
 * 
 * Independent format layer that handles table display for any data type
 * Supports dynamic column width calculation and type-agnostic formatting
 */

export interface ColumnConfig<T = unknown> {
  key: string;
  header: string;
  getValue: (item: T) => string | number;
  align?: 'left' | 'right';
  minWidth?: number;
  maxWidth?: number;
}

interface ColumnWithWidth<T = unknown> extends ColumnConfig<T> {
  width: number;
}

export class TableFormatter {
  /**
   * Format data as a compact table
   */
  static format<T>(data: T[], columns: ColumnConfig<T>[], title?: string): void {
    if (data.length === 0) {
      console.log('No data to display.');
      return;
    }

    const columnsWithWidths = this.calculateColumnWidths(data, columns);

    // Title
    if (title) {
      console.log(title);
      console.log('─'.repeat(this.getTotalWidth(columnsWithWidths)));
    }

    // Header
    this.printHeader(columnsWithWidths);
    
    // Separator
    this.printSeparator(columnsWithWidths);
    
    // Data rows
    this.printRows(data, columnsWithWidths);
  }

  /**
   * Calculate optimal column widths based on data and constraints
   */
  private static calculateColumnWidths<T>(data: T[], columns: ColumnConfig<T>[]): ColumnWithWidth<T>[] {
    return columns.map(col => {
      // Get all values for this column
      const values = data.map(item => {
        const value = col.getValue(item);
        return value != null ? String(value) : '';
      });
      
      // Calculate content width requirements
      const headerWidth = col.header.length;
      const maxContentWidth = Math.max(0, ...values.map(v => v.length));
      const contentBasedWidth = Math.max(headerWidth, maxContentWidth);
      
      // Apply constraints
      const minWidth = col.minWidth || Math.max(3, headerWidth);
      const maxWidth = col.maxWidth || 50;
      
      const width = Math.max(
        minWidth,
        Math.min(maxWidth, contentBasedWidth)
      );

      return {
        ...col,
        width
      };
    });
  }

  /**
   * Print table header
   */
  private static printHeader<T>(columns: ColumnWithWidth<T>[]): void {
    const headerParts = columns.map(col => {
      const align = col.align || 'left';
      return align === 'right' 
        ? col.header.padStart(col.width)
        : col.header.padEnd(col.width);
    });
    
    console.log(headerParts.join(' '));
  }

  /**
   * Print separator line
   */
  private static printSeparator<T>(columns: ColumnWithWidth<T>[]): void {
    const separatorParts = columns.map(col => '─'.repeat(col.width));
    console.log(separatorParts.join(' '));
  }

  /**
   * Print data rows
   */
  private static printRows<T>(data: T[], columns: ColumnWithWidth<T>[]): void {
    data.forEach(item => {
      const rowParts = columns.map(col => {
        const value = col.getValue(item);
        const displayValue = value != null ? String(value) : '';
        
        // Truncate if necessary
        const truncatedValue = displayValue.length > col.width
          ? displayValue.slice(0, col.width - 3) + '...'
          : displayValue;
        
        // Apply alignment
        const align = col.align || 'left';
        return align === 'right'
          ? truncatedValue.padStart(col.width)
          : truncatedValue.padEnd(col.width);
      });
      
      console.log(rowParts.join(' '));
    });
  }

  /**
   * Get total width of table (for title underline)
   */
  private static getTotalWidth<T>(columns: ColumnWithWidth<T>[]): number {
    return columns.reduce((total, col) => total + col.width, 0) + 
           Math.max(0, columns.length - 1); // spaces between columns
  }
}