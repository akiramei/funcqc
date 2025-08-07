import {
  Project,
  Node,
  InterfaceDeclaration,
  ClassDeclaration,
  TypeNode
} from 'ts-morph';
import { TypeDefinition } from './type-analyzer';

/**
 * Chidamber & Kemerer (CK) metrics for object-oriented design quality assessment
 * 
 * This module implements the classic CK metrics suite as suggested by the mathematical expert:
 * - DIT (Depth of Inheritance Tree): Measures inheritance depth
 * - NOC (Number of Children): Measures number of direct subclasses
 * - LCOM (Lack of Cohesion of Methods): Measures method cohesion
 * - WMC (Weighted Methods per Class): Measures class complexity
 * - RFC (Response For a Class): Measures coupling through method calls
 * - CBO (Coupling Between Objects): Measures object coupling
 */

export interface CKMetrics {
  DIT: number;    // Depth of Inheritance Tree
  NOC: number;    // Number of Children  
  LCOM: number;   // Lack of Cohesion of Methods
  WMC: number;    // Weighted Methods per Class
  RFC: number;    // Response For a Class
  CBO: number;    // Coupling Between Objects
}

export interface InheritanceInfo {
  parentClass: string | null;
  childClasses: string[];
  implementedInterfaces: string[];
  extendedInterfaces: string[];
}

/**
 * CK Metrics calculator for TypeScript types
 */
export class CKMetricsCalculator {
  private project: Project;
  private inheritanceMap: Map<string, InheritanceInfo>;
  private typeDefinitions: Map<string, TypeDefinition>;

  constructor(project: Project) {
    this.project = project;
    this.inheritanceMap = new Map();
    this.typeDefinitions = new Map();
  }

  /**
   * Set type definitions context for CK metrics calculation
   */
  setTypeDefinitions(types: TypeDefinition[]): void {
    this.typeDefinitions.clear();
    this.inheritanceMap.clear();
    
    // Build type definitions map
    for (const type of types) {
      this.typeDefinitions.set(type.name, type);
    }
    
    // Build inheritance map
    this.buildInheritanceMap();
  }

  /**
   * Calculate CK metrics for a given type
   */
  calculateCKMetrics(typeName: string): CKMetrics {
    const typeDefinition = this.typeDefinitions.get(typeName);
    if (!typeDefinition) {
      return this.getDefaultCKMetrics();
    }

    const sourceFile = this.project.getSourceFile(typeDefinition.filePath);
    if (!sourceFile) {
      return this.getDefaultCKMetrics();
    }

    // Find the AST node
    const node = this.findTypeNode(sourceFile, typeDefinition);
    if (!node) {
      return this.getDefaultCKMetrics();
    }

    switch (typeDefinition.kind) {
      case 'class':
        return this.calculateClassCKMetrics(node as ClassDeclaration, typeName);
      case 'interface':
        return this.calculateInterfaceCKMetrics(node as InterfaceDeclaration, typeName);
      default:
        return this.getDefaultCKMetrics();
    }
  }

  /**
   * Calculate CK metrics for class declarations
   */
  private calculateClassCKMetrics(classDecl: ClassDeclaration, className: string): CKMetrics {
    const inheritanceInfo = this.inheritanceMap.get(className) || this.getDefaultInheritanceInfo();
    
    // DIT: Depth of Inheritance Tree
    const DIT = this.calculateDIT(className);
    
    // NOC: Number of Children (direct subclasses)
    const NOC = inheritanceInfo.childClasses.length;
    
    // WMC: Weighted Methods per Class (sum of cyclomatic complexities)
    const WMC = this.calculateWMC(classDecl);
    
    // LCOM: Lack of Cohesion of Methods
    const LCOM = this.calculateLCOM(classDecl);
    
    // RFC: Response For a Class (number of methods + number of remote methods called)
    const RFC = this.calculateRFC(classDecl);
    
    // CBO: Coupling Between Objects
    const CBO = this.calculateCBO(classDecl);

    return { DIT, NOC, LCOM, WMC, RFC, CBO };
  }

  /**
   * Calculate CK metrics for interface declarations (adapted for TypeScript)
   */
  private calculateInterfaceCKMetrics(interfaceDecl: InterfaceDeclaration, interfaceName: string): CKMetrics {
    const inheritanceInfo = this.inheritanceMap.get(interfaceName) || this.getDefaultInheritanceInfo();
    
    // DIT: For interfaces, measure extension depth
    const DIT = this.calculateInterfaceDIT(interfaceName);
    
    // NOC: Number of extending interfaces or implementing classes
    const NOC = inheritanceInfo.childClasses.length;
    
    // WMC: For interfaces, count method signatures
    const WMC = interfaceDecl.getMethods().length;
    
    // LCOM: Not directly applicable to interfaces (methods don't have implementation)
    const LCOM = 0;
    
    // RFC: Number of methods declared in interface
    const RFC = interfaceDecl.getMethods().length;
    
    // CBO: Count referenced types in method signatures
    const CBO = this.calculateInterfaceCBO(interfaceDecl);

    return { DIT, NOC, LCOM, WMC, RFC, CBO };
  }

