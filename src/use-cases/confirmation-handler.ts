/**
 * Confirmation handler for dangerous operations
 */

import readline from 'readline';

export interface ConfirmationOptions {
  message: string;
  defaultValue?: boolean;
  force?: boolean; // Skip confirmation if true
}

export interface ConfirmationResult {
  confirmed: boolean;
  skipped: boolean; // True if confirmation was skipped due to force flag
}

/**
 * Handles user confirmation for dangerous operations
 */
export class ConfirmationHandler {
  /**
   * Ask for user confirmation
   */
  async confirm(options: ConfirmationOptions): Promise<ConfirmationResult> {
    // Skip confirmation if force flag is set
    if (options.force) {
      return { confirmed: true, skipped: true };
    }

    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const defaultText = options.defaultValue 
        ? ' (Y/n)' 
        : ' (y/N)';
      
      rl.question(`${options.message}${defaultText} `, (answer) => {
        rl.close();
        
        const normalizedAnswer = answer.toLowerCase().trim();
        let confirmed: boolean;
        
        if (normalizedAnswer === '') {
          // Use default value if no input
          confirmed = options.defaultValue ?? false;
        } else if (normalizedAnswer === 'y' || normalizedAnswer === 'yes') {
          confirmed = true;
        } else if (normalizedAnswer === 'n' || normalizedAnswer === 'no') {
          confirmed = false;
        } else {
          // Invalid input, default to false for safety
          confirmed = false;
        }
        
        resolve({ confirmed, skipped: false });
      });
    });
  }

  /**
   * Create confirmation message for vectorize operations
   */
  createVectorizeConfirmationMessage(
    operation: string, 
    functionCount?: number,
    estimatedCost?: number
  ): string {
    let message = `⚠️  ${operation}`;
    
    if (functionCount !== undefined) {
      message += `\nThis will process ${functionCount} functions`;
    }
    
    if (estimatedCost !== undefined && estimatedCost > 0) {
      message += `\nEstimated cost: ~$${estimatedCost.toFixed(3)}`;
    }
    
    message += '\nDo you want to continue?';
    
    return message;
  }

  /**
   * Estimate cost for embedding operations
   */
  estimateEmbeddingCost(
    functionCount: number, 
    model: string = 'text-embedding-3-small',
    avgTokensPerFunction: number = 200
  ): number {
    // OpenAI pricing (as of 2024)
    const pricing: Record<string, number> = {
      'text-embedding-ada-002': 0.0001, // per 1K tokens
      'text-embedding-3-small': 0.00002, // per 1K tokens  
      'text-embedding-3-large': 0.00013  // per 1K tokens
    };
    
    const pricePerThousandTokens = pricing[model] || pricing['text-embedding-3-small'];
    const totalTokens = functionCount * avgTokensPerFunction;
    
    return (totalTokens / 1000) * pricePerThousandTokens;
  }
}