import { Project, TypeChecker, SourceFile } from 'ts-morph';
import { CHAAnalyzer, ClassHierarchyNode, MethodInfo, UnresolvedMethodCall } from './cha-analyzer';
import { TypeSystemAnalyzer } from './type-system-analyzer';
import { TypeExtractionResult, TypeDefinition, TypeRelationship, TypeMember, MethodOverride } from '../types/type-system';
import { FunctionMetadata, IdealCallEdge } from './ideal-call-graph-analyzer';
import { Logger } from '../utils/cli-utils';
import { StorageAdapter } from '../types';
import { simpleHash } from '../utils/hash-utils';

/**
 * CHA-Type System Integration
 * 
 * This class integrates Class Hierarchy Analysis with the type system storage:
 * 1. Extracts comprehensive type information during CHA analysis
 * 2. Stores type information in the database
 * 3. Provides enhanced method resolution using stored type data
 * 4. Enables deletion safety analysis based on inheritance relationships
 */
export class CHATypeSystemIntegration {
  private chaAnalyzer: CHAAnalyzer;
  private typeSystemAnalyzer: TypeSystemAnalyzer;
  private logger: Logger;
  private storage?: StorageAdapter;

  constructor(project: Project, typeChecker: TypeChecker, logger: Logger = new Logger(false, false)) {
    this.logger = logger;
    this.chaAnalyzer = new CHAAnalyzer(project, typeChecker);
    this.typeSystemAnalyzer = new TypeSystemAnalyzer(project, logger);
  }

  /**
   * Set storage adapter for saving type information
   */
  setStorage(storage: StorageAdapter): void {
    this.storage = storage;
  }

  /**
   * Perform enhanced CHA analysis with type system integration
   */
  async performEnhancedCHAAnalysis(
    functions: Map<string, FunctionMetadata>,
    unresolvedEdges: UnresolvedMethodCall[],
    snapshotId: string,
    sourceFiles: SourceFile[]
  ): Promise<{
    edges: IdealCallEdge[];
    typeInfo: TypeExtractionResult;
  }> {
    this.logger.debug('Starting enhanced CHA analysis with type system integration');

    // Phase 1: Perform standard CHA analysis
    const edges = await this.chaAnalyzer.performCHAAnalysis(functions, unresolvedEdges);
    this.logger.debug(`CHA analysis produced ${edges.length} edges`);

    // Phase 2: Extract comprehensive type information
    const typeInfo = await this.typeSystemAnalyzer.extractTypeInformation(snapshotId, sourceFiles);
    this.logger.debug(`Type extraction found ${typeInfo.typeDefinitions.length} types, ${typeInfo.typeRelationships.length} relationships`);

    // Phase 3: Enhance type information with CHA data
    const enhancedTypeInfo = await this.enhanceTypeInfoWithCHA(typeInfo, snapshotId);
    this.logger.debug(`Enhanced type info with ${enhancedTypeInfo.methodOverrides.length} method overrides`);

    // Phase 4: Save type information to database
    if (this.storage) {
      await this.saveTypeInformation(enhancedTypeInfo);
      this.logger.debug('Type information saved to database');
    } else {
      this.logger.warn('No storage adapter provided - type information not saved');
    }

    return {
      edges,
      typeInfo: enhancedTypeInfo
    };
  }

  /**
   * Enhance type information with CHA analysis data
   */
  private async enhanceTypeInfoWithCHA(
    typeInfo: TypeExtractionResult,
    snapshotId: string
  ): Promise<TypeExtractionResult> {
    const inheritanceGraph = this.chaAnalyzer.getInheritanceGraph();
    // Method index available for future enhancements

    // Extract additional type members from CHA method index
    const methodIndex = this.chaAnalyzer.getMethodIndex();
    // CHA member extraction disabled to avoid duplicates with TypeSystemAnalyzer

    // Extract method overrides from CHA inheritance graph
    const methodOverrides = await this.extractMethodOverridesFromCHA(inheritanceGraph, methodIndex, snapshotId, typeInfo.typeDefinitions, typeInfo.typeMembers);
    typeInfo.methodOverrides.push(...methodOverrides);

    // Enhance type relationships with CHA class-interface mappings
    const classToInterfacesMap = this.chaAnalyzer.getClassToInterfacesMap();
    const additionalRelationships = this.extractRelationshipsFromCHA(classToInterfacesMap, snapshotId, typeInfo.typeDefinitions);
    typeInfo.typeRelationships.push(...additionalRelationships);

    return typeInfo;
  }