  /**
   * Calculate Depth of Inheritance Tree for classes
   */
  private calculateDIT(className: string): number {
    let depth = 0;
    let currentClass = className;
    const visited = new Set<string>();
    
    while (currentClass && !visited.has(currentClass)) {
      visited.add(currentClass);
      const inheritanceInfo = this.inheritanceMap.get(currentClass);
      
      if (inheritanceInfo?.parentClass) {
        depth++;
        currentClass = inheritanceInfo.parentClass;
      } else {
        break;
      }
      
      // Prevent infinite loops
      if (depth > 20) break;
    }
    
    return depth;
  }

  /**
   * Calculate Depth of Inheritance Tree for interfaces
   */
  private calculateInterfaceDIT(interfaceName: string): number {
    let depth = 0;
    let currentLevel = [interfaceName];
    const visited = new Set<string>();
    
    while (currentLevel.length > 0 && depth < 20) {
      const nextLevel: string[] = [];
      
      for (const currentInterface of currentLevel) {
        if (visited.has(currentInterface)) continue;
        visited.add(currentInterface);
        
        const inheritanceInfo = this.inheritanceMap.get(currentInterface);
        if (inheritanceInfo?.extendedInterfaces.length) {
          nextLevel.push(...inheritanceInfo.extendedInterfaces);
        }
      }
      
      if (nextLevel.length > 0) {
        depth++;
        currentLevel = nextLevel;
      } else {
        break;
      }
    }
    
    return depth;
  }

  /**
   * Calculate Weighted Methods per Class using complexity-based weighting
   */
  private calculateWMC(classDecl: ClassDeclaration): number {
    const methods = classDecl.getMethods();
    let totalWeight = 0;
    
    for (const method of methods) {
      // Calculate complexity-based weight for each method
      const methodWeight = this.calculateMethodComplexity(method);
      totalWeight += methodWeight;
    }
    
    return totalWeight;
  }

  /**
   * Calculate complexity weight for a single method using AST analysis
   */
  private calculateMethodComplexity(method: any): number { // eslint-disable-line @typescript-eslint/no-explicit-any
    let complexity = 1; // Base complexity
    
    // Count decision points using AST traversal
    method.forEachDescendant((node: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      // Conditional statements add complexity
      if (Node.isIfStatement(node) || 
          Node.isConditionalExpression(node) ||
          Node.isSwitchStatement(node)) {
        complexity++;
      }
      
      // Loops add complexity  
      else if (Node.isForStatement(node) ||
               Node.isForInStatement(node) ||
               Node.isForOfStatement(node) ||
               Node.isWhileStatement(node) ||
               Node.isDoStatement(node)) {
        complexity++;
      }
      
      // Try-catch blocks add complexity
      else if (Node.isTryStatement(node)) {
        complexity++;
      }
      
      // Logical operators add complexity
      else if (Node.isBinaryExpression(node)) {
        const operatorToken = node.getOperatorToken();
        const operator = operatorToken.getText();
        if (operator === '&&' || operator === '||') {
          complexity++;
        }
      }
    });
    
    return complexity;
  }

