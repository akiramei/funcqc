import { FunctionInfo } from '../types';
import { Logger } from '../utils/cli-utils';
import { StorageAdapter } from '../types';
import { MethodOverride, TypeMember } from '../types/type-system';

/**
 * Signature compatibility analysis result
 */
export interface SignatureCompatibility {
  isCompatible: boolean;
  compatibilityScore: number; // 0.0 to 1.0
  issues: string[];
  parameterCount: number;
  returnTypeMatch: boolean;
  parameterTypesMatch: boolean;
}

/**
 * Type-aware deletion safety information
 */
export interface TypeAwareDeletionInfo {
  isInterfaceImplementation: boolean;
  isMethodOverride: boolean;
  implementedInterfaces: string[];
  overriddenMethods: string[];
  implementingClasses: string[];
  confidenceScore: number;
  protectionReason: string | null;
  signatureCompatibility?: SignatureCompatibility;
  evidenceStrength: {
    interfaceCount: number;
    classCount: number;
    inheritanceDepth: number;
    overrideCount: number;
    abstractImplementationCount: number;
  };
}

/**
 * Type-Aware Deletion Safety Analyzer
 * 
 * Uses stored type information to determine if a function is safe to delete
 * by checking interface implementations and method overrides.
 */
export class TypeAwareDeletionSafety {
  private logger: Logger;
  private storage?: StorageAdapter;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger(false, false);
  }

  /**
   * Set storage adapter for accessing type information
   */
  setStorage(storage: StorageAdapter): void {
    this.storage = storage;
  }

  /**
   * Analyze deletion safety using type information
   */
  async analyzeDeletionSafety(
    func: FunctionInfo,
    snapshotId: string
  ): Promise<TypeAwareDeletionInfo> {
    if (!this.storage) {
      return this.createDefaultSafetyInfo('No storage adapter available');
    }

    try {
      // Get method override information for this function
      const methodOverrides = await this.getMethodOverridesForFunction(func.id, snapshotId);
      
      // Analyze interface implementations
      const interfaceInfo = await this.analyzeInterfaceImplementations(methodOverrides, snapshotId, func);
      
      // Analyze method overrides
      const overrideInfo = await this.analyzeMethodOverrides(methodOverrides, snapshotId);
      
      // Calculate evidence strength
      const evidenceStrength = this.calculateEvidenceStrength(interfaceInfo, overrideInfo);
      
      // Determine protection level using dynamic scoring
      const protectionInfo = this.determineProtectionLevel(interfaceInfo, overrideInfo, evidenceStrength);
      
      return {
        isInterfaceImplementation: interfaceInfo.isImplementation,
        isMethodOverride: overrideInfo.isOverride,
        implementedInterfaces: interfaceInfo.interfaces,
        overriddenMethods: overrideInfo.methods,
        implementingClasses: interfaceInfo.implementingClasses,
        confidenceScore: protectionInfo.confidenceScore,
        protectionReason: protectionInfo.reason,
        ...(interfaceInfo.signatureCompatibility ? { signatureCompatibility: interfaceInfo.signatureCompatibility } : {}),
        evidenceStrength
      };
    } catch (error) {
      this.logger.error(`Failed to analyze type-aware deletion safety for ${func.name}:`, error);
      return this.createDefaultSafetyInfo('Type analysis failed');
    }
  }

  /**
   * Analyze signature compatibility between implementation and interface/parent method
   */
  private async analyzeSignatureCompatibility(
    functionInfo: FunctionInfo,
    methodOverride: MethodOverride,
    snapshotId: string
  ): Promise<SignatureCompatibility> {
    try {
      // Get the target interface/parent method signature
      const targetMember = await this.getTargetMethodSignature(methodOverride, snapshotId);
      if (!targetMember) {
        return {
          isCompatible: false,
          compatibilityScore: 0.0,
          issues: ['Target method signature not found'],
          parameterCount: 0,
          returnTypeMatch: false,
          parameterTypesMatch: false
        };
      }

      // Analyze compatibility
      const issues: string[] = [];
      let compatibilityScore = 1.0;

      // Check parameter count compatibility
      const implParamCount = this.extractParameterCount(functionInfo);
      const targetParamCount = this.extractParameterCountFromSignature(targetMember.typeText || '');
      const parameterCountMatch = this.checkParameterCountCompatibility(implParamCount, targetParamCount);
      
      if (!parameterCountMatch.isCompatible) {
        issues.push(`Parameter count mismatch: implementation has ${implParamCount}, interface expects ${targetParamCount}`);
        compatibilityScore *= 0.7; // Reduce score for parameter count mismatch
      }

      // Check parameter types compatibility (simplified analysis)
      const parameterTypesMatch = await this.checkParameterTypesCompatibility(
        functionInfo,
        targetMember
      );
      
      if (!parameterTypesMatch.isCompatible) {
        issues.push(...parameterTypesMatch.issues);
        compatibilityScore *= parameterTypesMatch.penalty;
      }

      // Check return type compatibility
      const returnTypeMatch = await this.checkReturnTypeCompatibility(
        functionInfo,
        targetMember
      );
      
      if (!returnTypeMatch.isCompatible) {
        issues.push(...returnTypeMatch.issues);
        compatibilityScore *= returnTypeMatch.penalty;
      }

      const isCompatible = issues.length === 0 || compatibilityScore >= 0.7;

      return {
        isCompatible,
        compatibilityScore,
        issues,
        parameterCount: implParamCount,
        returnTypeMatch: returnTypeMatch.isCompatible,
        parameterTypesMatch: parameterTypesMatch.isCompatible
      };
    } catch (error) {
      this.logger.debug(`Signature compatibility analysis failed: ${error}`);
      return {
        isCompatible: false,
        compatibilityScore: 0.5, // Neutral score when analysis fails
        issues: ['Signature analysis failed'],
        parameterCount: 0,
        returnTypeMatch: false,
        parameterTypesMatch: false
      };
    }
  }

  /**
   * Get target method signature from database
   */
  private async getTargetMethodSignature(
    methodOverride: MethodOverride,
    snapshotId: string
  ): Promise<TypeMember | null> {
    if (!this.storage || !('getTypeMembers' in this.storage)) {
      return null;
    }

    try {
      const targetTypeId = methodOverride.targetTypeId;
      if (!targetTypeId) {
        return null;
      }

      // Get all members of the target type
      const members = await (this.storage as { getTypeMembers: (typeId: string) => Promise<TypeMember[]> }).getTypeMembers(targetTypeId);
      
      // Find the specific method member
      const targetMember = members.find((member: TypeMember) => 
        member.id === methodOverride.targetMemberId && 
        member.snapshotId === snapshotId
      );

      return targetMember || null;
    } catch (error) {
      this.logger.debug(`Failed to get target method signature: ${error}`);
      return null;
    }
  }

  /**
   * Extract parameter count from function info
   */
  private extractParameterCount(functionInfo: FunctionInfo): number {
    // Use parameters array if available
    if (functionInfo.parameters && Array.isArray(functionInfo.parameters)) {
      return functionInfo.parameters.length;
    }

    // Fallback: parse from signature if available
    if (functionInfo.signature) {
      return this.extractParameterCountFromSignature(functionInfo.signature);
    }

    // Default fallback
    return 0;
  }

  /**
   * Extract parameter count from type signature string
   */
  private extractParameterCountFromSignature(signature: string): number {
    try {
      // Simple regex to count parameters in function signature
      // Matches: (param1: type, param2: type) => returnType
      const match = signature.match(/\(([^)]*)\)/);
      if (!match || !match[1]) {
        return 0;
      }

      const params = match[1].trim();
      if (params === '') {
        return 0;
      }

      // Count parameters by splitting on comma (simplified approach)
      // This doesn't handle complex nested types perfectly, but works for most cases
      return params.split(',').length;
    } catch {
      this.logger.debug(`Failed to parse parameter count from signature: ${signature}`);
      return 0;
    }
  }

  /**
   * Check parameter count compatibility
   */
  private checkParameterCountCompatibility(
    implCount: number,
    targetCount: number
  ): { isCompatible: boolean; penalty: number } {
    if (implCount === targetCount) {
      return { isCompatible: true, penalty: 1.0 };
    }

    // Allow implementation to have fewer parameters (optional parameters)
    if (implCount < targetCount) {
      const diff = targetCount - implCount;
      return {
        isCompatible: diff <= 2, // Allow up to 2 optional parameters
        penalty: Math.max(0.8, 1.0 - diff * 0.1)
      };
    }

    // Implementation has more parameters than interface (less compatible)
    const diff = implCount - targetCount;
    return {
      isCompatible: diff <= 1, // Allow 1 extra parameter
      penalty: Math.max(0.6, 1.0 - diff * 0.2)
    };
  }

  /**
   * Check parameter types compatibility (simplified)
   */
  private async checkParameterTypesCompatibility(
    functionInfo: FunctionInfo,
    targetMember: TypeMember
  ): Promise<{ isCompatible: boolean; issues: string[]; penalty: number }> {
    // This is a simplified implementation
    // In a full implementation, you would parse TypeScript signatures and check type compatibility
    
    const issues: string[] = [];
    let penalty = 1.0;

    // Basic checks based on available information
    if (functionInfo.signature && targetMember.typeText) {
      // Simple heuristic: if both signatures contain similar type keywords
      const implTypes = this.extractTypeKeywords(functionInfo.signature);
      const targetTypes = this.extractTypeKeywords(targetMember.typeText);
      
      const commonTypes = implTypes.filter(type => targetTypes.includes(type));
      const compatibilityRatio = commonTypes.length / Math.max(targetTypes.length, 1);
      
      if (compatibilityRatio < 0.5) {
        issues.push('Parameter types appear incompatible based on signature analysis');
        penalty = 0.8;
      }
    }

    return {
      isCompatible: issues.length === 0,
      issues,
      penalty
    };
  }

  /**
   * Check return type compatibility (simplified)
   */
  private async checkReturnTypeCompatibility(
    functionInfo: FunctionInfo,
    targetMember: TypeMember
  ): Promise<{ isCompatible: boolean; issues: string[]; penalty: number }> {
    const issues: string[] = [];
    let penalty = 1.0;

    // Basic return type checking
    if (functionInfo.signature && targetMember.typeText) {
      const implReturnType = this.extractReturnType(functionInfo.signature);
      const targetReturnType = this.extractReturnType(targetMember.typeText);
      
      if (implReturnType && targetReturnType && implReturnType !== targetReturnType) {
        // Allow some common compatible return types
        const compatibleReturns = this.areReturnTypesCompatible(implReturnType, targetReturnType);
        if (!compatibleReturns) {
          issues.push(`Return type mismatch: implementation returns '${implReturnType}', interface expects '${targetReturnType}'`);
          penalty = 0.9;
        }
      }
    }

    return {
      isCompatible: issues.length === 0,
      issues,
      penalty
    };
  }

  /**
   * Extract type keywords from signature for basic compatibility checking
   */
  private extractTypeKeywords(signature: string): string[] {
    const typeKeywords = signature.match(/\b(string|number|boolean|object|void|any|unknown)\b/g) || [];
    return [...new Set(typeKeywords)]; // Remove duplicates
  }

  /**
   * Extract return type from function signature
   */
  private extractReturnType(signature: string): string | null {
    const match = signature.match(/=>\s*([^{;]+)/);
    return match ? match[1].trim() : null;
  }

  /**
   * Check if return types are compatible
   */
  private areReturnTypesCompatible(implType: string, targetType: string): boolean {
    // Exact match
    if (implType === targetType) {
      return true;
    }

    // Common compatible patterns
    const compatiblePairs = [
      ['void', 'undefined'],
      ['any', targetType], // any is compatible with anything
      [implType, 'any'],
      ['unknown', targetType], // unknown can be assigned to anything with type assertion
    ];

    return compatiblePairs.some(([from, to]) => implType === from && targetType === to);
  }

  /**
   * Get method overrides for a specific function
   */
  private async getMethodOverridesForFunction(
    functionId: string,
    snapshotId: string
  ): Promise<MethodOverride[]> {
    try {
      if (!this.storage || !('getMethodOverridesByFunction' in this.storage)) {
        return [];
      }

      // Get method overrides directly for this function
      const overrides = await (this.storage as { getMethodOverridesByFunction: (id: string) => Promise<MethodOverride[]> }).getMethodOverridesByFunction(functionId);
      
      // Filter by snapshot ID if available
      return overrides.filter((override: MethodOverride) => override.snapshotId === snapshotId);
    } catch (error) {
      this.logger.debug(`No method overrides found for function ${functionId}: ${error}`);
      return [];
    }
  }

  /**
   * Analyze interface implementations with signature compatibility
   */
  private async analyzeInterfaceImplementations(
    methodOverrides: MethodOverride[],
    snapshotId: string,
    functionInfo: FunctionInfo
  ): Promise<{
    isImplementation: boolean;
    interfaces: string[];
    implementingClasses: string[];
    compatibilityScore: number;
    signatureCompatibility?: SignatureCompatibility;
  }> {
    const interfaces: string[] = [];
    const implementingClasses: string[] = [];
    let bestCompatibilityScore = 0;
    let bestSignatureCompatibility: SignatureCompatibility | undefined;

    for (const override of methodOverrides) {
      if (override.overrideKind === 'implement' || override.overrideKind === 'signature_implement') {
        // This function implements an interface method
        if (override.targetTypeId) {
          interfaces.push(override.targetTypeId);
          
          // Analyze signature compatibility
          try {
            const compatibility = await this.analyzeSignatureCompatibility(
              functionInfo,
              override,
              snapshotId
            );
            
            if (compatibility.compatibilityScore > bestCompatibilityScore) {
              bestCompatibilityScore = compatibility.compatibilityScore;
              bestSignatureCompatibility = compatibility;
            }
          } catch (error) {
            this.logger.debug(`Failed to analyze signature compatibility: ${error}`);
          }
          
          // Find classes that also implement this interface
          try {
            if (this.storage && 'getImplementingClasses' in this.storage) {
              const classes = await (this.storage as { getImplementingClasses: (typeId: string) => Promise<{ name: string }[]> }).getImplementingClasses(override.targetTypeId);
              implementingClasses.push(...classes.map((cls: { name: string }) => cls.name));
            }
          } catch (error) {
            this.logger.debug(`Failed to get implementing classes: ${error}`);
          }
        }
      }
    }

    return {
      isImplementation: interfaces.length > 0,
      interfaces: [...new Set(interfaces)], // Remove duplicates
      implementingClasses: [...new Set(implementingClasses)],
      compatibilityScore: bestCompatibilityScore,
      ...(bestSignatureCompatibility ? { signatureCompatibility: bestSignatureCompatibility } : {})
    };
  }

  /**
   * Analyze method overrides including abstract implementations
   */
  private async analyzeMethodOverrides(
    methodOverrides: MethodOverride[],
    _snapshotId: string
  ): Promise<{
    isOverride: boolean;
    methods: string[];
    isAbstractImplementation: boolean;
    abstractMethods: string[];
  }> {
    const methods: string[] = [];
    const abstractMethods: string[] = [];

    for (const override of methodOverrides) {
      if (override.overrideKind === 'override') {
        // This function overrides a parent class method
        if (override.targetMemberId) {
          methods.push(override.targetMemberId);
        }
      } else if (override.overrideKind === 'abstract_implement') {
        // This function implements an abstract method from parent class
        if (override.targetMemberId) {
          abstractMethods.push(override.targetMemberId);
        }
      }
    }

    return {
      isOverride: methods.length > 0,
      methods: [...new Set(methods)], // Remove duplicates
      isAbstractImplementation: abstractMethods.length > 0,
      abstractMethods: [...new Set(abstractMethods)]
    };
  }

  /**
   * Calculate evidence strength for dynamic scoring
   */
  private calculateEvidenceStrength(
    interfaceInfo: { interfaces: string[]; implementingClasses: string[]; compatibilityScore?: number },
    overrideInfo: { methods: string[]; abstractMethods?: string[] }
  ): {
    interfaceCount: number;
    classCount: number;
    inheritanceDepth: number;
    overrideCount: number;
    abstractImplementationCount: number;
  } {
    return {
      interfaceCount: interfaceInfo.interfaces.length,
      classCount: interfaceInfo.implementingClasses.length,
      inheritanceDepth: Math.min(interfaceInfo.interfaces.length, 3), // Cap at 3 for scoring
      overrideCount: overrideInfo.methods.length,
      abstractImplementationCount: overrideInfo.abstractMethods?.length || 0
    };
  }

  /**
   * Determine protection level using dynamic scoring based on evidence strength
   */
  private determineProtectionLevel(
    interfaceInfo: { 
      isImplementation: boolean; 
      interfaces: string[]; 
      implementingClasses: string[];
      compatibilityScore?: number;
      signatureCompatibility?: SignatureCompatibility;
    },
    overrideInfo: { 
      isOverride: boolean; 
      methods: string[];
      isAbstractImplementation?: boolean;
      abstractMethods?: string[];
    },
    evidenceStrength: {
      interfaceCount: number;
      classCount: number;
      inheritanceDepth: number;
      overrideCount: number;
      abstractImplementationCount: number;
    }
  ): { confidenceScore: number; reason: string | null } {
    // Abstract method implementations with dynamic scoring (HIGHEST priority)
    if (overrideInfo.isAbstractImplementation) {
      const baseScore = 0.80; // Base score for abstract method implementation
      let multiplier = 1.0;
      
      // Bonus for multiple abstract implementations
      if (evidenceStrength.abstractImplementationCount > 1) {
        multiplier += Math.min(evidenceStrength.abstractImplementationCount * 0.05, 0.2); // Up to +0.2 bonus
      }
      
      // Bonus for signature compatibility if available
      if (interfaceInfo.compatibilityScore) {
        multiplier += (interfaceInfo.compatibilityScore - 0.5) * 0.4; // Up to +0.2 bonus
      }
      
      const finalScore = Math.min(baseScore * multiplier, 0.95); // Cap at 0.95
      
      return {
        confidenceScore: finalScore,
        reason: `Implements ${evidenceStrength.abstractImplementationCount} abstract base method(s)`
      };
    }

    // Interface implementations with dynamic scoring
    if (interfaceInfo.isImplementation) {
      const baseScore = 0.80; // Base score for interface implementation
      let multiplier = 1.0;
      
      // Bonus for signature compatibility
      if (interfaceInfo.compatibilityScore) {
        multiplier += (interfaceInfo.compatibilityScore - 0.5) * 0.4; // Up to +0.2 bonus
      }
      
      // Bonus for multiple implementing classes (indicates important interface)
      if (evidenceStrength.classCount > 1) {
        multiplier += Math.min(evidenceStrength.classCount * 0.05, 0.15); // Up to +0.15 bonus
      }
      
      // Bonus for multiple interfaces (indicates complex type hierarchy)
      if (evidenceStrength.interfaceCount > 1) {
        multiplier += Math.min(evidenceStrength.interfaceCount * 0.03, 0.1); // Up to +0.1 bonus
      }
      
      const finalScore = Math.min(baseScore * multiplier, 0.98); // Cap at 0.98
      
      let reason = `Implements ${evidenceStrength.interfaceCount} interface(s)`;
      if (evidenceStrength.classCount > 0) {
        reason += `, shared by ${evidenceStrength.classCount} class(es)`;
      }
      if (interfaceInfo.signatureCompatibility && !interfaceInfo.signatureCompatibility.isCompatible) {
        reason += ` (signature compatibility issues: ${interfaceInfo.signatureCompatibility.issues.join(', ')})`;
      }
      
      return {
        confidenceScore: finalScore,
        reason
      };
    }


    // Method overrides with dynamic scoring
    if (overrideInfo.isOverride) {
      const baseScore = 0.70; // Base score for method override
      let multiplier = 1.0;
      
      // Bonus for multiple method overrides
      if (evidenceStrength.overrideCount > 1) {
        multiplier += Math.min(evidenceStrength.overrideCount * 0.05, 0.2); // Up to +0.2 bonus
      }
      
      const finalScore = Math.min(baseScore * multiplier, 0.90); // Cap at 0.90
      
      return {
        confidenceScore: finalScore,
        reason: `Overrides ${evidenceStrength.overrideCount} parent method(s)`
      };
    }

    // No type-based protection found
    return {
      confidenceScore: 0.0,
      reason: null
    };
  }

  /**
   * Create default safety info when analysis fails
   */
  private createDefaultSafetyInfo(reason: string): TypeAwareDeletionInfo {
    return {
      isInterfaceImplementation: false,
      isMethodOverride: false,
      implementedInterfaces: [],
      overriddenMethods: [],
      implementingClasses: [],
      confidenceScore: 0.0,
      protectionReason: reason,
      evidenceStrength: {
        interfaceCount: 0,
        classCount: 0,
        inheritanceDepth: 0,
        overrideCount: 0,
        abstractImplementationCount: 0
      }
    };
  }

  /**
   * Check if a function should be protected from deletion based on type information
   */
  async shouldProtectFromDeletion(
    func: FunctionInfo,
    snapshotId: string,
    minConfidenceThreshold: number = 0.7
  ): Promise<boolean> {
    const safetyInfo = await this.analyzeDeletionSafety(func, snapshotId);
    
    // Protect if confidence score exceeds threshold
    if (safetyInfo.confidenceScore >= minConfidenceThreshold) {
      this.logger.debug(
        `Function ${func.name} protected from deletion: ${safetyInfo.protectionReason} ` +
        `(confidence: ${safetyInfo.confidenceScore})`
      );
      return true;
    }

    return false;
  }

  /**
   * Get detailed protection reason for a function
   */
  async getProtectionReason(
    func: FunctionInfo,
    snapshotId: string
  ): Promise<string | null> {
    const safetyInfo = await this.analyzeDeletionSafety(func, snapshotId);
    return safetyInfo.protectionReason;
  }
}