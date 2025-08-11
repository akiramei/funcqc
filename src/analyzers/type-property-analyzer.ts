/**
 * Type Property Analyzer
 * 
 * Provides accurate property count analysis using TypeScript TypeChecker
 * with caching for performance optimization.
 */

import { Type, TypeChecker, Symbol as TsSymbol } from 'ts-morph';

export interface TypePropertyInfo {
  propertyCount: number;
  propertyNames: string[];
  typeKind: TypeKind;
  isComplex: boolean;
  confidence: 'high' | 'medium' | 'low';
}

export type TypeKind = 'primitive' | 'object' | 'interface' | 'class' | 'union' | 'intersection' | 'array' | 'generic' | 'unknown';

/**
 * Analyzer for determining accurate property counts from TypeScript types
 */
export class TypePropertyAnalyzer {
  private typeCache = new Map<string, TypePropertyInfo>();
  private _typeChecker: TypeChecker;
  
  constructor(typeChecker: TypeChecker) {
    this._typeChecker = typeChecker;
    // TypeChecker is available for future enhanced analysis
    void this._typeChecker; // Suppress unused warning
  }
  
  /**
   * Analyze a type and return accurate property information
   * OPTIMIZED: Use fast cache keys instead of expensive getText() calls
   */
  analyzeType(type: Type): TypePropertyInfo {
    const cacheKey = this.getTypeCacheKey(type);
    
    // Check cache first
    const cached = this.typeCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Perform analysis
    const result = this.performTypeAnalysis(type, cacheKey);
    
    // Cache result
    this.typeCache.set(cacheKey, result);
    
    return result;
  }
  
  /**
   * Analyze a type from a parameter string (fallback method)
   */
  analyzeTypeString(parameterType?: string): TypePropertyInfo {
    if (!parameterType) {
      return {
        propertyCount: 5,
        propertyNames: [],
        typeKind: 'unknown',
        isComplex: false,
        confidence: 'low'
      };
    }
    
    // Check cache first
    const cached = this.typeCache.get(parameterType);
    if (cached) {
      return cached;
    }
    
    // Fallback to heuristic analysis
    const result = this.performHeuristicAnalysis(parameterType);
    
    // Cache result
    this.typeCache.set(parameterType, result);
    
    return result;
  }
  
  /**
   * Clear the cache (useful for memory management)
   */
  clearCache(): void {
    this.typeCache.clear();
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate?: number } {
    return {
      size: this.typeCache.size
    };
  }
  
  private performTypeAnalysis(type: Type, typeText: string): TypePropertyInfo {
    // Handle primitive types
    if (this.isPrimitiveType(type)) {
      return {
        propertyCount: 1,
        propertyNames: [],
        typeKind: 'primitive',
        isComplex: false,
        confidence: 'high'
      };
    }
    
    // Handle arrays
    if (type.isArray()) {
      return {
        propertyCount: 3, // length, push, pop, etc.
        propertyNames: ['length'],
        typeKind: 'array',
        isComplex: false,
        confidence: 'high'
      };
    }
    
    // Handle union types
    if (type.isUnion()) {
      return this.analyzeUnionType(type);
    }
    
    // Handle intersection types
    if (type.isIntersection()) {
      return this.analyzeIntersectionType(type);
    }
    
    // Handle object/interface/class types
    if (type.isObject()) {
      return this.analyzeObjectType(type);
    }
    
    // Fallback to heuristic
    return this.performHeuristicAnalysis(typeText);
  }
  
  private analyzeObjectType(type: Type): TypePropertyInfo {
    try {
      const symbol = type.getSymbol();
      
      if (symbol) {
        const properties = this.getTypeProperties(symbol, type);
        const typeKind = this.determineObjectTypeKind(type, symbol);
        
        return {
          propertyCount: properties.length > 0 ? properties.length : 3, // Fallback estimation
          propertyNames: properties,
          typeKind,
          isComplex: properties.length > 5,
          confidence: properties.length > 0 ? 'high' : 'medium'
        };
      }
      
      // Try to get apparent properties if no symbol
      const apparentType = type.getApparentType();
      if (apparentType !== type) {
        return this.analyzeObjectType(apparentType);
      }
      
      // Fallback
      return {
        propertyCount: 3,
        propertyNames: [],
        typeKind: 'object',
        isComplex: false,
        confidence: 'medium'
      };
    } catch {
      return {
        propertyCount: 3,
        propertyNames: [],
        typeKind: 'object',
        isComplex: false,
        confidence: 'low'
      };
    }
  }
  