  /**
   * Extract method overrides from CHA inheritance graph
   */
  private async extractMethodOverridesFromCHA(
    inheritanceGraph: Map<string, ClassHierarchyNode>,
    _methodIndex: Map<string, Set<MethodInfo>>,
    snapshotId: string,
    typeDefinitions: TypeDefinition[],
    typeMembers: TypeMember[]
  ): Promise<MethodOverride[]> {
    const overrides: MethodOverride[] = [];
    const typeMap = new Map(typeDefinitions.map(t => [t.name, t]));
    
    // Create a map to find member IDs by type name and method name
    const memberMap = new Map<string, TypeMember>();
    for (const member of typeMembers) {
      if (member.memberKind === 'method') {
        const typeDef = typeDefinitions.find(t => t.id === member.typeId);
        if (typeDef) {
          const key = `${typeDef.name}:${member.name}`;
          memberMap.set(key, member);
        }
      }
    }

    for (const [className, node] of inheritanceGraph) {
      if (node.type !== 'class') continue;

      const classType = typeMap.get(className);
      if (!classType) continue;

      // Check each method for potential overrides
      for (const method of node.methods) {
        // Check parent classes for method overrides
        for (const parentName of node.parents) {
          const parentNode = inheritanceGraph.get(parentName);
          if (parentNode && parentNode.type === 'class') {
            const parentMethod = parentNode.methods.find(m => 
              m.name === method.name && 
              this.areParameterSignaturesCompatible(m.parameters, method.parameters)
            );

            if (parentMethod) {
              // Find the actual member IDs from the typeMembers
              const sourceMember = memberMap.get(`${className}:${method.name}`);
              const targetMember = memberMap.get(`${parentName}:${parentMethod.name}`);
              
              if (sourceMember && targetMember) {
                // Determine override kind based on parent method properties
                const overrideKind = parentMethod.isAbstract ? 'abstract_implement' : 'override';
                const prefix = parentMethod.isAbstract ? 'abstract_impl' : 'override';
                const confidenceScore = parentMethod.isAbstract ? 0.95 : 0.9; // Higher confidence for abstract implementations
                
                overrides.push({
                  id: `${prefix}_${simpleHash(`${sourceMember.id}_${targetMember.id}`)}`,
                  snapshotId,
                  methodMemberId: sourceMember.id,
                  sourceTypeId: classType.id,
                  targetMemberId: targetMember.id,
                  targetTypeId: typeMap.get(parentName)?.id || null,
                  overrideKind,
                  isCompatible: true, // Basic compatibility - could be enhanced with type checking
                  compatibilityErrors: [],
                  confidenceScore,
                  metadata: {
                    chaOverride: !parentMethod.isAbstract,
                    chaAbstractImplementation: parentMethod.isAbstract,
                    parentClass: parentName,
                    methodSignature: method.signature,
                    parentMethodIsAbstract: parentMethod.isAbstract
                  }
                });
              }
            }
          }
        }

        // Check implemented interfaces for method implementations
        for (const interfaceName of node.interfaces) {
          const interfaceNode = inheritanceGraph.get(interfaceName);
          if (interfaceNode && interfaceNode.type === 'interface') {
            const interfaceMethod = interfaceNode.methods.find(m => 
              m.name === method.name &&
              this.areParameterSignaturesCompatible(m.parameters, method.parameters)
            );

            if (interfaceMethod) {
              // Find the actual member IDs from the typeMembers
              const sourceMember = memberMap.get(`${className}:${method.name}`);
              const targetMember = memberMap.get(`${interfaceName}:${interfaceMethod.name}`);
              
              if (sourceMember && targetMember) {
                overrides.push({
                  id: `implement_${simpleHash(`${sourceMember.id}_${targetMember.id}`)}`,
                  snapshotId,
                  methodMemberId: sourceMember.id,
                  sourceTypeId: classType.id,
                  targetMemberId: targetMember.id,
                  targetTypeId: typeMap.get(interfaceName)?.id || null,
                  overrideKind: 'implement',
                  isCompatible: true,
                  compatibilityErrors: [],
                  confidenceScore: 0.95,
                  metadata: {
                    chaImplementation: true,
                    interface: interfaceName,
                    methodSignature: method.signature
                  }
                });
              }
            }
          }
        }
      }
    }

    return overrides;
  }

