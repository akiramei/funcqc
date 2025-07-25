/**
 * Commander.js callback registration analyzer
 * Detects .action() registrations and .parse()/.parseAsync() triggers
 */

import { CallExpression, Node, PropertyAccessExpression, SyntaxKind } from 'ts-morph';
import { FrameworkCallbackAnalyzer } from '../framework-analyzer';
import { Logger } from '../../../utils/cli-utils';
import { 
  CallbackRegistration, 
  CallbackTrigger, 
  AnalysisContext 
} from '../types';

/**
 * Analyzer for Commander.js callback registration patterns
 */
export class CommanderCallbackAnalyzer extends FrameworkCallbackAnalyzer {
  constructor(logger?: Logger) {
    super('commander', logger);
    // Debug temporarily enabled to investigate virtual edge generation
    this.debug = true;
  }

  /**
   * Check if this analyzer can handle the given source file
   */
  override canAnalyze(context: AnalysisContext): boolean {
    const sourceCode = context.sourceFile.getFullText();
    const filePath = context.sourceFile.getFilePath();
    
    // Check for Commander.js imports or usage patterns
    const hasCommanderImport = sourceCode.includes('from \'commander\'') || 
                              sourceCode.includes('require(\'commander\')') ||
                              sourceCode.includes('import { Command }') ||
                              sourceCode.includes('import { program }');
    
    const hasCommanderUsage = sourceCode.includes('.action(') ||
                             sourceCode.includes('.parseAsync(') ||
                             sourceCode.includes('.parse(') ||
                             sourceCode.includes('new Command(');

    const canAnalyze = hasCommanderImport || hasCommanderUsage;
    
    // Always log for main CLI file specifically and when patterns are found
    if (filePath.includes('cli.ts') || hasCommanderImport || hasCommanderUsage) {
      console.log(`🔍 [Commander] canAnalyze(${filePath}): ${canAnalyze} (import: ${hasCommanderImport}, usage: ${hasCommanderUsage})`);
      if (hasCommanderImport) {
        console.log(`🔍 [Commander] Found import patterns in ${filePath}`);
      }
      if (hasCommanderUsage) {
        console.log(`🔍 [Commander] Found usage patterns in ${filePath}`);
      }
    }

    return canAnalyze;
  }

  /**
   * Detect callback registration patterns (.action(), .hook(), etc.)
   */
  protected async detectCallbackRegistrations(context: AnalysisContext): Promise<CallbackRegistration[]> {
    const registrations: CallbackRegistration[] = [];
    const sourceFile = context.sourceFile;
    const registrationMethods = context.frameworkConfig.registrationMethods;
    const filePath = sourceFile.getFilePath();

    // Find all call expressions in the file
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    
    console.log(`🔍 [Commander] detectCallbackRegistrations(${filePath}): ${callExpressions.length} call expressions found`);

    for (const callExpression of callExpressions) {
      const registration = this.analyzeCallExpression(callExpression, context, registrationMethods);
      if (registration) {
        console.log(`🔍 [Commander] Found registration: ${registration.registrationMethod} -> ${registration.callbackFunctionName || 'anonymous'}`);
        registrations.push(registration);
      }
    }

    console.log(`🔍 [Commander] detectCallbackRegistrations(${filePath}): ${registrations.length} registrations found`);

    return registrations;
  }

  /**
   * Detect callback trigger patterns (.parse(), .parseAsync())
   */
  protected async detectCallbackTriggers(
    context: AnalysisContext, 
    registrations: CallbackRegistration[]
  ): Promise<CallbackTrigger[]> {
    const triggers: CallbackTrigger[] = [];
    const sourceFile = context.sourceFile;
    const triggerMethods = context.frameworkConfig.triggerMethods;
    const filePath = sourceFile.getFilePath();

    // Find all call expressions that might be triggers
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    
    console.log(`🔍 [Commander] detectCallbackTriggers(${filePath}): ${callExpressions.length} call expressions, ${registrations.length} registrations, trigger methods: [${triggerMethods.join(', ')}]`);

    for (const callExpression of callExpressions) {
      const trigger = this.analyzeTriggerCallExpression(callExpression, context, triggerMethods, registrations);
      if (trigger) {
        console.log(`🔍 [Commander] Found trigger: ${trigger.triggerMethod} with ${trigger.registrations.length} related registrations`);
        triggers.push(trigger);
      }
    }

    console.log(`🔍 [Commander] detectCallbackTriggers(${filePath}): ${triggers.length} triggers found`);

    return triggers;
  }