  private analyzeUnionType(type: Type): TypePropertyInfo {
    const unionTypes = type.getUnionTypes();
    
    if (unionTypes.length === 0) {
      return {
        propertyCount: 2,
        propertyNames: [],
        typeKind: 'union',
        isComplex: false,
        confidence: 'medium'
      };
    }
    
    // For union types, take the minimum property count to avoid over-estimation
    // (since only common properties are guaranteed to exist)
    const analyses = unionTypes.map(unionType => this.performTypeAnalysis(unionType, unionType.getText()));
    const minPropertyCount = Math.min(...analyses.map(a => a.propertyCount));
    const commonProperties = this.findCommonProperties(analyses);
    
    return {
      propertyCount: Math.max(1, minPropertyCount),
      propertyNames: commonProperties,
      typeKind: 'union',
      isComplex: analyses.some(a => a.isComplex),
      confidence: 'medium'
    };
  }
  
  private analyzeIntersectionType(type: Type): TypePropertyInfo {
    const intersectionTypes = type.getIntersectionTypes();
    
    if (intersectionTypes.length === 0) {
      return {
        propertyCount: 5,
        propertyNames: [],
        typeKind: 'intersection',
        isComplex: true,
        confidence: 'medium'
      };
    }
    
    // For intersection types, sum up all properties (they all exist)
    const analyses = intersectionTypes.map(intersectionType => 
      this.performTypeAnalysis(intersectionType, intersectionType.getText())
    );
    
    const totalPropertyCount = analyses.reduce((sum, a) => sum + a.propertyCount, 0);
    const allProperties = analyses.flatMap(a => a.propertyNames);
    const uniqueProperties = [...new Set(allProperties)];
    
    return {
      propertyCount: Math.max(totalPropertyCount, uniqueProperties.length),
      propertyNames: uniqueProperties,
      typeKind: 'intersection',
      isComplex: true,
      confidence: 'high'
    };
  }
  
  /**
   * OPTIMIZED: Use direct type API for property enumeration
   * Avoids expensive declaration tree traversal
   */
  private getTypeProperties(symbol: TsSymbol, type?: Type): string[] {
    try {
      // Priority 1: Use Type.getProperties() - fastest and most accurate
      if (type) {
        try {
          const props = type.getProperties();
          if (props.length > 0) {
            return props.map(p => p.getName()).filter(name => name && name !== '__type');
          }
        } catch {
          // Continue to fallback
        }
      }
      
      // Priority 2: Symbol exports (fast)
      try {
        const members = symbol.getExports();
        if (members.length > 0) {
          return members.map(m => m.getName()).filter(name => name && name.length > 0);
        }
      } catch {
        // Continue to fallback
      }
      
      // Priority 3: Minimal fallback
      return []; // Empty array - count will be determined by heuristics
    } catch {
      return []; // Safe empty fallback
    }
  }
  
  private determineObjectTypeKind(_type: Type, symbol: TsSymbol): TypeKind {
    try {
      const declarations = symbol.getDeclarations();
      
      for (const declaration of declarations) {
        const kindName = declaration.getKindName();
        if (kindName.includes('Interface')) {
          return 'interface';
        } else if (kindName.includes('Class')) {
          return 'class';
        } else if (kindName.includes('TypeAlias')) {
          return 'object';
        }
      }
      
      // Check if it has type arguments (generic)
      try {
        if (_type.getTypeArguments().length > 0) {
          return 'generic';
        }
      } catch {
        // Ignore
      }
      
      return 'object';
    } catch {
      return 'object';
    }
  }
  
  private findCommonProperties(analyses: TypePropertyInfo[]): string[] {
    if (analyses.length === 0) return [];
    if (analyses.length === 1) return analyses[0].propertyNames;
    
    const firstProperties = new Set(analyses[0].propertyNames);
    const common: string[] = [];
    
    for (const prop of firstProperties) {
      if (analyses.every(analysis => analysis.propertyNames.includes(prop))) {
        common.push(prop);
      }
    }
    
    return common;
  }
  
