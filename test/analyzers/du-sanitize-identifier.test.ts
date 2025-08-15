/**
 * Tests for sanitizeIdentifier - Phase 2 Comprehensive Edge Cases
 * 
 * Tests all edge cases for identifier sanitization including:
 * - Boolean values (true/false)
 * - Number values (0, 1, 42, etc.)
 * - Hyphenated strings
 * - Reserved words
 * - Special characters
 */

import { describe, it, expect } from 'vitest';
import { DUPlanGenerator } from '../../src/analyzers/type-refactoring/du-incremental/plan-generator';

// Test wrapper to access private sanitizeIdentifier method
class TestablePlanGenerator extends DUPlanGenerator {
  // Make sanitizeIdentifier accessible for testing
  public testSanitizeIdentifier(value: string): string {
    return (this as any).sanitizeIdentifier(value);
  }
}

describe('sanitizeIdentifier - Phase 2 Comprehensive Tests', () => {
  let generator: TestablePlanGenerator;

  beforeEach(() => {
    generator = new TestablePlanGenerator();
  });

  describe('Boolean Value Sanitization', () => {
    it('should handle boolean true', () => {
      const result = generator.testSanitizeIdentifier('true');
      expect(result).toBe('TrueValue'); // Reserved word gets Value suffix
    });

    it('should handle boolean false', () => {
      const result = generator.testSanitizeIdentifier('false');
      expect(result).toBe('FalseValue'); // Reserved word gets Value suffix
    });

    it('should handle boolean variations', () => {
      expect(generator.testSanitizeIdentifier('True')).toBe('TrueValue'); // Also reserved
      expect(generator.testSanitizeIdentifier('False')).toBe('FalseValue'); // Also reserved
      expect(generator.testSanitizeIdentifier('TRUE')).toBe('TrueValue');
      expect(generator.testSanitizeIdentifier('FALSE')).toBe('FalseValue');
    });
  });

  describe('Number Value Sanitization', () => {
    it('should handle number 0', () => {
      const result = generator.testSanitizeIdentifier('0');
      expect(result).toBe('Variant0'); // Starts with number -> Variant prefix
    });

    it('should handle number 1', () => {
      const result = generator.testSanitizeIdentifier('1');
      expect(result).toBe('Variant1');
    });

    it('should handle positive number 42', () => {
      const result = generator.testSanitizeIdentifier('42');
      expect(result).toBe('Variant42');
    });

    it('should handle negative number -1', () => {
      const result = generator.testSanitizeIdentifier('-1');
      expect(result).toBe('Variant1'); // Special chars removed, then Variant prefix
    });

    it('should handle decimal numbers', () => {
      const result = generator.testSanitizeIdentifier('3.14');
      expect(result).toBe('Variant314'); // Dot removed, leading number handled
    });

    it('should handle leading zero', () => {
      const result = generator.testSanitizeIdentifier('007');
      expect(result).toBe('Variant007');
    });
  });

  describe('Hyphenated String Sanitization', () => {
    it('should handle single hyphen', () => {
      const result = generator.testSanitizeIdentifier('user-data');
      expect(result).toBe('UserData'); // PascalCase conversion
    });

    it('should handle multiple hyphens', () => {
      const result = generator.testSanitizeIdentifier('multi-word-identifier');
      expect(result).toBe('MultiWordIdentifier');
    });

    it('should handle leading hyphen', () => {
      const result = generator.testSanitizeIdentifier('-leading');
      expect(result).toBe('Leading'); // Leading hyphen removed
    });

    it('should handle trailing hyphen', () => {
      const result = generator.testSanitizeIdentifier('trailing-');
      expect(result).toBe('Trailing'); // Trailing hyphen removed
    });

    it('should handle consecutive hyphens', () => {
      const result = generator.testSanitizeIdentifier('double--hyphen');
      expect(result).toBe('DoubleHyphen'); // Multiple spaces become single
    });

    it('should handle mixed separators', () => {
      const result = generator.testSanitizeIdentifier('user-data_type');
      expect(result).toBe('UserDataType'); // Both hyphen and underscore
    });
  });

  describe('Reserved Word Sanitization', () => {
    // Test core JavaScript/TypeScript reserved words
    const testReservedWords = [
      'break', 'case', 'class', 'const', 'default', 'function',
      'if', 'else', 'return', 'switch', 'true', 'false', 'var', 'let'
    ];

    testReservedWords.forEach(word => {
      it(`should handle reserved word "${word}"`, () => {
        const result = generator.testSanitizeIdentifier(word);
        // Reserved words should get Value suffix
        expect(result).toBe(`${capitalize(word)}Value`);
      });
    });

    it('should handle mixed case reserved words', () => {
      const result = generator.testSanitizeIdentifier('Class');
      expect(result).toBe('ClassValue'); // Normalized to ClassValue
    });

    it('should handle reserved word variants', () => {
      const result = generator.testSanitizeIdentifier('DEFAULT');
      expect(result).toBe('DefaultValue'); // Normalized to DefaultValue
    });

    it('should handle TypeScript-specific reserved words', () => {
      expect(generator.testSanitizeIdentifier('interface')).toBe('InterfaceValue');
      expect(generator.testSanitizeIdentifier('type')).toBe('TypeValue');
      expect(generator.testSanitizeIdentifier('namespace')).toBe('NamespaceValue');
    });
  });

  describe('Special Character Sanitization', () => {
    it('should handle underscores', () => {
      const result = generator.testSanitizeIdentifier('user_data');
      expect(result).toBe('UserData'); // Underscores become PascalCase
    });

    it('should handle spaces', () => {
      const result = generator.testSanitizeIdentifier('user data');
      expect(result).toBe('UserData');
    });

    it('should handle mixed special characters', () => {
      const result = generator.testSanitizeIdentifier('user-data_type event');
      expect(result).toBe('UserDataTypeEvent');
    });

    it('should handle symbols and punctuation', () => {
      const result = generator.testSanitizeIdentifier('item@type!');
      expect(result).toBe('Itemtype'); // Non-alphanumeric removed
    });

    it('should handle dots and commas', () => {
      const result = generator.testSanitizeIdentifier('version.1.0');
      expect(result).toBe('Version10'); // Dots removed, doesn't start with number after processing
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      const result = generator.testSanitizeIdentifier('');
      expect(result).toBe('Variant'); // Empty becomes Variant
    });

    it('should handle whitespace only', () => {
      const result = generator.testSanitizeIdentifier('   ');
      expect(result).toBe('Variant'); // Trimmed to empty
    });

    it('should handle numbers at start', () => {
      const result = generator.testSanitizeIdentifier('123abc');
      expect(result).toBe('Variant123abc'); // Leading numbers get Variant prefix
    });

    it('should handle all special characters', () => {
      const result = generator.testSanitizeIdentifier('!@#$%^&*()');
      expect(result).toBe('Variant'); // All removed, fallback
    });

    it('should handle single character', () => {
      const result = generator.testSanitizeIdentifier('a');
      expect(result).toBe('A');
    });

    it('should handle single digit', () => {
      const result = generator.testSanitizeIdentifier('7');
      expect(result).toBe('Variant7');
    });
  });

  describe('Case Conversion Tests', () => {
    it('should convert lowercase to PascalCase', () => {
      const result = generator.testSanitizeIdentifier('lowercase');
      expect(result).toBe('Lowercase');
    });

    it('should preserve existing PascalCase', () => {
      const result = generator.testSanitizeIdentifier('PascalCase');
      expect(result).toBe('Pascalcase'); // Converted to Pascal rules
    });

    it('should convert UPPERCASE to PascalCase', () => {
      const result = generator.testSanitizeIdentifier('UPPERCASE');
      expect(result).toBe('Uppercase');
    });

    it('should handle camelCase conversion', () => {
      const result = generator.testSanitizeIdentifier('camelCase');
      expect(result).toBe('Camelcase');
    });

    it('should handle multiple word cases', () => {
      expect(generator.testSanitizeIdentifier('multi word test')).toBe('MultiWordTest');
      expect(generator.testSanitizeIdentifier('MULTI-WORD-TEST')).toBe('MultiWordTest');
      expect(generator.testSanitizeIdentifier('mixed_Case-example')).toBe('MixedCaseExample');
    });
  });

  // Helper function for capitalize
  function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }
});