  /**
   * Analyze a call expression to see if it's a callback registration
   */
  private analyzeCallExpression(
    callExpression: CallExpression,
    context: AnalysisContext,
    registrationMethods: string[]
  ): CallbackRegistration | null {
    const expression = callExpression.getExpression();
    
    // Check for method calls like .action(), .hook()
    if (!Node.isPropertyAccessExpression(expression)) {
      return null;
    }

    const methodName = expression.getName();
    const filePath = context.sourceFile.getFilePath();
    
    // Debug: Log all property access expressions in main CLI file
    if (filePath.includes('cli.ts') && (methodName === 'action' || methodName === 'hook')) {
      console.log(`🔍 [Commander] Found ${methodName}() call in ${filePath} at line ${callExpression.getStartLineNumber()}`);
      console.log(`🔍 [Commander] Registration methods config: [${registrationMethods.join(', ')}]`);
      console.log(`🔍 [Commander] Method ${methodName} is in config: ${registrationMethods.includes(methodName)}`);
      
      // Debug object chain creation
      const debugObjectChain = this.getObjectChain(expression);
      console.log(`🔍 [Commander] Object chain for ${methodName}(): "${debugObjectChain}"`);
      console.log(`🔍 [Commander] Expression text: "${expression.getText()}"`);
    }
    
    if (!registrationMethods.includes(methodName)) {
      return null;
    }

    // Get the callback function argument
    const args = callExpression.getArguments();
    if (args.length === 0) {
      if (filePath.includes('cli.ts') && (methodName === 'action' || methodName === 'hook')) {
        console.log(`🔍 [Commander] ${methodName}() at line ${callExpression.getStartLineNumber()} has no arguments - skipping`);
      }
      return null;
    }

    const callbackArg = args[args.length - 1]; // Usually the last argument
    const lineNumber = callExpression.getStartLineNumber();
    const columnNumber = callExpression.getStart();

    // Find the containing function that does the registration
    let containingFunction = this.findContainingFunction(lineNumber, context.fileFunctions);
    
    // For Commander.js, .action() calls often occur at top-level (module scope)
    // Create a synthetic function entry for module-level registrations
    if (!containingFunction && (methodName === 'action' || methodName === 'hook')) {
      console.log(`🔍 [Commander] ${methodName}() at line ${lineNumber} - creating synthetic module-level function`);
      containingFunction = {
        id: `module_${filePath.replace(/[^a-zA-Z0-9]/g, '_')}_${lineNumber}`,
        name: `<module-level-${methodName}>`,
        filePath,
        lexicalPath: `${filePath}#module`,
        nodeKind: 'Module',
        isExported: false,
        isMethod: false,
        signature: `module.${methodName}()`,
        startLine: lineNumber,
        endLine: lineNumber,
        contentHash: 'module-level'
      };
    }
    
    if (!containingFunction) {
      if (filePath.includes('cli.ts') && (methodName === 'action' || methodName === 'hook')) {
        console.log(`🔍 [Commander] ${methodName}() at line ${lineNumber} - no containing function found even after synthetic creation`);
        console.log(`🔍 [Commander] Available functions in file: ${context.fileFunctions.length}`);
      }
      return null;
    }

    // Analyze the callback argument
    const callbackInfo = this.analyzeCallbackArgument(callbackArg, context);
    
    const registration: CallbackRegistration = {
      registrarFunctionId: (containingFunction as { id: string }).id,
      callbackFunctionId: callbackInfo.functionId ?? '',
      callbackFunctionName: callbackInfo.functionName ?? '',
      registrationMethod: methodName,
      triggerMethod: this.getCorrespondingTriggerMethod(methodName, context),
      lineNumber,
      columnNumber,
      confidence: this.getConfidenceScore(methodName, context),
      metadata: {
        isArrowFunction: callbackInfo.isArrowFunction,
        isInlineFunction: callbackInfo.isInlineFunction,
        objectChain: this.getObjectChain(expression)
      }
    };

    if (this.debug) {
      this.logger.debug(`[Commander] Found registration: ${methodName} -> ${registration.callbackFunctionName || 'anonymous'}`);
    }

    return registration;
  }