  /**
   * Calculate Lack of Cohesion of Methods (simplified LCOM1)
   */
  private calculateLCOM(classDecl: ClassDeclaration): number {
    const methods = classDecl.getMethods();
    const properties = classDecl.getProperties();
    
    if (methods.length <= 1 || properties.length === 0) {
      return 0;
    }

    // Build property usage map for each method using AST analysis
    const propertyUsage = new Map<string, Set<string>>();
    const propertyNames = properties.map(p => p.getName()).filter(name => name);

    for (const method of methods) {
      const methodName = method.getName();
      const usedProperties = new Set<string>();
      
      // AST-based property usage detection
      method.forEachDescendant(node => {
        if (Node.isPropertyAccessExpression(node)) {
          const propName = node.getName();
          if (propertyNames.includes(propName)) {
            // Check if it's a this.property access
            const expression = node.getExpression();
            if (Node.isThisExpression(expression)) {
              usedProperties.add(propName);
            }
          }
        }
      });
      
      propertyUsage.set(methodName, usedProperties);
    }

    // Optimized LCOM1 calculation using bitset approach
    const methodNames = Array.from(propertyUsage.keys());
    
    // Create property index mapping for bitset operations
    const propertyIndexMap = new Map<string, number>();
    propertyNames.forEach((prop, index) => propertyIndexMap.set(prop, index));
    
    // Convert property usage to bitsets for efficient operations
    const methodBitsets = new Map<string, number>();
    for (const [methodName, usedProps] of propertyUsage) {
      let bitset = 0;
      for (const prop of usedProps) {
        const propIndex = propertyIndexMap.get(prop);
        if (propIndex !== undefined) {
          bitset |= (1 << propIndex);
        }
      }
      methodBitsets.set(methodName, bitset);
    }
    
    // Calculate sharing pairs using bitwise operations
    let sharingPairs = 0;
    let nonSharingPairs = 0;
    
    for (let i = 0; i < methodNames.length; i++) {
      for (let j = i + 1; j < methodNames.length; j++) {
        const bitset1 = methodBitsets.get(methodNames[i]) || 0;
        const bitset2 = methodBitsets.get(methodNames[j]) || 0;
        
        // Check if methods share any properties using bitwise AND
        const hasSharedProperty = (bitset1 & bitset2) !== 0;
        
        if (hasSharedProperty) {
          sharingPairs++;
        } else {
          nonSharingPairs++;
        }
      }
    }

    return Math.max(0, nonSharingPairs - sharingPairs);
  }

  /**
   * Calculate Response For a Class
   */
  private calculateRFC(classDecl: ClassDeclaration): number {
    const methods = classDecl.getMethods();
    let responseSet = methods.length; // Local methods
    
    // Count method calls using AST analysis
    for (const method of methods) {
      let methodCallCount = 0;
      
      // Traverse AST to find actual method call expressions
      method.forEachDescendant(node => {
        if (Node.isCallExpression(node)) {
          methodCallCount++;
        }
      });
      
      responseSet += methodCallCount;
    }
    
    return responseSet;
  }

  /**
   * Calculate Coupling Between Objects for classes
   */
  private calculateCBO(classDecl: ClassDeclaration): number {
    const coupledTypes = new Set<string>();
    
    // Check extends clause
    const extendsClause = classDecl.getExtends();
    if (extendsClause) {
      coupledTypes.add(extendsClause.getExpression().getText());
    }
    
    // Check implements clause
    const implementsClauses = classDecl.getImplements();
    for (const impl of implementsClauses) {
      coupledTypes.add(impl.getExpression().getText());
    }
    
    // Check property types
    const properties = classDecl.getProperties();
    for (const prop of properties) {
      const typeNode = prop.getTypeNode();
      if (typeNode) {
        this.extractTypeNames(typeNode).forEach(typeName => coupledTypes.add(typeName));
      }
    }
    
    // Check method parameter and return types
    const methods = classDecl.getMethods();
    for (const method of methods) {
      // Parameter types
      for (const param of method.getParameters()) {
        const typeNode = param.getTypeNode();
        if (typeNode) {
          this.extractTypeNames(typeNode).forEach(typeName => coupledTypes.add(typeName));
        }
      }
      
      // Return type
      const returnType = method.getReturnTypeNode();
      if (returnType) {
        this.extractTypeNames(returnType).forEach(typeName => coupledTypes.add(typeName));
      }
    }
    
    return coupledTypes.size;
  }

  /**
   * Calculate Coupling Between Objects for interfaces
   */
  private calculateInterfaceCBO(interfaceDecl: InterfaceDeclaration): number {
    const coupledTypes = new Set<string>();
    
    // Check extends clause
    const extendsClauses = interfaceDecl.getExtends();
    for (const ext of extendsClauses) {
      coupledTypes.add(ext.getExpression().getText());
    }
    
    // Check property types
    const properties = interfaceDecl.getProperties();
    for (const prop of properties) {
      const typeNode = prop.getTypeNode();
      if (typeNode) {
        this.extractTypeNames(typeNode).forEach(typeName => coupledTypes.add(typeName));
      }
    }
    
    // Check method signatures
    const methods = interfaceDecl.getMethods();
    for (const method of methods) {
      // Parameter types
      for (const param of method.getParameters()) {
        const typeNode = param.getTypeNode();
        if (typeNode) {
          this.extractTypeNames(typeNode).forEach(typeName => coupledTypes.add(typeName));
        }
      }
      
      // Return type
      const returnType = method.getReturnTypeNode();
      if (returnType) {
        this.extractTypeNames(returnType).forEach(typeName => coupledTypes.add(typeName));
      }
    }
    
    return coupledTypes.size;
  }

