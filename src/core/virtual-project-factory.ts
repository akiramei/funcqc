/**
 * Virtual Project Factory
 * 
 * Provides unified virtual project creation from database content.
 * Ensures consistent file path handling and project configuration.
 */

import { Project, ProjectOptions } from 'ts-morph';
import chalk from 'chalk';

export interface VirtualProjectConfig {
  /**
   * Whether to include library files
   * @default false
   */
  includeLibFiles?: boolean;
  
  /**
   * Whether to skip TypeScript config loading
   * @default true
   */
  skipTsConfig?: boolean;
  
  /**
   * Additional compiler options
   */
  compilerOptions?: Record<string, unknown>;
}

export interface VirtualProjectResult {
  project: Project;
  fileCount: number;
  creationTimeMs: number;
}

export class VirtualProjectFactory {
  /**
   * Create virtual project from file content map
   * Uses original file paths (no /virtual prefix) for Function ID consistency
   */
  static async createFromContent(
    fileContentMap: Map<string, string>,
    config: VirtualProjectConfig = {}
  ): Promise<VirtualProjectResult> {
    const startTime = performance.now();
    
    // Configure project options for optimal virtual project performance
    const projectOptions: ProjectOptions = {
      skipAddingFilesFromTsConfig: config.skipTsConfig ?? true,
      skipLoadingLibFiles: !config.includeLibFiles,
      skipFileDependencyResolution: true,
      useInMemoryFileSystem: true, // Always use in-memory filesystem
      compilerOptions: {
        isolatedModules: true,
        noResolve: true,
        skipLibCheck: true,
        noLib: true,
        ...config.compilerOptions
      }
    };
    
    const project = new Project(projectOptions);
    
    // Add virtual source files using ORIGINAL file paths
    // This ensures Function IDs are consistent with database storage
    for (const [filePath, content] of fileContentMap) {
      project.createSourceFile(filePath, content, { overwrite: true });
    }
    
    const endTime = performance.now();
    const creationTimeMs = endTime - startTime;
    
    // Virtual project creation completed
    
    return {
      project,
      fileCount: project.getSourceFiles().length,
      creationTimeMs
    };
  }
  
  /**
   * Create virtual project with physical file system compatibility
   * For scenarios where file paths need to be compatible with physical analysis
   */
  static async createCompatible(
    fileContentMap: Map<string, string>,
    config: VirtualProjectConfig = {}
  ): Promise<VirtualProjectResult> {
    // Use the same logic as createFromContent for now
    // Future enhancement: add specific compatibility features if needed
    return this.createFromContent(fileContentMap, config);
  }
  
  /**
   * Get recommended project configuration for different analysis types
   */
  static getRecommendedConfig(analysisType: 'basic' | 'call-graph' | 'type-system'): VirtualProjectConfig {
    const baseConfig: VirtualProjectConfig = {
      skipTsConfig: true,
      includeLibFiles: false
    };
    
    switch (analysisType) {
      case 'basic':
        return {
          ...baseConfig,
          compilerOptions: {
            isolatedModules: true,
            noResolve: true,
            skipLibCheck: true,
            noLib: true
          }
        };
        
      case 'call-graph':
        return {
          ...baseConfig,
          compilerOptions: {
            isolatedModules: true,
            noResolve: true,
            skipLibCheck: true,
            noLib: true
          }
        };
        
      case 'type-system':
        return {
          ...baseConfig,
          includeLibFiles: true, // Type analysis may need lib files
          compilerOptions: {
            isolatedModules: false,
            noResolve: false,
            skipLibCheck: false,
            noLib: false
          }
        };
        
      default:
        return baseConfig;
    }
  }
}