  /**
   * Analyze a trigger call expression (like .parseAsync())
   */
  private analyzeTriggerCallExpression(
    callExpression: CallExpression,
    context: AnalysisContext,
    triggerMethods: string[],
    registrations: CallbackRegistration[]
  ): CallbackTrigger | null {
    const expression = callExpression.getExpression();
    
    // Check for method calls like .parse(), .parseAsync()
    if (!Node.isPropertyAccessExpression(expression)) {
      return null;
    }

    const methodName = expression.getName();
    if (!triggerMethods.includes(methodName)) {
      return null;
    }

    const lineNumber = callExpression.getStartLineNumber();
    const columnNumber = callExpression.getStart();

    // Find the containing function that calls the trigger
    const containingFunction = this.findContainingFunction(lineNumber, context.fileFunctions);
    if (!containingFunction) {
      return null;
    }

    // Find registrations that this trigger would invoke
    const relatedRegistrations = registrations.filter(reg => 
      reg.triggerMethod === methodName &&
      this.areRegistrationsRelated(reg, callExpression, context)
    );

    const trigger: CallbackTrigger = {
      triggerFunctionId: (containingFunction as { id: string }).id,
      triggerFunctionName: (containingFunction as { name: string }).name,
      triggerMethod: methodName,
      lineNumber,
      columnNumber,
      registrations: relatedRegistrations
    };

    if (this.debug) {
      this.logger.debug(`[Commander] Found trigger: ${methodName} with ${relatedRegistrations.length} related registrations`);
    }

    return trigger;
  }

  /**
   * Analyze a callback function argument to extract function information
   */
  private analyzeCallbackArgument(
    callbackArg: Node,
    context: AnalysisContext
  ): { functionId?: string; functionName?: string; isArrowFunction: boolean; isInlineFunction: boolean } {
    // Arrow function: (args) => { ... }
    if (Node.isArrowFunction(callbackArg)) {
      const innerFunctionCalls = this.extractInnerFunctionCalls(callbackArg);
      const primaryCall = innerFunctionCalls[0]; // Use the first/main function call
      
      if (this.debug && innerFunctionCalls.length > 0) {
        console.log(`🔍 [Commander] Extracted inner function calls: ${innerFunctionCalls.map(f => f.functionName).join(', ')}`);
        console.log(`🔍 [Commander] Primary call: ${primaryCall?.functionName}`);
      }
      
      // Try to resolve the function ID from the function name
      let functionId = primaryCall?.functionId;
      if (!functionId && primaryCall?.functionName) {
        const resolvedFunction = this.findFunctionByName(primaryCall.functionName, context.allFunctions);
        if (resolvedFunction) {
          functionId = (resolvedFunction as { id: string }).id;
          if (this.debug) {
            console.log(`🔍 [Commander] Resolved function ID for ${primaryCall.functionName}: ${functionId}`);
          }
        }
      }
      
      const result: { functionId?: string; functionName?: string; isArrowFunction: boolean; isInlineFunction: boolean } = {
        isArrowFunction: true,
        isInlineFunction: true
      };
      if (functionId) {
        result.functionId = functionId;
      }
      if (primaryCall?.functionName) {
        result.functionName = primaryCall.functionName;
      }
      return result;
    }

    // Function expression: function(args) { ... }
    if (Node.isFunctionExpression(callbackArg)) {
      const innerFunctionCalls = this.extractInnerFunctionCalls(callbackArg);
      const primaryCall = innerFunctionCalls[0]; // Use the first/main function call
      
      // Try to resolve the function ID from the function name
      let functionId = primaryCall?.functionId;
      if (!functionId && primaryCall?.functionName) {
        const resolvedFunction = this.findFunctionByName(primaryCall.functionName, context.allFunctions);
        if (resolvedFunction) {
          functionId = (resolvedFunction as { id: string }).id;
          if (this.debug) {
            console.log(`🔍 [Commander] Resolved function ID for ${primaryCall.functionName}: ${functionId}`);
          }
        }
      }
      
      const result: { functionId?: string; functionName?: string; isArrowFunction: boolean; isInlineFunction: boolean } = {
        isArrowFunction: false,
        isInlineFunction: true
      };
      if (functionId) {
        result.functionId = functionId;
      }
      if (primaryCall?.functionName) {
        result.functionName = primaryCall.functionName;
      }
      return result;
    }

    // Function reference: someFunction or this.someMethod
    if (Node.isIdentifier(callbackArg)) {
      const functionName = callbackArg.getText();
      const functionMetadata = this.findFunctionByName(functionName, context.allFunctions);
      
      const functionId = (functionMetadata as { id?: string } | null)?.id;
      const result: { functionId?: string; functionName: string; isArrowFunction: boolean; isInlineFunction: boolean } = {
        functionName,
        isArrowFunction: false,
        isInlineFunction: false
      };
      if (functionId) {
        result.functionId = functionId;
      }
      return result;
    }

    // Property access: this.someMethod, obj.method
    if (Node.isPropertyAccessExpression(callbackArg)) {
      const functionName = callbackArg.getName();
      const fullName = callbackArg.getText();
      const functionMetadata = this.findFunctionByName(functionName, context.allFunctions) ||
                              this.findFunctionByName(fullName, context.allFunctions);
      
      const functionId = (functionMetadata as { id?: string } | null)?.id;
      const result: { functionId?: string; functionName: string; isArrowFunction: boolean; isInlineFunction: boolean } = {
        functionName: fullName,
        isArrowFunction: false,
        isInlineFunction: false
      };
      if (functionId) {
        result.functionId = functionId;
      }
      return result;
    }

    return {
      isArrowFunction: false,
      isInlineFunction: false
    };
  }

