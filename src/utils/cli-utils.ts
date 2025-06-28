import chalk from 'chalk';

/**
 * Log levels for consistent messaging
 */
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
  SUCCESS = 'success'
}

/**
 * Simple logger with colored output
 */
export class Logger {
  constructor(private verbose: boolean = false, private quiet: boolean = false) {}

  error(message: string, details?: any): void {
    if (this.quiet) return;
    console.error(chalk.red('❌ Error:'), message);
    if (this.verbose && details) {
      console.error(chalk.gray(this.formatDetails(details)));
    }
  }

  warn(message: string, details?: any): void {
    if (this.quiet) return;
    console.warn(chalk.yellow('⚠️  Warning:'), message);
    if (this.verbose && details) {
      console.warn(chalk.gray(this.formatDetails(details)));
    }
  }

  info(message: string, details?: any): void {
    if (this.quiet) return;
    console.log(chalk.blue('ℹ️  Info:'), message);
    if (this.verbose && details) {
      console.log(chalk.gray(this.formatDetails(details)));
    }
  }

  success(message: string, details?: any): void {
    if (this.quiet) return;
    console.log(chalk.green('✅ Success:'), message);
    if (this.verbose && details) {
      console.log(chalk.gray(this.formatDetails(details)));
    }
  }

  debug(message: string, details?: any): void {
    if (!this.verbose || this.quiet) return;
    console.log(chalk.gray('🔍 Debug:'), message);
    if (details) {
      console.log(chalk.gray(this.formatDetails(details)));
    }
  }

  log(message: string): void {
    if (this.quiet) return;
    console.log(message);
  }

  private formatDetails(details: any): string {
    if (typeof details === 'string') {
      return details;
    }
    return JSON.stringify(details, null, 2);
  }
}

/**
 * Progress indicator for long-running operations
 */
export class ProgressBar {
  private startTime = Date.now();

  constructor(
    private total: number,
    private label: string = 'Progress',
    private width: number = 40
  ) {}

  update(current: number, info?: string): void {
    const percentage = Math.round((current / this.total) * 100);
    const filled = Math.round((current / this.total) * this.width);
    const empty = this.width - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const elapsed = Date.now() - this.startTime;
    const rate = current / (elapsed / 1000);
    const eta = current > 0 ? Math.round((this.total - current) / rate) : 0;

    const infoText = info ? ` | ${info}` : '';
    const progressText = `${this.label}: [${bar}] ${percentage}% (${current}/${this.total}) ETA: ${eta}s${infoText}`;

    // Clear line and write progress
    process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
    process.stdout.write(progressText);
  }

  finish(message?: string): void {
    process.stdout.write('\n');
    if (message) {
      console.log(chalk.green('✓'), message);
    }
  }
}

/**
 * Format table data for console output
 */
export function formatTable(
  data: any[],
  headers: string[],
  options: {
    maxWidth?: number;
    padding?: number;
    alignment?: ('left' | 'right' | 'center')[];
  } = {}
): string {
  if (data.length === 0) {
    return 'No data available';
  }

  const { maxWidth = 120, padding = 1, alignment = [] } = options;
  
  // Calculate column widths
  const columnWidths = headers.map((header, index) => {
    const maxContentWidth = Math.max(
      header.length,
      ...data.map(row => String(row[index] || '').length)
    );
    return Math.min(maxContentWidth + padding * 2, Math.floor(maxWidth / headers.length));
  });

  // Format row
  const formatRow = (row: any[], isHeader = false): string => {
    return row.map((cell, index) => {
      const cellStr = String(cell || '');
      const width = columnWidths[index];
      const align = alignment[index] || 'left';
      
      let formatted = cellStr.length > width - padding * 2 
        ? cellStr.substring(0, width - padding * 2 - 3) + '...'
        : cellStr;

      switch (align) {
        case 'right':
          formatted = formatted.padStart(width);
          break;
        case 'center': {
          const leftPad = Math.floor((width - formatted.length) / 2);
          const rightPad = width - formatted.length - leftPad;
          formatted = ' '.repeat(leftPad) + formatted + ' '.repeat(rightPad);
          break;
        }
        default:
          formatted = formatted.padEnd(width);
      }

      return isHeader ? chalk.bold(formatted) : formatted;
    }).join('│');
  };

  // Build table
  const lines: string[] = [];
  
  // Header
  lines.push('┌' + columnWidths.map(w => '─'.repeat(w)).join('┬') + '┐');
  lines.push('│' + formatRow(headers, true) + '│');
  lines.push('├' + columnWidths.map(w => '─'.repeat(w)).join('┼') + '┤');
  
  // Data rows
  data.forEach(row => {
    lines.push('│' + formatRow(row) + '│');
  });
  
  // Footer
  lines.push('└' + columnWidths.map(w => '─'.repeat(w)).join('┴') + '┘');

  return lines.join('\n');
}

