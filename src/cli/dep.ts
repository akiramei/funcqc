// Re-export all dep subcommands from their individual files
export { depListCommand } from './dep/list';
export { depShowCommand } from './dep/show';
export { depStatsCommand } from './dep/stats';
export { depLintCommand } from './dep/lint';
export { depDeadCommand } from './dep/dead';
export { depCyclesCommand } from './dep/cycles';

// Re-export shared types
export type {
  RouteComplexityInfo,
  DepListOptions,
  DepShowOptions,
  DepStatsOptions,
  DepLintOptions,
  DepDeadOptions,
  DepCyclesOptions,
  DependencyTreeNode,
  DependencyTreeConfig
} from './dep/types';

// Re-export utility functions for external use
export {
  findTargetFunction,
  createQualityMetricsMap,
  parseNumericOption,
  getCallTypeColor,
  calculateRouteComplexity,
  buildDependencyTree
} from './dep/utils';

// Re-export output functions for external use
export {
  outputDepShowJSON,
  outputDepShowFormatted
} from './dep/output';