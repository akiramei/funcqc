/**
 * Performance metrics and profiling utilities for call graph analysis
 */

export interface PerformanceMetrics {
  totalTime: number;
  phases: Record<string, PhaseMetrics>;
  memory: MemoryMetrics;
}

export interface PhaseMetrics {
  duration: number;
  count: number;
  averageDuration: number;
  details?: Record<string, number>;
}

export interface MemoryMetrics {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

export class PerformanceProfiler {
  private startTime: number = 0;
  private phases: Map<string, PhaseData> = new Map();
  private currentPhase: string | null = null;
  private phaseStartTime: number = 0;

  constructor(private name: string = 'Analysis') {}

  start(): void {
    this.startTime = performance.now();
  }

  startPhase(phaseName: string): void {
    if (this.currentPhase) {
      this.endPhase();
    }
    this.currentPhase = phaseName;
    this.phaseStartTime = performance.now();
  }

  endPhase(): void {
    if (!this.currentPhase) return;

    const duration = performance.now() - this.phaseStartTime;
    const existing = this.phases.get(this.currentPhase) || { 
      totalDuration: 0, 
      count: 0, 
      details: new Map() 
    };

    existing.totalDuration += duration;
    existing.count += 1;

    this.phases.set(this.currentPhase, existing);
    this.currentPhase = null;
  }

  recordDetail(phaseName: string, detailName: string, value: number): void {
    const phase = this.phases.get(phaseName) || { 
      totalDuration: 0, 
      count: 0, 
      details: new Map() 
    };
    
    const currentValue = phase.details.get(detailName) || 0;
    phase.details.set(detailName, currentValue + value);
    this.phases.set(phaseName, phase);
  }

  getMetrics(): PerformanceMetrics {
    this.endPhase(); // End current phase if active

    const totalTime = performance.now() - this.startTime;
    const phases: Record<string, PhaseMetrics> = {};

    for (const [name, data] of this.phases) {
      phases[name] = {
        duration: data.totalDuration,
        count: data.count,
        averageDuration: data.count > 0 ? data.totalDuration / data.count : 0,
        details: Object.fromEntries(data.details)
      };
    }

    return {
      totalTime,
      phases,
      memory: this.getMemoryMetrics()
    };
  }

  private getMemoryMetrics(): MemoryMetrics {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      external: Math.round(memUsage.external / 1024 / 1024), // MB
      arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024) // MB
    };
  }

  printSummary(): void {
    const metrics = this.getMetrics();
    
    console.log(`\n📊 Performance Summary - ${this.name}`);
    console.log(`⏱️  Total Time: ${metrics.totalTime.toFixed(2)}ms`);
    console.log(`🧠 Memory: ${metrics.memory.heapUsed}MB used / ${metrics.memory.heapTotal}MB total`);
    
    console.log('\n📈 Phase Breakdown:');
    for (const [name, phase] of Object.entries(metrics.phases)) {
      const percentage = ((phase.duration / metrics.totalTime) * 100).toFixed(1);
      console.log(`  ${name}: ${phase.duration.toFixed(2)}ms (${percentage}%) - ${phase.count} calls, avg ${phase.averageDuration.toFixed(2)}ms`);
      
      if (phase.details && Object.keys(phase.details).length > 0) {
        for (const [detail, value] of Object.entries(phase.details)) {
          console.log(`    └─ ${detail}: ${value}`);
        }
      }
    }
  }
}

interface PhaseData {
  totalDuration: number;
  count: number;
  details: Map<string, number>;
}

/**
 * Decorator for measuring method performance
 */
export function measurePerformance<T extends (...args: unknown[]) => unknown>(
  _target: object,
  propertyKey: string,
  descriptor: TypedPropertyDescriptor<T>
): TypedPropertyDescriptor<T> {
  const originalMethod = descriptor.value!;

  descriptor.value = function(this: unknown, ...args: Parameters<T>) {
    const start = performance.now();
    const result = originalMethod.apply(this, args) as ReturnType<T>;
    const duration = performance.now() - start;

    // If the instance has a profiler, record the measurement
    if (this && typeof this === 'object' && 'profiler' in this) {
      const profiler = (this as { profiler: unknown }).profiler;
      if (profiler instanceof PerformanceProfiler) {
        profiler.recordDetail('method_calls', propertyKey, duration);
      }
    }

    return result;
  } as T;

  return descriptor;
}

/**
 * Utility for measuring async operations
 */
export async function measureAsync<T>(
  operation: () => Promise<T>,
  profiler: PerformanceProfiler,
  phaseName: string
): Promise<T> {
  profiler.startPhase(phaseName);
  try {
    const result = await operation();
    return result;
  } finally {
    profiler.endPhase();
  }
}

/**
 * Utility for measuring sync operations
 */
export function measureSync<T>(
  operation: () => T,
  profiler: PerformanceProfiler,
  phaseName: string
): T {
  profiler.startPhase(phaseName);
  try {
    return operation();
  } finally {
    profiler.endPhase();
  }
}