  /**
   * Extract additional type relationships from CHA class-interface mappings
   */  
  private extractRelationshipsFromCHA(
    classToInterfacesMap: Map<string, string[]>,
    snapshotId: string,
    typeDefinitions: TypeDefinition[]
  ): TypeRelationship[] {
    const relationships: TypeRelationship[] = [];
    const typeMap = new Map(typeDefinitions.map(t => [t.name, t]));

    for (const [className, interfaces] of classToInterfacesMap) {
      const classType = typeMap.get(className);
      if (!classType) continue;

      interfaces.forEach((interfaceName, index) => {
        const interfaceType = typeMap.get(interfaceName);
        
        relationships.push({
          id: `rel_${simpleHash(`${classType.id}:implements:${interfaceName}:${index}:cha`)}`,
          snapshotId,
          sourceTypeId: classType.id,
          targetTypeId: interfaceType?.id || null,
          targetName: interfaceName,
          relationshipKind: 'implements',
          position: index,
          isArray: false,
          isOptional: false,
          genericArguments: [],
          confidenceScore: interfaceType ? 1.0 : 0.8,
          metadata: {
            chaRelationship: true,
            extractedFromCHA: true
          }
        });
      });
    }

    return relationships;
  }

  /**
   * Check if parameter signatures are compatible (enhanced compatibility check)
   */
  private areParameterSignaturesCompatible(params1: string[], params2: string[]): boolean {
    // Check parameter count first
    if (params1.length !== params2.length) {
      return false;
    }
    
    // TODO: Implement proper type compatibility checking
    // For now, consider signatures with same parameter count as potentially compatible
    // This should be enhanced with actual TypeScript type compatibility rules
    this.logger.debug(`Parameter compatibility check: ${params1.join(', ')} vs ${params2.join(', ')}`);
    
    return true; // Provisional - should check actual types
  }

  /**
   * Save type information to database using transaction-based approach
   */
  private async saveTypeInformation(typeInfo: TypeExtractionResult): Promise<void> {
    if (!this.storage) {
      throw new Error('Storage adapter not set');
    }

    try {
      // Use transaction-based approach following FunctionOperations pattern
      // Define type guard
      const hasTransactionalSave = (storage: StorageAdapter): storage is StorageAdapter & {
        saveAllTypeInformation: (info: TypeExtractionResult) => Promise<void>
      } => {
        return 'saveAllTypeInformation' in storage && typeof storage.saveAllTypeInformation === 'function';
      };
      
      if (hasTransactionalSave(this.storage)) {
        await this.storage.saveAllTypeInformation(typeInfo);
      } else {
        // Fallback to individual saves with transactions
        await this.storage.saveTypeDefinitions(typeInfo.typeDefinitions);
        await this.storage.saveTypeRelationships(typeInfo.typeRelationships);
        await this.storage.saveTypeMembers(typeInfo.typeMembers);
        await this.storage.saveMethodOverrides(typeInfo.methodOverrides);
      }
    } catch (error) {
      this.logger.error('❌ Failed to save type information to database:', error);
      throw error;
    }
  }


  /**
   * Get type information for deletion safety analysis
   */
  async getMethodImplementationInfo(functionId: string, _snapshotId: string): Promise<{
    isInterfaceImplementation: boolean;
    isMethodOverride: boolean;
    implementedInterfaces: string[];
    overriddenMethods: string[];
  }> {
    if (!this.storage) {
      return {
        isInterfaceImplementation: false,
        isMethodOverride: false,
        implementedInterfaces: [],
        overriddenMethods: []
      };
    }

    try {
      // Get method overrides for this function
      const overrides = await this.storage.getMethodOverridesByFunction(functionId);
      
      const implementedInterfaces: string[] = [];
      const overriddenMethods: string[] = [];
      
      for (const override of overrides) {
        if (override.overrideKind === 'implement' || override.overrideKind === 'signature_implement') {
          implementedInterfaces.push(override.targetTypeId || 'unknown');
        } else if (override.overrideKind === 'override') {
          overriddenMethods.push(override.targetMemberId || 'unknown');
        }
      }

      return {
        isInterfaceImplementation: implementedInterfaces.length > 0,
        isMethodOverride: overriddenMethods.length > 0,
        implementedInterfaces,
        overriddenMethods
      };
    } catch (error) {
      this.logger.error('Failed to get method implementation info:', error);
      return {
        isInterfaceImplementation: false,
        isMethodOverride: false,
        implementedInterfaces: [],
        overriddenMethods: []
      };
    }
  }

  /**
   * Clear internal state
   */
  clear(): void {
    this.chaAnalyzer.clear();
  }
}