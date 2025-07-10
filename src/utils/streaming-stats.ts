/**
 * Streaming statistics implementation using Welford's online algorithm
 * Provides O(1) updates and real-time anomaly detection for quality metrics
 */

/**
 * Configuration for streaming statistics behavior
 */
export interface StreamingStatsConfig {
  /** Minimum samples before statistical measures are reliable */
  minSamples: number;
  /** Z-score threshold for anomaly detection */
  anomalyThreshold: number;
  /** Whether to track variance (slightly more expensive) */
  trackVariance: boolean;
}

/**
 * Statistical summary data
 */
export interface StatsSummary {
  count: number;
  mean: number;
  variance: number;
  standardDeviation: number;
  min: number;
  max: number;
  isReliable: boolean; // true if count >= minSamples
}

/**
 * Anomaly detection result
 */
export interface AnomalyResult {
  value: number;
  zScore: number;
  isAnomaly: boolean;
  severity: 'normal' | 'warning' | 'critical';
  confidence: number; // 0-1, based on sample size
}

/**
 * High-performance streaming statistics using Welford's online algorithm
 * 
 * Features:
 * - O(1) time complexity for all operations
 * - Numerically stable variance calculation
 * - Real-time anomaly detection
 * - Memory efficient (constant space)
 * 
 * Usage:
 * ```typescript
 * const stats = new StreamingStats();
 * stats.push(10);
 * stats.push(12);
 * const anomaly = stats.detectAnomaly(25); // Check if 25 is anomalous
 * ```
 */
export class StreamingStats {
  private count = 0;
  private mean = 0;
  private m2 = 0; // Sum of squares of deviations from mean
  private minValue = Number.POSITIVE_INFINITY;
  private maxValue = Number.NEGATIVE_INFINITY;
  private config: StreamingStatsConfig;

  constructor(config: Partial<StreamingStatsConfig> = {}) {
    this.config = {
      minSamples: 10,
      anomalyThreshold: 2.0,
      trackVariance: true,
      ...config
    };
  }

  /**
   * Add a new value to the streaming statistics
   * 
   * @param value The new value to incorporate
   * @returns This instance for chaining
   */
  push(value: number): this {
    if (!Number.isFinite(value)) {
      throw new Error('Value must be a finite number');
    }

    this.count++;
    
    // Update min/max
    this.minValue = Math.min(this.minValue, value);
    this.maxValue = Math.max(this.maxValue, value);

    if (this.config.trackVariance) {
      // Welford's online algorithm for mean and variance
      const delta = value - this.mean;
      this.mean += delta / this.count;
      const delta2 = value - this.mean;
      this.m2 += delta * delta2;
    } else {
      // Simple mean calculation (faster when variance not needed)
      this.mean = this.mean + (value - this.mean) / this.count;
    }

    return this;
  }

  /**
   * Get the current mean value
   */
  get currentMean(): number {
    return this.count === 0 ? 0 : this.mean;
  }

  /**
   * Get the current sample variance
   */
  get currentVariance(): number {
    if (!this.config.trackVariance || this.count < 2) {
      return 0;
    }
    return this.m2 / (this.count - 1);
  }

  /**
   * Get the current standard deviation
   */
  get currentStandardDeviation(): number {
    return Math.sqrt(this.currentVariance);
  }

  /**
   * Get the current sample count
   */
  get sampleCount(): number {
    return this.count;
  }

  /**
   * Check if statistics are reliable (enough samples)
   */
  get isReliable(): boolean {
    return this.count >= this.config.minSamples;
  }

  /**
   * Calculate Z-score for a given value
   * 
   * @param value The value to calculate Z-score for
   * @returns Z-score (standard deviations from mean)
   */
  zScore(value: number): number {
    if (this.count === 0) return 0;
    if (!this.config.trackVariance) {
      throw new Error('Z-score calculation requires variance tracking');
    }
    
    const stdDev = this.currentStandardDeviation;
    if (stdDev === 0) return 0;
    
    return (value - this.mean) / stdDev;
  }

  /**
   * Detect if a value is anomalous based on Z-score
   * 
   * @param value The value to test for anomaly
   * @returns Anomaly detection result
   */
  detectAnomaly(value: number): AnomalyResult {
    const zScore = this.zScore(value);
    const absZScore = Math.abs(zScore);
    
    // Calculate confidence based on sample size
    const confidence = Math.min(this.count / this.config.minSamples, 1.0);
    
    // Determine severity
    let severity: AnomalyResult['severity'] = 'normal';
    let isAnomaly = false;
    
    if (absZScore > this.config.anomalyThreshold) {
      isAnomaly = true;
      if (absZScore > this.config.anomalyThreshold * 1.5) {
        severity = 'critical';
      } else {
        severity = 'warning';
      }
    }

    return {
      value,
      zScore,
      isAnomaly,
      severity,
      confidence
    };
  }