  /**
   * Get the corresponding trigger method for a registration method
   */
  private getCorrespondingTriggerMethod(registrationMethod: string, context: AnalysisContext): string {
    // For Commander, most registrations are triggered by parse/parseAsync
    const triggerMethods = context.frameworkConfig.triggerMethods;
    
    switch (registrationMethod) {
      case 'action':
      case 'hook':
        return triggerMethods.includes('parseAsync') ? 'parseAsync' : 'parse';
      default:
        return triggerMethods[0] || 'parse';
    }
  }

  /**
   * Get the object chain for a property access expression (e.g., "program.command('test')")
   */
  private getObjectChain(expression: PropertyAccessExpression): string {
    const parts: string[] = [];
    let current: Node = expression;

    // Traverse up the chain to collect all parts
    while (Node.isPropertyAccessExpression(current)) {
      parts.unshift(current.getName());
      current = current.getExpression();
    }

    // Add the base identifier (e.g., 'program')
    if (Node.isIdentifier(current)) {
      parts.unshift(current.getText());
    } else if (Node.isCallExpression(current)) {
      // Handle chained method calls like program.command('init')
      const innerExpr = current.getExpression();
      if (Node.isPropertyAccessExpression(innerExpr)) {
        const innerChain = this.getObjectChain(innerExpr);
        parts.unshift(innerChain);
      } else if (Node.isIdentifier(innerExpr)) {
        parts.unshift(innerExpr.getText());
      }
    }

    // For Commander.js, we mainly care about the base object (program)
    // So we simplify the chain to focus on the base identifier
    const result = parts.join('.');
    
    // Extract the base object (first part before any method calls)
    const baseMatch = result.match(/^([^.]+)/);
    return baseMatch ? baseMatch[1] : result;
  }

  /**
   * Check if a registration is related to a trigger call
   */
  private areRegistrationsRelated(
    registration: CallbackRegistration,
    triggerCall: CallExpression,
    _context: AnalysisContext
  ): boolean {
    // For Commander, registrations and triggers are related if they operate on the same program/command object
    // This implementation reduces false positives by checking object chain similarity
    
    const triggerExpression = triggerCall.getExpression();
    if (!Node.isPropertyAccessExpression(triggerExpression)) {
      return false;
    }

    // Get the object chain for both registration and trigger
    const triggerObjectChain = this.getObjectChain(triggerExpression);
    const registrationObjectChain = registration.metadata?.['objectChain'];

    // If we can't determine object chains, be conservative
    if (!triggerObjectChain || !registrationObjectChain || typeof registrationObjectChain !== 'string') {
      return false;
    }

    // Check if the object chains are similar (indicating same program/command instance)
    return this.areObjectChainsSimilar(triggerObjectChain, registrationObjectChain);
  }

