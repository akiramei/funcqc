/**
 * Types Command - Command Protocol Implementation
 * 
 * TypeScript type analysis command with Command Protocol support
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { TypeDepsOptions } from './types.types';

export class TypesCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * typesコマンドはTYPE_SYSTEM分析が必要：
   * - TypeScript型システムの解析結果を使用
   */
  async getRequires(subCommand: string[]): Promise<DependencyType[]> {
    if (subCommand.length === 0) {
      return []; // Help display doesn't require analysis
    }
    
    // All types subcommands need TYPE_SYSTEM analysis
    return ['BASIC', 'TYPE_SYSTEM'];
  }
  
  /**
   * 実際の処理を実行
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    if (subCommand.length === 0) {
      this.showHelp();
      return;
    }

    const typesSubcommand = subCommand[0];
    const subArgs = subCommand.slice(1);

    switch (typesSubcommand) {
      case 'list':
        await this.executeList(env, subArgs);
        break;
      case 'health':
        await this.executeHealth(env, subArgs);
        break;
      case 'deps':
        await this.executeDeps(env, subArgs);
        break;
      case 'api':
        await this.executeApi(env, subArgs);
        break;
      case 'members':
        await this.executeMembers(env, subArgs);
        break;
      case 'coverage':
        await this.executeCoverage(env, subArgs);
        break;
      case 'cluster':
        await this.executeCluster(env, subArgs);
        break;
      case 'risk':
        await this.executeRisk(env, subArgs);
        break;
      case 'insights':
        await this.executeInsights(env, subArgs);
        break;
      case 'slices':
        await this.executeSlices(env, subArgs);
        break;
      case 'subsume':
        await this.executeSubsume(env, subArgs);
        break;
      case 'fingerprint':
        await this.executeFingerprint(env, subArgs);
        break;
      case 'converters':
        await this.executeConverters(env, subArgs);
        break;
      case 'cochange':
        await this.executeCochange(env, subArgs);
        break;
      default:
        console.log(`Unknown types subcommand: ${typesSubcommand}`);
        this.showHelp();
        break;
    }
  }

  /**
   * Show help for types commands
   */
  private showHelp(): void {
    console.log(`
Usage: funcqc types <subcommand> [options]

💾 Uses pre-analyzed type data from database
🧩 TypeScript type analysis (database-driven)

Available subcommands:
  list             📋 List TypeScript types from database
  health           🏥 Analyze type quality from database
  deps             🔗 Analyze type dependencies from database
  api              📊 Analyze type API design and surface area
  members          👥 Show detailed type member information
  coverage         📊 Analyze property usage coverage and patterns
  cluster          🎪 Analyze property clustering and co-occurrence patterns
  risk             ⚠️ Analyze dependency risk and change impact
  insights         🔍 Comprehensive type analysis combining all insights
  slices           🍰 Discover reusable property patterns across types
  subsume          🎯 Analyze structural subsumption and containment relationships
  fingerprint      🔍 Analyze behavioral fingerprints and function clustering
  converters       🔄 Analyze type conversion networks and canonical types
  cochange         📈 Analyze type co-evolution patterns from Git history

Use 'funcqc types <subcommand> --help' for detailed help on each subcommand.
    `);
  }

  /**
   * Execute list subcommand
   */
  private async executeList(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesListDB } = await import('./types/subcommands/list');
    const options = this.parseListOptions(args);
    const listCommand = executeTypesListDB(options);
    await listCommand(env);
  }

  /**
   * Execute health subcommand
   */
  private async executeHealth(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesHealthDB } = await import('./types/subcommands/health');
    const options = this.parseHealthOptions(args);
    const healthCommand = executeTypesHealthDB(options);
    await healthCommand(env);
  }

  /**
   * Execute deps subcommand
   */
  private async executeDeps(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesDepsDB } = await import('./types/subcommands/deps');
    if (args.length === 0 || args[0].startsWith('--')) {
      console.error('Error: Type name is required for deps command');
      return;
    }
    const typeName = args[0];
    const options = this.parseDepsOptions(args.slice(1));
    // Include typeName in options for compatibility
    const optionsWithTypeName = { ...options, typeName } as TypeDepsOptions;
    const depsCommand = executeTypesDepsDB(optionsWithTypeName);
    await depsCommand(env);
  }

  /**
   * Execute api subcommand
   */
  private async executeApi(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesApiDB } = await import('./types/subcommands/api');
    if (args.length === 0 || args[0].startsWith('--')) {
      console.error('Error: Type name is required for api command');
      return;
    }
    const typeName = args[0];
    const options = this.parseApiOptions(args.slice(1));
    const optionsWithTypeName = { ...options, typeName };
    const apiCommand = executeTypesApiDB(optionsWithTypeName);
    await apiCommand(env);
  }

  /**
   * Execute members subcommand
   */
  private async executeMembers(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesMembersDB } = await import('./types/subcommands/members');
    if (args.length === 0 || args[0].startsWith('--')) {
      console.error('Error: Type name is required for members command');
      return;
    }
    const typeName = args[0];
    const options = this.parseMembersOptions(args.slice(1));
    const optionsWithTypeName = { ...options, typeName };
    const membersCommand = executeTypesMembersDB(optionsWithTypeName);
    await membersCommand(env);
  }

  /**
   * Execute coverage subcommand
   */
  private async executeCoverage(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesCoverageDB } = await import('./types/subcommands/coverage');
    if (args.length === 0 || args[0].startsWith('--')) {
      console.error('Error: Type name is required for coverage command');
      return;
    }
    const typeName = args[0];
    const options = this.parseCoverageOptions(args.slice(1));
    const optionsWithTypeName = { ...options, typeName };
    const coverageCommand = executeTypesCoverageDB(optionsWithTypeName);
    await coverageCommand(env);
  }

  /**
   * Execute cluster subcommand
   */
  private async executeCluster(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesClusterDB } = await import('./types/subcommands/cluster');
    if (args.length === 0 || args[0].startsWith('--')) {
      console.error('Error: Type name is required for cluster command');
      return;
    }
    const typeName = args[0];
    const options = this.parseClusterOptions(args.slice(1));
    const optionsWithTypeName = { ...options, typeName };
    const clusterCommand = executeTypesClusterDB(optionsWithTypeName);
    await clusterCommand(env);
  }

  /**
   * Execute risk subcommand
   */
  private async executeRisk(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesRiskDB } = await import('./types/subcommands/risk');
    if (args.length === 0 || args[0].startsWith('--')) {
      console.error('Error: Type name is required for risk command');
      return;
    }
    const typeName = args[0];
    const options = this.parseRiskOptions(args.slice(1));
    const optionsWithTypeName = { ...options, typeName };
    const riskCommand = executeTypesRiskDB(optionsWithTypeName);
    await riskCommand(env);
  }

  /**
   * Execute insights subcommand
   */
  private async executeInsights(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesInsightsDB } = await import('./types/subcommands/insights');
    if (args.length === 0 || args[0].startsWith('--')) {
      console.error('Error: Type name is required for insights command');
      return;
    }
    const typeName = args[0];
    const options = this.parseInsightsOptions(args.slice(1));
    const optionsWithTypeName = { ...options, typeName };
    const insightsCommand = executeTypesInsightsDB(optionsWithTypeName);
    await insightsCommand(env);
  }

  /**
   * Execute slices subcommand
   */
  private async executeSlices(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesSlicesDB } = await import('./types/subcommands/slices');
    const options = this.parseSlicesOptions(args);
    const slicesCommand = executeTypesSlicesDB(options);
    await slicesCommand(env);
  }

  /**
   * Execute subsume subcommand
   */
  private async executeSubsume(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesSubsumeDB } = await import('./types/subcommands/subsume');
    const options = this.parseSubsumeOptions(args);
    const subsumeCommand = executeTypesSubsumeDB(options);
    await subsumeCommand(env);
  }

  /**
   * Execute fingerprint subcommand
   */
  private async executeFingerprint(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesFingerprintDB } = await import('./types/subcommands/fingerprint');
    const options = this.parseFingerprintOptions(args);
    const fingerprintCommand = executeTypesFingerprintDB(options);
    await fingerprintCommand(env);
  }

  /**
   * Execute converters subcommand
   */
  private async executeConverters(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesConvertersDB } = await import('./types/subcommands/converters');
    const options = this.parseConvertersOptions(args);
    const convertersCommand = executeTypesConvertersDB(options);
    await convertersCommand(env);
  }

  /**
   * Execute cochange subcommand
   */
  private async executeCochange(env: CommandEnvironment, args: string[]): Promise<void> {
    const { executeTypesCochangeDB } = await import('./types/subcommands/cochange');
    const options = this.parseCochangeOptions(args);
    const cochangeCommand = executeTypesCochangeDB(options);
    await cochangeCommand(env);
  }

  // Option parsing methods - simplified for brevity
  private parseListOptions(args: string[]): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    // Parse common options
    if (args.includes('--json')) options['json'] = true;
    // Add more option parsing as needed
    return options;
  }

  private parseHealthOptions(args: string[]): Record<string, unknown> {
    return this.parseListOptions(args);
  }

  private parseDepsOptions(args: string[]): Record<string, unknown> {
    return this.parseListOptions(args);
  }

  private parseApiOptions(args: string[]): Record<string, unknown> {
    return this.parseListOptions(args);
  }

  private parseMembersOptions(args: string[]): Record<string, unknown> {
    return this.parseListOptions(args);
  }

  private parseCoverageOptions(args: string[]): Record<string, unknown> {
    return this.parseListOptions(args);
  }

  private parseClusterOptions(args: string[]): Record<string, unknown> {
    return this.parseListOptions(args);
  }

  private parseRiskOptions(args: string[]): Record<string, unknown> {
    return this.parseListOptions(args);
  }

  private parseInsightsOptions(args: string[]): Record<string, unknown> {
    return this.parseListOptions(args);
  }

  private parseSlicesOptions(args: string[]): Record<string, unknown> {
    return this.parseListOptions(args);
  }

  private parseSubsumeOptions(args: string[]): Record<string, unknown> {
    return this.parseListOptions(args);
  }

  private parseFingerprintOptions(args: string[]): Record<string, unknown> {
    return this.parseListOptions(args);
  }

  private parseConvertersOptions(args: string[]): Record<string, unknown> {
    return this.parseListOptions(args);
  }

  private parseCochangeOptions(args: string[]): Record<string, unknown> {
    return this.parseListOptions(args);
  }
}