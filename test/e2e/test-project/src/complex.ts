export function complexFunction(input: any): string {
  if (typeof input === 'string') {
    if (input.length > 10) {
      for (let i = 0; i < input.length; i++) {
        if (input[i] === 'x') {
          try {
            return input.substring(0, i);
          } catch (error) {
            console.error(error);
            return '';
          }
        }
      }
      return input.toUpperCase();
    } else if (input.length > 5) {
      return input.toLowerCase();
    } else {
      return input;
    }
  } else if (typeof input === 'number') {
    if (input > 100) {
      return 'large';
    } else if (input > 50) {
      return 'medium';
    } else {
      return 'small';
    }
  } else {
    return 'unknown';
  }
}

class Calculator {
  private result: number = 0;

  constructor(initial: number = 0) {
    this.result = initial;
  }

  add(value: number): this {
    this.result += value;
    return this;
  }

  multiply(value: number): this {
    this.result *= value;
    return this;
  }

  getResult(): number {
    return this.result;
  }

  reset(): void {
    this.result = 0;
  }
}
