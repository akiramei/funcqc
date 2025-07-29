import chalk from 'chalk';
import { CallEdge } from '../../types';
import { RouteComplexityInfo, DependencyTreeNode, DepShowOptions } from './types';
import { getCallTypeColor } from './utils';

/**
 * Output dependency show as JSON
 */
export function outputDepShowJSON(func: { id: string; name: string; file_path?: string; start_line?: number }, dependencies: DependencyTreeNode): void {
  const result = {
    function: func,
    dependencies,
  };
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Display header information for dependency analysis
 */
function displayDependencyAnalysisHeader(
  func: { id: string; name: string; file_path?: string; start_line?: number }
): void {
  console.log(chalk.bold(`\nDependency Analysis for: ${chalk.cyan(func.name)}`));
  console.log(chalk.gray(`ID: ${func.id}`));
  console.log(chalk.gray(`File: ${func.file_path}:${func.start_line}`));
  console.log();
}

/**
 * Display individual route with complexity breakdown
 */
function displayRouteComplexityBreakdown(route: RouteComplexityInfo, index: number): void {
  console.log(chalk.bold(`Route ${index + 1} (Depth: ${route.totalDepth}, Total Complexity: ${route.totalComplexity})`));
  
  route.complexityBreakdown.forEach((breakdown, pathIndex) => {
    const isLast = pathIndex === route.complexityBreakdown.length - 1;
    const connector = pathIndex === 0 ? '  ' : isLast ? '      └─→ ' : '      ├─→ ';
    const complexityInfo = chalk.gray(`(CC: ${breakdown.cyclomaticComplexity})`);
    
    if (pathIndex === 0) {
      console.log(`  ${chalk.cyan(breakdown.functionName)} ${complexityInfo}`);
    } else {
      console.log(`${connector}${chalk.green(breakdown.functionName)} ${complexityInfo}`);
    }
  });
  
  console.log();
}

/**
 * Calculate and display complexity summary statistics
 */
function displayComplexitySummary(routes: RouteComplexityInfo[]): void {
  if (routes.length <= 1) return;

  const maxComplexity = Math.max(...routes.map(r => r.totalComplexity));
  const avgComplexity = routes.reduce((sum, r) => sum + r.totalComplexity, 0) / routes.length;
  const maxComplexityRoute = routes.find(r => r.totalComplexity === maxComplexity);
  
  console.log(chalk.bold('📈 Complexity Summary:'));
  if (maxComplexityRoute) {
    console.log(`  Highest complexity route: Route ${routes.indexOf(maxComplexityRoute) + 1} (${maxComplexity})`);
  }
  console.log(`  Average route complexity: ${avgComplexity.toFixed(1)}`);
  
  const allFunctions = routes.flatMap(r => r.complexityBreakdown);
  if (allFunctions.length > 0) {
    const mostComplexFunction = allFunctions.reduce((max, current) => 
      current.cyclomaticComplexity > max.cyclomaticComplexity ? current : max
    );
    console.log(`  Most complex single function: ${mostComplexFunction.functionName} (${mostComplexFunction.cyclomaticComplexity})`);
  }
  console.log();
}

/**
 * Display route complexity analysis for all routes
 */
function displayRouteComplexityAnalysis(routes: RouteComplexityInfo[]): void {
  console.log(chalk.bold('📊 Longest Routes (by depth):'));
  console.log();
  
  routes.forEach((route, index) => {
    displayRouteComplexityBreakdown(route, index);
  });
  
  displayComplexitySummary(routes);
}

/**
 * Display Commander.js virtual callback edge
 */
function displayCommanderVirtualEdge(
  dep: { direction: 'in' | 'out'; edge: CallEdge; subtree: DependencyTreeNode | null },
  newPrefix: string,
  isLastDep: boolean,
  arrow: string,
  functionMap?: Map<string, { id: string; name: string; filePath: string; startLine: number }>,
  printTree?: (node: DependencyTreeNode | null, prefix: string, isLast: boolean) => void
): void {
  const triggerMethod = (dep.edge.metadata as Record<string, unknown>)?.['triggerMethod'] as string;
  const programCall = `program.${triggerMethod || 'parseAsync'}`;
  
  let locationInfo = `line ${dep.edge.lineNumber}`;
  if (functionMap && dep.edge.callerFunctionId) {
    const callerFunc = functionMap.get(dep.edge.callerFunctionId);
    if (callerFunc?.filePath) {
      locationInfo = `${callerFunc.filePath}:${dep.edge.lineNumber}`;
    }
  }
  
  console.log(`${newPrefix}${isLastDep ? '└── ' : '├── '}${arrow} ${chalk.yellow('external')} ${chalk.gray(`(${locationInfo})`)}`);
  console.log(`${newPrefix + (isLastDep ? '    ' : '│   ')}└── ${chalk.dim(programCall)} ${chalk.gray('(external)')}`);
  
  if (dep.subtree) {
    const commandDisplayName = `${dep.subtree.name} ${chalk.cyan('[command]')}`;
    console.log(`${newPrefix + (isLastDep ? '        ' : '│       ')}└── ${commandDisplayName}`);
    
    if (dep.subtree.dependencies.length > 0 && printTree) {
      printTree(dep.subtree, newPrefix + (isLastDep ? '        ' : '│       '), true);
    }
  }
}

/**
 * Get location information for edge display
 */
function getEdgeLocationInfo(
  dep: { direction: 'in' | 'out'; edge: CallEdge; subtree: DependencyTreeNode | null },
  functionMap?: Map<string, { id: string; name: string; filePath: string; startLine: number }>
): string {
  let locationInfo = `line ${dep.edge.lineNumber}`;
  if (functionMap) {
    const relevantFuncId = dep.direction === 'out' ? dep.edge.callerFunctionId : dep.edge.calleeFunctionId;
    if (relevantFuncId) {
      const func = functionMap.get(relevantFuncId);
      if (func?.filePath) {
        locationInfo = `${func.filePath}:${dep.edge.lineNumber}`;
      }
    }
  }
  return locationInfo;
}

/**
 * Display subtree node with appropriate indicators
 */
function displaySubtreeNode(
  subtree: DependencyTreeNode,
  newPrefix: string,
  isLastDep: boolean,
  printTree: (node: DependencyTreeNode | null, prefix: string, isLast: boolean) => void
): void {
  let nodeDisplayName = subtree.name;
  if (subtree.isVirtual && subtree.frameworkInfo) {
    nodeDisplayName = `${subtree.name} ${chalk.cyan(`[${subtree.frameworkInfo}]`)}`;
  } else if (subtree.isExternal) {
    nodeDisplayName = `${subtree.name} ${chalk.gray('(external)')}`;
  }
  
  console.log(`${newPrefix + (isLastDep ? '    ' : '│   ')}└── ${nodeDisplayName}`);
  
  if (subtree.dependencies.length > 0) {
    printTree(subtree, newPrefix + (isLastDep ? '    ' : '│   '), true);
  }
}

/**
 * Display dependency tree structure recursively
 */
function displayDependencyTree(
  dependencies: DependencyTreeNode,
  functionMap?: Map<string, { id: string; name: string; filePath: string; startLine: number }>
): void {
  
  function printTree(node: DependencyTreeNode | null, prefix: string = '', isLast: boolean = true): void {
    if (!node) return;

    const connector = isLast ? '└── ' : '├── ';
    const isExternal = node.isExternal;
    const nameColor = node.depth === 0 ? chalk.bold.cyan : (isExternal ? chalk.dim : chalk.green);
    const idDisplay = isExternal ? 'external' : node.id?.substring(0, 8);
    
    console.log(`${prefix}${connector}${nameColor(node.name)} ${chalk.gray(`(${idDisplay})`)}`);
    
    if (node.dependencies.length > 0) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      
      node.dependencies.forEach((dep, index: number) => {
        const isLastDep = index === node.dependencies.length - 1;
        const arrow = dep.direction === 'in' ? '←' : '→';
        const typeColor = getCallTypeColor(dep.edge.callType);
        
        // Handle virtual callback edges (Commander.js specific)
        if (dep.edge.callType === 'virtual' && 
            (dep.edge.metadata as Record<string, unknown>)?.['framework'] === 'commander' &&
            (dep.edge.metadata as Record<string, unknown>)?.['displayHint'] === 'commander_dispatch') {
          
          displayCommanderVirtualEdge(dep, newPrefix, isLastDep, arrow, functionMap, printTree);
          return;
        }
        
        // Get file path for the edge
        const locationInfo = getEdgeLocationInfo(dep, functionMap);
        console.log(`${newPrefix}${isLastDep ? '└── ' : '├── '}${arrow} ${typeColor(dep.edge.callType)} ${chalk.gray(`(${locationInfo})`)}`);
        
        if (dep.subtree) {
          displaySubtreeNode(dep.subtree, newPrefix, isLastDep, printTree);
        }
      });
    }
  }

  printTree(dependencies);
  console.log();
}

/**
 * Output dependency show in formatted tree
 */
export function outputDepShowFormatted(
  func: { id: string; name: string; file_path?: string; start_line?: number }, 
  dependencies: DependencyTreeNode, 
  options: DepShowOptions,
  functionMap?: Map<string, { id: string; name: string; filePath: string; startLine: number }>
): void {
  displayDependencyAnalysisHeader(func);

  // Show route complexity analysis if available
  if (options.showComplexity && dependencies.routes && dependencies.routes.length > 0) {
    displayRouteComplexityAnalysis(dependencies.routes);
  }

  displayDependencyTree(dependencies, functionMap);
}