  /**
   * Get comprehensive statistical summary
   */
  getSummary(): StatsSummary {
    return {
      count: this.count,
      mean: this.currentMean,
      variance: this.currentVariance,
      standardDeviation: this.currentStandardDeviation,
      min: this.count === 0 ? 0 : this.minValue,
      max: this.count === 0 ? 0 : this.maxValue,
      isReliable: this.isReliable
    };
  }

  /**
   * Reset all statistics to initial state
   */
  reset(): void {
    this.count = 0;
    this.mean = 0;
    this.m2 = 0;
    this.minValue = Number.POSITIVE_INFINITY;
    this.maxValue = Number.NEGATIVE_INFINITY;
  }

  /**
   * Create a copy of this StreamingStats instance
   */
  clone(): StreamingStats {
    const cloned = new StreamingStats(this.config);
    cloned.count = this.count;
    cloned.mean = this.mean;
    cloned.m2 = this.m2;
    cloned.minValue = this.minValue;
    cloned.maxValue = this.maxValue;
    return cloned;
  }

  /**
   * Merge another StreamingStats instance into this one
   * 
   * @param other The other StreamingStats instance to merge
   */
  merge(other: StreamingStats): void {
    if (other.count === 0) return;
    if (this.count === 0) {
      this.count = other.count;
      this.mean = other.mean;
      this.m2 = other.m2;
      this.minValue = other.minValue;
      this.maxValue = other.maxValue;
      return;
    }

    // Merge using parallel algorithm
    const newCount = this.count + other.count;
    const delta = other.mean - this.mean;
    const newMean = (this.count * this.mean + other.count * other.mean) / newCount;
    
    if (this.config.trackVariance) {
      const newM2 = this.m2 + other.m2 + delta * delta * this.count * other.count / newCount;
      this.m2 = newM2;
    }
    
    this.count = newCount;
    this.mean = newMean;
    this.minValue = Math.min(this.minValue, other.minValue);
    this.maxValue = Math.max(this.maxValue, other.maxValue);
  }

  /**
   * Export state for serialization
   */
  export(): Record<string, unknown> {
    return {
      count: this.count,
      mean: this.mean,
      m2: this.m2,
      minValue: this.minValue === Number.POSITIVE_INFINITY ? null : this.minValue,
      maxValue: this.maxValue === Number.NEGATIVE_INFINITY ? null : this.maxValue,
      config: this.config
    };
  }

  /**
   * Import state from serialization
   */
  static import(data: Record<string, unknown>): StreamingStats {
    const stats = new StreamingStats(data['config'] as StreamingStatsConfig);
    stats.count = data['count'] as number;
    stats.mean = data['mean'] as number;
    stats.m2 = data['m2'] as number;
    stats.minValue = data['minValue'] === null ? Number.POSITIVE_INFINITY : data['minValue'] as number;
    stats.maxValue = data['maxValue'] === null ? Number.NEGATIVE_INFINITY : data['maxValue'] as number;
    return stats;
  }
}

/**
 * Multi-metric streaming statistics manager
 * Efficiently manages statistics for multiple metrics simultaneously
 */
export class MultiMetricStats {
  private stats = new Map<string, StreamingStats>();
  private config: StreamingStatsConfig;

  constructor(config: Partial<StreamingStatsConfig> = {}) {
    this.config = {
      minSamples: 10,
      anomalyThreshold: 2.0,
      trackVariance: true,
      ...config
    };
  }

  /**
   * Update statistics for a specific metric
   */
  updateMetric(metricName: string, value: number): void {
    if (!this.stats.has(metricName)) {
      this.stats.set(metricName, new StreamingStats(this.config));
    }
    this.stats.get(metricName)!.push(value);
  }

  /**
   * Get statistics for a specific metric
   */
  getMetricStats(metricName: string): StreamingStats | undefined {
    return this.stats.get(metricName);
  }

  /**
   * Detect anomalies across all metrics
   */
  detectAnomalies(values: Record<string, number>): Record<string, AnomalyResult> {
    const results: Record<string, AnomalyResult> = {};
    
    for (const [metricName, value] of Object.entries(values)) {
      const stats = this.stats.get(metricName);
      if (stats) {
        results[metricName] = stats.detectAnomaly(value);
      }
    }
    
    return results;
  }

  /**
   * Get summary for all tracked metrics
   */
  getAllSummaries(): Record<string, StatsSummary> {
    const summaries: Record<string, StatsSummary> = {};
    
    for (const [metricName, stats] of this.stats) {
      summaries[metricName] = stats.getSummary();
    }
    
    return summaries;
  }

  /**
   * Get list of tracked metric names
   */
  getMetricNames(): string[] {
    return Array.from(this.stats.keys());
  }

  /**
   * Reset statistics for all metrics
   */
  resetAll(): void {
    for (const stats of this.stats.values()) {
      stats.reset();
    }
  }

  /**
   * Clear all tracked metrics
   */
  clear(): void {
    this.stats.clear();
  }
}