  /**
   * Extract inner function calls from a callback function body
   */
  private extractInnerFunctionCalls(callbackNode: Node): Array<{ functionId?: string; functionName?: string }> {
    const functionCalls: Array<{ functionId?: string; functionName?: string }> = [];
    
    // Look for patterns like: const { initCommand } = await import('./cli/init'); return initCommand(options);
    const variableDeclarations = callbackNode.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
    const importedFunctions = new Set<string>();
    
    // First pass: collect imported function names from destructuring assignments
    for (const varDecl of variableDeclarations) {
      const initializer = varDecl.getInitializer();
      if (initializer && Node.isAwaitExpression(initializer)) {
        const awaitedExpr = initializer.getExpression();
        if (Node.isCallExpression(awaitedExpr)) {
          const importExpr = awaitedExpr.getExpression();
          if (Node.isIdentifier(importExpr) && importExpr.getText() === 'import') {
            // This is a dynamic import with destructuring
            const nameBinding = varDecl.getNameNode();
            if (Node.isObjectBindingPattern(nameBinding)) {
              for (const element of nameBinding.getElements()) {
                if (Node.isBindingElement(element)) {
                  const name = element.getName();
                  if (name) {
                    importedFunctions.add(name);
                  }
                }
              }
            }
          }
        }
      }
    }
    
    // Second pass: find call expressions and match with imported functions
    const callExpressions = callbackNode.getDescendantsOfKind(SyntaxKind.CallExpression);
    
    for (const callExpr of callExpressions) {
      const expression = callExpr.getExpression();
      
      // Handle direct function calls like initCommand(options)
      if (Node.isIdentifier(expression)) {
        const functionName = expression.getText();
        
        // Skip import() calls and common JavaScript functions
        if (functionName === 'import' || functionName === 'require' || functionName === 'console') {
          continue;
        }
        
        // Prioritize imported functions
        if (importedFunctions.has(functionName)) {
          functionCalls.unshift({ functionName }); // Add to front as primary function
        } else {
          functionCalls.push({ functionName });
        }
      }
      
      // Handle property access calls like utils.someFunction()
      else if (Node.isPropertyAccessExpression(expression)) {
        const functionName = expression.getName();
        functionCalls.push({ functionName });
      }
    }
    
    return functionCalls;
  }

  /**
   * Check if two object chains are similar enough to be considered related
   */
  private areObjectChainsSimilar(chain1: string, chain2: string): boolean {
    // Exact match is ideal
    if (chain1 === chain2) {
      console.log(`🔍 [Commander] Object chains exact match: "${chain1}" === "${chain2}" -> true`);
      return true;
    }

    // For Commander.js, common patterns are:
    // - "program" (main program object)
    // - "program.command(...)" (subcommands)
    // - chained calls like "program.command(...).option(...)"
    
    // Extract the base object (before first method call)
    const base1 = chain1.split('.')[0];
    const base2 = chain2.split('.')[0];
    
    const result = base1 === base2;
    console.log(`🔍 [Commander] Object chain comparison: "${chain1}" (base: "${base1}") vs "${chain2}" (base: "${base2}") -> ${result}`);
    
    // If base objects are the same, consider them related
    // This handles cases where both use 'program' but have different chaining
    return result;
  }

  /**
   * Override confidence scoring for Commander-specific patterns
   */
  protected override getConfidenceScore(registrationMethod: string, context: AnalysisContext): number {
    const baseConfidence = super.getConfidenceScore(registrationMethod, context);

    // Higher confidence for well-known Commander methods
    switch (registrationMethod) {
      case 'action':
        return Math.min(baseConfidence + 0.1, 0.95);
      case 'hook':
        return Math.min(baseConfidence + 0.05, 0.9);
      default:
        return baseConfidence;
    }
  }
}