/**
 * Interactive prompt for user input
 */
export function prompt(question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const promptText = defaultValue 
      ? `${question} (${defaultValue}): `
      : `${question}: `;

    rl.question(promptText, (answer: string) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Confirm action with user
 */
export function confirm(question: string, defaultValue: boolean = false): Promise<boolean> {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const options = defaultValue ? '[Y/n]' : '[y/N]';
    const promptText = `${question} ${options}: `;

    rl.question(promptText, (answer: string) => {
      rl.close();
      
      if (answer.trim() === '') {
        resolve(defaultValue);
      } else {
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === 'y' || normalized === 'yes');
      }
    });
  });
}

/**
 * Select option from list
 */
export function select(
  question: string,
  options: string[],
  defaultIndex: number = 0
): Promise<number> {
  return new Promise((resolve) => {
    console.log(question);
    options.forEach((option, index) => {
      const marker = index === defaultIndex ? '→' : ' ';
      console.log(`${marker} ${index + 1}. ${option}`);
    });

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`Select option (1-${options.length}) [${defaultIndex + 1}]: `, (answer: string) => {
      rl.close();
      
      if (answer.trim() === '') {
        resolve(defaultIndex);
      } else {
        const selected = parseInt(answer.trim()) - 1;
        if (selected >= 0 && selected < options.length) {
          resolve(selected);
        } else {
          console.log(chalk.red('Invalid selection, using default.'));
          resolve(defaultIndex);
        }
      }
    });
  });
}

/**
 * Display a banner with version and info
 */
export function displayBanner(version: string): void {
  const banner = `
███████╗██╗   ██╗███╗   ██╗ ██████╗ ██████╗  ██████╗
██╔════╝██║   ██║████╗  ██║██╔════╝██╔═══██╗██╔════╝
█████╗  ██║   ██║██╔██╗ ██║██║     ██║   ██║██║     
██╔══╝  ██║   ██║██║╚██╗██║██║     ██║▄▄ ██║██║     
██║     ╚██████╔╝██║ ╚████║╚██████╗╚██████╔╝╚██████╗
╚═╝      ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝ ╚══▀▀═╝  ╚═════╝
                                                     
Function Quality Control v${version}
`;
  
  console.log(chalk.cyan(banner));
}

/**
 * Format command help text
 */
export function formatHelp(sections: {
  title: string;
  content: string;
}[]): string {
  return sections
    .map(section => {
      return `${chalk.yellow.bold(section.title)}\n${section.content}`;
    })
    .join('\n\n');
}

/**
 * Exit process with proper error code
 */
export function exitWithError(message: string, code: number = 1): never {
  console.error(chalk.red('Error:'), message);
  process.exit(code);
}

/**
 * Handle uncaught exceptions gracefully
 */
export function setupErrorHandling(): void {
  process.on('uncaughtException', (error) => {
    console.error(chalk.red('Uncaught Exception:'), error.message);
    if (process.env['NODE_ENV'] === 'development') {
      console.error(error.stack);
    }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('Unhandled Rejection at:'), promise, 'reason:', reason);
    if (process.env['NODE_ENV'] === 'development') {
      console.error((reason as Error).stack);
    }
    process.exit(1);
  });

  // Handle SIGINT (Ctrl+C) gracefully
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n⚠️  Process interrupted by user'));
    process.exit(0);
  });

  // Handle SIGTERM gracefully
  process.on('SIGTERM', () => {
    console.log(chalk.yellow('\n⚠️  Process terminated'));
    process.exit(0);
  });
}