  /**
   * Extract type names from TypeNode (reuse from TypeDependencyAnalyzer)
   */
  private extractTypeNames(typeNode: TypeNode): string[] {
    const typeNames = new Set<string>();
    
    // Extract direct type reference
    if (Node.isTypeReference(typeNode)) {
      typeNames.add(typeNode.getTypeName().getText());
    }
    
    // Recursively extract type names from descendants
    typeNode.forEachDescendant((node) => {
      if (Node.isTypeReference(node)) {
        const typeName = node.getTypeName().getText();
        // Filter out built-in types
        if (!this.isBuiltInType(typeName)) {
          typeNames.add(typeName);
        }
      }
    });
    
    return Array.from(typeNames);
  }

  /**
   * Check if a type name is a built-in TypeScript type
   */
  private isBuiltInType(typeName: string): boolean {
    const builtInTypes = [
      'string', 'number', 'boolean', 'object', 'undefined', 'null', 'void', 'never',
      'Array', 'Map', 'Set', 'Date', 'Promise', 'Error', 'RegExp', 'Function',
      'any', 'unknown', 'bigint', 'symbol',
      'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Record', 'Exclude', 'Extract',
      'NonNullable', 'Parameters', 'ReturnType', 'InstanceType', 'ThisType'
    ];
    return builtInTypes.includes(typeName);
  }

  /**
   * Build inheritance relationships map
   */
  private buildInheritanceMap(): void {
    for (const [typeName, typeDef] of this.typeDefinitions) {
      const sourceFile = this.project.getSourceFile(typeDef.filePath);
      if (!sourceFile) continue;

      const node = this.findTypeNode(sourceFile, typeDef);
      if (!node) continue;

      const inheritanceInfo: InheritanceInfo = {
        parentClass: null,
        childClasses: [],
        implementedInterfaces: [],
        extendedInterfaces: []
      };

      if (Node.isClassDeclaration(node)) {
        // Handle class extends
        const extendsClause = node.getExtends();
        if (extendsClause) {
          inheritanceInfo.parentClass = extendsClause.getExpression().getText();
        }

        // Handle class implements
        const implementsClauses = node.getImplements();
        for (const impl of implementsClauses) {
          inheritanceInfo.implementedInterfaces.push(impl.getExpression().getText());
        }
      } else if (Node.isInterfaceDeclaration(node)) {
        // Handle interface extends
        const extendsClauses = node.getExtends();
        for (const ext of extendsClauses) {
          inheritanceInfo.extendedInterfaces.push(ext.getExpression().getText());
        }
      }

      this.inheritanceMap.set(typeName, inheritanceInfo);
    }

    // Build reverse relationships (children)
    for (const [typeName, inheritanceInfo] of this.inheritanceMap) {
      // Add to parent's children list
      if (inheritanceInfo.parentClass) {
        const parentInfo = this.inheritanceMap.get(inheritanceInfo.parentClass);
        if (parentInfo) {
          parentInfo.childClasses.push(typeName);
        }
      }

      // Add to implemented interfaces' children list
      for (const interfaceName of inheritanceInfo.implementedInterfaces) {
        const interfaceInfo = this.inheritanceMap.get(interfaceName);
        if (interfaceInfo) {
          interfaceInfo.childClasses.push(typeName);
        }
      }

      // Add to extended interfaces' children list
      for (const interfaceName of inheritanceInfo.extendedInterfaces) {
        const interfaceInfo = this.inheritanceMap.get(interfaceName);
        if (interfaceInfo) {
          // This interface is extended by typeName, so typeName is a child
          interfaceInfo.childClasses.push(typeName);
        }
      }
    }
  }

  /**
   * Find TypeScript AST node for a type definition
   */
  private findTypeNode(sourceFile: any, typeDefinition: TypeDefinition): Node | undefined { // eslint-disable-line @typescript-eslint/no-explicit-any
    const targetLine = typeDefinition.startLine;
    
    switch (typeDefinition.kind) {
      case 'interface':
        return sourceFile.getInterfaces().find((node: InterfaceDeclaration) => 
          node.getStartLineNumber() === targetLine && node.getName() === typeDefinition.name
        );
      
      case 'class':
        return sourceFile.getClasses().find((node: ClassDeclaration) => 
          node.getStartLineNumber() === targetLine && node.getName() === typeDefinition.name
        );
      
      default:
        return undefined;
    }
  }

  /**
   * Get default CK metrics
   */
  private getDefaultCKMetrics(): CKMetrics {
    return {
      DIT: 0,
      NOC: 0,
      LCOM: 0,
      WMC: 0,
      RFC: 0,
      CBO: 0
    };
  }

  /**
   * Get default inheritance info
   */
  private getDefaultInheritanceInfo(): InheritanceInfo {
    return {
      parentClass: null,
      childClasses: [],
      implementedInterfaces: [],
      extendedInterfaces: []
    };
  }
}