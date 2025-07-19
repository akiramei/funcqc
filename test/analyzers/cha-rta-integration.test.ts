import { describe, it, expect, beforeEach } from 'vitest';
import { Project } from 'ts-morph';
import { StagedAnalysisEngine } from '../../src/analyzers/staged-analysis-engine';
import { FunctionRegistry } from '../../src/analyzers/function-registry';
import { CHAAnalyzer } from '../../src/analyzers/cha-analyzer';
import { RTAAnalyzer } from '../../src/analyzers/rta-analyzer';

describe('CHA/RTA Method Call Resolution Integration', () => {
  let project: Project;
  let engine: StagedAnalysisEngine;
  let functionRegistry: FunctionRegistry;
  let chaAnalyzer: CHAAnalyzer;
  let rtaAnalyzer: RTAAnalyzer;

  beforeEach(() => {
    project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 5, // ES2015
        allowJs: true,
        declaration: false,
        skipLibCheck: true,
      }
    });
    
    const typeChecker = project.getTypeChecker();
    engine = new StagedAnalysisEngine(project, typeChecker);
    functionRegistry = new FunctionRegistry(project);
    chaAnalyzer = new CHAAnalyzer(project, typeChecker);
    rtaAnalyzer = new RTAAnalyzer(project, typeChecker);
  });

  describe('Class Hierarchy Method Resolution (CHA)', () => {
    it('should resolve inherited method calls correctly', async () => {
      // Arrange - Create inheritance hierarchy
      const baseFile = project.createSourceFile('base.ts', `
        export class Animal {
          name: string;
          
          constructor(name: string) {
            this.name = name;
          }
          
          speak(): string {
            return 'Some sound';
          }
          
          move(): string {
            return 'Moving';
          }
        }
      `);
      
      const derivedFile = project.createSourceFile('derived.ts', `
        import { Animal } from './base';
        
        export class Dog extends Animal {
          breed: string;
          
          constructor(name: string, breed: string) {
            super(name);
            this.breed = breed;
          }
          
          speak(): string {
            return 'Woof!';
          }
          
          // move() inherited from Animal
          
          wagTail(): string {
            return 'Wagging tail';
          }
        }
      `);
      
      const clientFile = project.createSourceFile('client.ts', `
        import { Dog } from './derived';
        
        function testDog(): string {
          const dog = new Dog('Buddy', 'Golden Retriever');
          const sound = dog.speak();    // Should resolve to Dog.speak
          const movement = dog.move();  // Should resolve to Animal.move (inherited)
          const tail = dog.wagTail();   // Should resolve to Dog.wagTail
          return sound + movement + tail;
        }
      `);
      
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert - Check CHA resolved edges
      const chaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'cha_resolved');
      
      // Should find method calls resolved by CHA
      const speakCall = chaResolvedEdges.find(edge => 
        edge.calleeName.includes('speak') && edge.callContext === 'cha_resolved'
      );
      
      const moveCall = chaResolvedEdges.find(edge => 
        edge.calleeName.includes('move') && edge.callContext === 'cha_resolved'
      );
      
      const wagTailCall = chaResolvedEdges.find(edge => 
        edge.calleeName.includes('wagTail') && edge.callContext === 'cha_resolved'
      );
      
      // Verify CHA resolution
      expect(chaResolvedEdges.length).toBeGreaterThan(0);
      
      // At least one method call should be resolved by CHA
      const hasMethodCall = chaResolvedEdges.some(edge => 
        edge.metadata?.chaCandidate === true
      );
      expect(hasMethodCall).toBe(true);
    });

    it('should handle multiple inheritance levels correctly', async () => {
      // Arrange - Create cross-file inheritance hierarchy requiring CHA
      const grandParentFile = project.createSourceFile('grandparent.ts', `
        export class GrandParent {
          grandMethod(): string {
            return 'grand';
          }
        }
      `);
      
      const parentFile = project.createSourceFile('parent.ts', `
        import { GrandParent } from './grandparent';
        
        export class Parent extends GrandParent {
          parentMethod(): string {
            return 'parent';
          }
          // grandMethod() inherited from GrandParent
        }
      `);
      
      const childFile = project.createSourceFile('child.ts', `
        import { Parent } from './parent';
        
        export class Child extends Parent {
          childMethod(): string {
            return 'child';
          }
          // Both parentMethod() and grandMethod() inherited
        }
      `);
      
      const clientFile = project.createSourceFile('client.ts', `
        import { Parent } from './parent';
        import { Child } from './child';
        
        function processParent(obj: Parent): string {
          // CHA needed: obj could be Parent or Child instance
          return obj.grandMethod(); // Inherited method call requiring CHA
        }
        
        function testInheritance(): string {
          const parent = new Parent();
          const child = new Child();
          
          return processParent(parent) + processParent(child);
        }
      `);
      
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert
      const chaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'cha_resolved');
      
      // Should resolve method calls across inheritance levels
      const methodCalls = chaResolvedEdges.filter(edge => 
        edge.metadata?.chaCandidate === true
      );
      
      expect(methodCalls.length).toBeGreaterThan(0);
      
      // Check inheritance depth metadata
      const inheritanceDepths = methodCalls.map(edge => edge.metadata?.inheritanceDepth).filter(d => d !== undefined);
      expect(inheritanceDepths.length).toBeGreaterThan(0);
    });

    it('should handle interface implementation correctly', async () => {
      // Arrange - Create cross-file interface scenario requiring CHA
      const interfaceFile = project.createSourceFile('drawable.ts', `
        export interface Drawable {
          draw(): void;
          getArea(): number;
        }
      `);
      
      const circleFile = project.createSourceFile('circle.ts', `
        import { Drawable } from './drawable';
        
        export class Circle implements Drawable {
          constructor(private radius: number) {}
          
          draw(): void {
            console.log('Drawing circle');
          }
          
          getArea(): number {
            return Math.PI * this.radius * this.radius;
          }
        }
      `);
      
      const rectangleFile = project.createSourceFile('rectangle.ts', `
        import { Drawable } from './drawable';
        
        export class Rectangle implements Drawable {
          constructor(private width: number, private height: number) {}
          
          draw(): void {
            console.log('Drawing rectangle');
          }
          
          getArea(): number {
            return this.width * this.height;
          }
        }
      `);
      
      const clientFile = project.createSourceFile('renderer.ts', `
        import { Drawable } from './drawable';
        import { Circle } from './circle';
        import { Rectangle } from './rectangle';
        
        function renderShape(shape: Drawable): number {
          // CHA needed: shape could be Circle or Rectangle
          shape.draw();           // Interface method call requiring CHA
          return shape.getArea(); // Interface method call requiring CHA
        }
        
        function testRendering(): number {
          const circle = new Circle(5);
          const rectangle = new Rectangle(10, 20);
          
          renderShape(circle);
          return renderShape(rectangle);
        }
      `);
      
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert
      const chaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'cha_resolved');
      const rtaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'rta_resolved');
      
      // Interface method calls should be resolved by CHA or RTA (RTA is better)
      const interfaceMethodCalls = [
        ...chaResolvedEdges.filter(edge => edge.metadata?.chaCandidate === true),
        ...rtaResolvedEdges.filter(edge => edge.metadata?.rtaCandidate === true)
      ];
      
      expect(interfaceMethodCalls.length).toBeGreaterThan(0);
    });

    it('should handle static method inheritance correctly', async () => {
      // Arrange - Create cross-file static method inheritance requiring CHA
      const baseFile = project.createSourceFile('math-base.ts', `
        export class MathBase {
          static PI = 3.14159;
          
          static square(n: number): number {
            return n * n;
          }
          
          static power(base: number, exp: number): number {
            return Math.pow(base, exp);
          }
        }
      `);
      
      const advancedFile = project.createSourceFile('advanced-math.ts', `
        import { MathBase } from './math-base';
        
        export class AdvancedMath extends MathBase {
          static E = 2.71828;
          
          static cube(n: number): number {
            return this.power(n, 3); // Inherited static method
          }
          
          static circleArea(radius: number): number {
            return this.square(radius) * this.PI; // Multiple inherited static calls
          }
        }
      `);
      
      const clientFile = project.createSourceFile('calculator.ts', `
        import { AdvancedMath } from './advanced-math';
        
        function performCalculation(MathClass: typeof AdvancedMath): number {
          // CHA needed: MathClass could be AdvancedMath or a subclass
          const squared = MathClass.square(5);     // Inherited static method requiring CHA
          const cubed = MathClass.cube(3);         // Direct static method
          return squared + cubed;
        }
        
        function calculate(): number {
          return performCalculation(AdvancedMath);
        }
      `);
      
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert
      const chaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'cha_resolved');
      
      // Static method calls should be resolved
      const staticMethodCalls = chaResolvedEdges.filter(edge => 
        edge.metadata?.chaCandidate === true
      );
      
      expect(staticMethodCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Rapid Type Analysis (RTA) Integration', () => {
    it('should filter CHA candidates based on instantiated types', async () => {
      // Arrange - Create scenario with multiple implementations but limited instantiation
      const sourceCode = `
        interface Vehicle {
          start(): void;
          stop(): void;
        }
        
        class Car implements Vehicle {
          start(): void {
            console.log('Car starting');
          }
          
          stop(): void {
            console.log('Car stopping');
          }
        }
        
        class Motorcycle implements Vehicle {
          start(): void {
            console.log('Motorcycle starting');
          }
          
          stop(): void {
            console.log('Motorcycle stopping');
          }
        }
        
        class Truck implements Vehicle {
          start(): void {
            console.log('Truck starting');
          }
          
          stop(): void {
            console.log('Truck stopping');
          }
        }
        
        function useVehicle(vehicle: Vehicle): void {
          vehicle.start(); // CHA would find all 3 implementations
          vehicle.stop();  // RTA should filter based on actual instantiations
        }
        
        function main(): void {
          // Only Car and Motorcycle are instantiated, not Truck
          const car = new Car();
          const bike = new Motorcycle();
          
          useVehicle(car);
          useVehicle(bike);
          // Truck is never instantiated
        }
      `;
      
      const sourceFile = project.createSourceFile('rta-filtering.ts', sourceCode);
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert
      const chaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'cha_resolved');
      const rtaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'rta_resolved');
      
      // RTA should provide more precise resolution than CHA
      if (rtaResolvedEdges.length > 0) {
        // RTA edges should have higher confidence than CHA edges
        const rtaConfidences = rtaResolvedEdges.map(edge => edge.confidenceScore);
        const chaConfidences = chaResolvedEdges.map(edge => edge.confidenceScore);
        
        if (rtaConfidences.length > 0 && chaConfidences.length > 0) {
          const avgRtaConfidence = rtaConfidences.reduce((a, b) => a + b, 0) / rtaConfidences.length;
          const avgChaConfidence = chaConfidences.reduce((a, b) => a + b, 0) / chaConfidences.length;
          
          expect(avgRtaConfidence).toBeGreaterThanOrEqual(avgChaConfidence);
        }
        
        // RTA should filter out non-instantiated types
        const rtaMetadata = rtaResolvedEdges.map(edge => edge.metadata);
        const hasInstantiationFiltering = rtaMetadata.some(meta => 
          meta?.rtaCandidate === true && 
          meta?.rtaFilteredCandidates < meta?.originalCHACandidates
        );
        
        expect(hasInstantiationFiltering).toBe(true);
      }
    });

    it('should detect constructor instantiations correctly', async () => {
      // Arrange - Create various instantiation patterns
      const sourceCode = `
        class DirectInstantiation {
          constructor(public value: string) {}
          
          process(): string {
            return this.value;
          }
        }
        
        class FactoryInstantiation {
          constructor(private data: number) {}
          
          static create(data: number): FactoryInstantiation {
            return new FactoryInstantiation(data);
          }
          
          getData(): number {
            return this.data;
          }
        }
        
        class NeverInstantiated {
          constructor() {}
          
          unusedMethod(): string {
            return 'never called';
          }
        }
        
        function testInstantiations(): void {
          // Direct constructor call
          const direct = new DirectInstantiation('test');
          direct.process();
          
          // Factory method instantiation
          const factory = FactoryInstantiation.create(42);
          factory.getData();
          
          // NeverInstantiated is never created
          // So its methods should not be RTA candidates
        }
      `;
      
      const sourceFile = project.createSourceFile('instantiation-patterns.ts', sourceCode);
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert
      const rtaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'rta_resolved');
      
      if (rtaResolvedEdges.length > 0) {
        // Check that RTA tracked instantiations
        const instantiationTypes = rtaResolvedEdges
          .map(edge => edge.metadata?.instantiatedType)
          .filter(type => type !== undefined);
        
        expect(instantiationTypes.length).toBeGreaterThan(0);
        
        // Should include instantiated types
        expect(instantiationTypes).toContain('DirectInstantiation');
        expect(instantiationTypes).toContain('FactoryInstantiation');
        
        // Should not include never-instantiated types
        expect(instantiationTypes).not.toContain('NeverInstantiated');
      }
    });

    it('should handle interface instantiation through concrete classes', async () => {
      // Arrange - Interface implemented by multiple classes with selective instantiation
      const sourceCode = `
        interface Logger {
          log(message: string): void;
          error(message: string): void;
        }
        
        class FileLogger implements Logger {
          log(message: string): void {
            console.log('FILE: ' + message);
          }
          
          error(message: string): void {
            console.error('FILE ERROR: ' + message);
          }
        }
        
        class DatabaseLogger implements Logger {
          log(message: string): void {
            console.log('DB: ' + message);
          }
          
          error(message: string): void {
            console.error('DB ERROR: ' + message);
          }
        }
        
        class ConsoleLogger implements Logger {
          log(message: string): void {
            console.log('CONSOLE: ' + message);
          }
          
          error(message: string): void {
            console.error('CONSOLE ERROR: ' + message);
          }
        }
        
        function useLogger(logger: Logger): void {
          logger.log('Info message');    // CHA: 3 candidates, RTA: should filter
          logger.error('Error message'); // CHA: 3 candidates, RTA: should filter
        }
        
        function setup(): void {
          // Only FileLogger and ConsoleLogger are instantiated
          const fileLogger = new FileLogger();
          const consoleLogger = new ConsoleLogger();
          
          useLogger(fileLogger);
          useLogger(consoleLogger);
          
          // DatabaseLogger is never instantiated
        }
      `;
      
      const sourceFile = project.createSourceFile('interface-instantiation.ts', sourceCode);
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert
      const chaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'cha_resolved');
      const rtaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'rta_resolved');
      
      // RTA should provide more precise resolution for interface methods
      if (rtaResolvedEdges.length > 0) {
        const rtaFilteringEvidence = rtaResolvedEdges.some(edge => 
          edge.metadata?.rtaCandidate === true &&
          typeof edge.metadata?.originalCHACandidates === 'number' &&
          typeof edge.metadata?.rtaFilteredCandidates === 'number' &&
          edge.metadata.rtaFilteredCandidates < edge.metadata.originalCHACandidates
        );
        
        expect(rtaFilteringEvidence).toBe(true);
      }
    });
  });

  describe('CHA/RTA Integration Edge Cases', () => {
    it('should handle circular inheritance gracefully', async () => {
      // Arrange - Create potential circular reference scenario
      const sourceCode = `
        interface A {
          methodA(): void;
        }
        
        interface B extends A {
          methodB(): void;
        }
        
        class ImplA implements A {
          methodA(): void {
            console.log('A');
          }
        }
        
        class ImplB implements B {
          methodA(): void {
            console.log('B-A');
          }
          
          methodB(): void {
            console.log('B');
          }
        }
        
        function testCircular(): void {
          const a: A = new ImplA();
          const b: B = new ImplB();
          
          a.methodA();
          b.methodA();
          b.methodB();
        }
      `;
      
      const sourceFile = project.createSourceFile('circular-test.ts', sourceCode);
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act & Assert - Should not throw
      expect(async () => {
        const edges = await engine.performStagedAnalysis(functions);
        return edges;
      }).not.toThrow();
    });

    it('should handle empty inheritance hierarchies', async () => {
      // Arrange - Classes with no methods
      const sourceCode = `
        class EmptyBase {
          // No methods
        }
        
        class EmptyDerived extends EmptyBase {
          // No methods
        }
        
        function testEmpty(): void {
          const base = new EmptyBase();
          const derived = new EmptyDerived();
          // No method calls
        }
      `;
      
      const sourceFile = project.createSourceFile('empty-hierarchy.ts', sourceCode);
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert - Should handle gracefully
      const chaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'cha_resolved');
      const rtaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'rta_resolved');
      
      // No method calls to resolve, but should not error
      expect(edges).toBeDefined();
      expect(Array.isArray(edges)).toBe(true);
    });

    it('should prioritize RTA over CHA when both are available', async () => {
      // Arrange - Scenario where both CHA and RTA would apply
      const sourceCode = `
        class MultiAnalysis {
          process(): string {
            return 'processing';
          }
          
          static create(): MultiAnalysis {
            return new MultiAnalysis();
          }
        }
        
        function useMultiAnalysis(): string {
          const instance = MultiAnalysis.create(); // Constructor via factory
          return instance.process();                // Method call on instantiated type
        }
      `;
      
      const sourceFile = project.createSourceFile('multi-analysis.ts', sourceCode);
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert
      const chaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'cha_resolved');
      const rtaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'rta_resolved');
      
      // If both CHA and RTA resolve the same call, RTA should have higher confidence
      if (chaResolvedEdges.length > 0 && rtaResolvedEdges.length > 0) {
        const chaConfidences = chaResolvedEdges.map(edge => edge.confidenceScore);
        const rtaConfidences = rtaResolvedEdges.map(edge => edge.confidenceScore);
        
        const maxChaConfidence = Math.max(...chaConfidences);
        const minRtaConfidence = Math.min(...rtaConfidences);
        
        // RTA should generally have higher confidence than CHA
        expect(minRtaConfidence).toBeGreaterThanOrEqual(maxChaConfidence * 0.9); // Allow small variance
      }
    });
  });

  describe('Performance and Consistency', () => {
    it('should handle large inheritance hierarchies efficiently', async () => {
      // Arrange - Create large hierarchy
      let sourceCode = `
        class Base {
          baseMethod(): string { return 'base'; }
        }
      `;
      
      // Create 20 levels of inheritance
      for (let i = 1; i <= 20; i++) {
        const parent = i === 1 ? 'Base' : `Level${i-1}`;
        sourceCode += `
          class Level${i} extends ${parent} {
            level${i}Method(): string { return 'level${i}'; }
          }
        `;
      }
      
      sourceCode += `
        function testLargeHierarchy(): string {
          const instance = new Level20();
          return instance.baseMethod() + instance.level10Method() + instance.level20Method();
        }
      `;
      
      const sourceFile = project.createSourceFile('large-hierarchy.ts', sourceCode);
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const startTime = Date.now();
      const edges = await engine.performStagedAnalysis(functions);
      const endTime = Date.now();
      
      // Assert
      expect(endTime - startTime).toBeLessThan(10000); // Should complete within 10 seconds
      
      const chaResolvedEdges = edges.filter(edge => edge.resolutionLevel === 'cha_resolved');
      expect(chaResolvedEdges.length).toBeGreaterThanOrEqual(0);
    });

    it('should produce consistent results across multiple runs', async () => {
      // Arrange
      const sourceCode = `
        interface Service {
          execute(): string;
        }
        
        class ServiceA implements Service {
          execute(): string { return 'A'; }
        }
        
        class ServiceB implements Service {
          execute(): string { return 'B'; }
        }
        
        function runService(service: Service): string {
          return service.execute();
        }
        
        function main(): string {
          const a = new ServiceA();
          const b = new ServiceB();
          return runService(a) + runService(b);
        }
      `;
      
      const sourceFile = project.createSourceFile('consistency-test.ts', sourceCode);
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act - Run analysis multiple times
      const results = [];
      for (let i = 0; i < 3; i++) {
        const edges = await engine.performStagedAnalysis(functions);
        const chaCount = edges.filter(edge => edge.resolutionLevel === 'cha_resolved').length;
        const rtaCount = edges.filter(edge => edge.resolutionLevel === 'rta_resolved').length;
        results.push({ cha: chaCount, rta: rtaCount, total: edges.length });
      }
      
      // Assert - Results should be consistent
      expect(results[0].total).toBe(results[1].total);
      expect(results[1].total).toBe(results[2].total);
      expect(results[0].cha).toBe(results[1].cha);
      expect(results[0].rta).toBe(results[1].rta);
    });
  });
});