  private isPrimitiveType(type: Type): boolean {
    return type.isString() || 
           type.isNumber() || 
           type.isBoolean() || 
           type.isStringLiteral() || 
           type.isNumberLiteral() || 
           type.isBooleanLiteral() ||
           type.isNull() ||
           type.isUndefined();
  }
  
  /**
   * Get optimized cache key for type - avoids expensive getText() calls
   * OPTIMIZATION: Prioritize fast internal ID over string generation
   */
  private getTypeCacheKey(type: Type): string {
    try {
      // Priority 1: Try internal type ID (fastest - no string generation)
      const anyType = type as unknown as { compilerType?: { id?: number } };
      if (anyType.compilerType?.id != null) {
        return `id:${anyType.compilerType.id}`;
      }
    } catch {
      // Ignore - try next option
    }
    
    try {
      // Priority 2: Use Symbol FullyQualifiedName (fast and unique)
      const symbol = type.getSymbol();
      if (symbol) {
        const fqn = symbol.getFullyQualifiedName();
        if (fqn && fqn !== 'unknown') {
          return `sym:${fqn}`;
        }
      }
    } catch {
      // Ignore - try next option
    }
    
    try {
      // Priority 3: Fallback to getText (slowest but most reliable)
      return `txt:${type.getText()}`;
    } catch {
      return 'unknown';
    }
  }
  
  /**
   * Enhanced heuristic analysis for string-based types
   */
  private performHeuristicAnalysis(parameterType: string): TypePropertyInfo {
    // Remove whitespace and normalize
    const normalizedType = parameterType.trim();
    
    // Handle basic types
    const basicTypes = ['string', 'number', 'boolean', 'Date', 'RegExp'];
    if (basicTypes.some(t => normalizedType === t || normalizedType.startsWith(`${t}<`))) {
      return {
        propertyCount: 1,
        propertyNames: [],
        typeKind: 'primitive',
        isComplex: false,
        confidence: 'high'
      };
    }
    
    // Handle arrays
    if (normalizedType.endsWith('[]') || normalizedType.startsWith('Array<')) {
      return {
        propertyCount: 3,
        propertyNames: ['length'],
        typeKind: 'array',
        isComplex: false,
        confidence: 'high'
      };
    }
    
    // Handle union types
    if (normalizedType.includes('|')) {
      const unionCount = (normalizedType.match(/\|/g) || []).length + 1;
      return {
        propertyCount: Math.max(1, Math.floor(5 / unionCount)), // Conservative estimate
        propertyNames: [],
        typeKind: 'union',
        isComplex: unionCount > 2,
        confidence: 'medium'
      };
    }
    
    // Handle intersection types
    if (normalizedType.includes('&')) {
      const intersectionCount = (normalizedType.match(/&/g) || []).length + 1;
      return {
        propertyCount: intersectionCount * 4, // More properties expected
        propertyNames: [],
        typeKind: 'intersection',
        isComplex: true,
        confidence: 'medium'
      };
    }
    
    // Handle generic types
    if (normalizedType.includes('<') && normalizedType.includes('>')) {
      return {
        propertyCount: 4,
        propertyNames: [],
        typeKind: 'generic',
        isComplex: true,
        confidence: 'medium'
      };
    }
    
    // Handle object literals
    if (normalizedType.includes('{') && normalizedType.includes('}')) {
      // Count apparent properties in object literal
      const propertyMatches = normalizedType.match(/[a-zA-Z_][a-zA-Z0-9_]*\s*:/g);
      const estimatedCount = propertyMatches ? propertyMatches.length : 3;
      
      return {
        propertyCount: estimatedCount,
        propertyNames: [],
        typeKind: 'object',
        isComplex: estimatedCount > 5,
        confidence: 'medium'
      };
    }
    
    // Default for unknown object types
    return {
      propertyCount: 5,
      propertyNames: [],
      typeKind: 'unknown',
      isComplex: false,
      confidence: 'low'
    };
  }
}