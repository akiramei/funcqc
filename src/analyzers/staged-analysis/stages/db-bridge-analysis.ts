import { Logger } from '../../../utils/cli-utils';
import { StorageAdapter } from '../../../types';
import { AnalysisState } from '../types';
import { UnresolvedMethodCall } from '../../cha-analyzer';
import { FunctionMetadata, ResolutionLevel } from '../../ideal-call-graph-analyzer';
import { addEdge } from '../../shared/graph-utils';
import { generateStableEdgeId } from '../../../utils/edge-id-generator';

/**
 * DB Bridge Analysis Stage
 *
 * Uses persisted type system information (type_definitions/type_members/type_relationships)
 * to resolve unresolved method calls conservatively.
 *
 * Strategy:
 * - If receiverType is a class: find method member by name and map to functionId
 * - If receiverType is an interface: find implementing classes, then method members by name
 * - Only add edges when functionId exists and is part of current function registry
 */
export class DBBridgeAnalysisStage {
  private storage: StorageAdapter;
  private logger: Logger;

  constructor(storage: StorageAdapter, logger?: Logger) {
    this.storage = storage;
    this.logger = logger ?? new Logger(false);
  }

  async performDBBridgeResolution(
    functions: Map<string, FunctionMetadata>,
    unresolved: UnresolvedMethodCall[],
    snapshotId: string,
    state: AnalysisState
  ): Promise<{ resolvedEdges: number; unresolvedRemaining: UnresolvedMethodCall[] }> {
    if (unresolved.length === 0) {
      return { resolvedEdges: 0, unresolvedRemaining: [] };
    }

    const unresolvedRemaining: UnresolvedMethodCall[] = [];
    let resolvedEdges = 0;

    for (const call of unresolved) {
      // Require receiver type and method name for safe bridging
      if (!call.receiverType || !call.methodName) {
        unresolvedRemaining.push(call);
        continue;
      }

      try {
        const typeDef = await this.storage.findTypeByName(call.receiverType, snapshotId);
        if (!typeDef) {
          unresolvedRemaining.push(call);
          continue;
        }

        const candidateFunctionIds = new Set<string>();

        if (typeDef.kind === 'class') {
          // Search methods in the class and its parent chain (extends)
          const searchTypeIds = await this.collectClassAndParents(typeDef.id, typeDef.snapshotId);
          for (const tid of searchTypeIds) {
            const members = await this.storage.getTypeMembers(tid);
            for (const m of members) {
              if ((m.memberKind === 'method' || m.memberKind === 'getter' || m.memberKind === 'setter') && m.name === call.methodName && m.functionId) {
                candidateFunctionIds.add(m.functionId);
              }
            }
          }
        } else if (typeDef.kind === 'interface') {
          const implementingClasses = await this.storage.getImplementingClasses(typeDef.id);
          for (const cls of implementingClasses) {
            const members = await this.storage.getTypeMembers(cls.id);
            for (const m of members) {
              if ((m.memberKind === 'method' || m.memberKind === 'getter' || m.memberKind === 'setter') && m.name === call.methodName && m.functionId) {
                candidateFunctionIds.add(m.functionId);
              }
            }
          }
        } else {
          // Other kinds (enum, type_alias, namespace) are not callable receivers
          unresolvedRemaining.push(call);
          continue;
        }

        // Filter to functions present in current registry
        const presentCandidateIds = Array.from(candidateFunctionIds).filter(fid => functions.has(fid));

        if (presentCandidateIds.length === 0) {
          unresolvedRemaining.push(call);
          continue;
        }

        // Add edges for all candidates (conservative, like CHA)
        for (const fid of presentCandidateIds) {
          const edge: import('../../ideal-call-graph-analyzer').IdealCallEdge = {
            id: generateStableEdgeId(call.callerFunctionId, fid, snapshotId),
            callerFunctionId: call.callerFunctionId,
            calleeFunctionId: fid,
            calleeName: `${call.receiverType}.${call.methodName}`,
            calleeSignature: undefined,
            callType: 'direct',
            callContext: 'db_bridge',
            lineNumber: call.lineNumber,
            columnNumber: call.columnNumber,
            isAsync: false,
            isChained: false,
            confidenceScore: 0.95, // Treat DB-bridged edges as high-confidence
            metadata: { dbBridge: true, receiverType: call.receiverType, methodName: call.methodName },
            createdAt: new Date().toISOString(),

            // Ideal system fields
            resolutionLevel: 'rta_resolved' as ResolutionLevel,
            resolutionSource: 'db_bridge',
            runtimeConfirmed: false,
            // Include all present candidates for penalty/visibility
            candidates: presentCandidateIds,
            analysisMetadata: {
              timestamp: Date.now(),
              analysisVersion: '1.0',
              sourceHash: call.receiverType
            }
          };

          addEdge(edge, state);
          resolvedEdges++;
        }
      } catch (e) {
        this.logger.debug(`DB bridge resolution failed for ${call.receiverType}.${call.methodName}: ${e instanceof Error ? e.message : String(e)}`);
        unresolvedRemaining.push(call);
      }
    }

    return { resolvedEdges, unresolvedRemaining };
  }

  /**
   * Collect class id and its parent ids (extends chain) limited depth to avoid cycles
   */
  private async collectClassAndParents(typeId: string, snapshotId: string, maxDepth = 5): Promise<string[]> {
    const visited = new Set<string>();
    const result: string[] = [];
    let frontier: string[] = [typeId];
    let depth = 0;

    while (frontier.length > 0 && depth <= maxDepth) {
      const next: string[] = [];
      for (const tid of frontier) {
        if (visited.has(tid)) continue;
        visited.add(tid);
        result.push(tid);
        try {
          const q = await this.storage.query(
            `SELECT target_type_id FROM type_relationships WHERE snapshot_id = $1 AND source_type_id = $2 AND relationship_kind = 'extends'`,
            [snapshotId, tid]
          );
          for (const row of q.rows) {
            const parentId = (row as { target_type_id?: unknown }).target_type_id;
            if (typeof parentId === 'string' && parentId && !visited.has(parentId)) {
              next.push(parentId);
            }
          }
        } catch (e) {
          this.logger.debug(`collectClassAndParents failed for ${tid}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      frontier = next;
      depth++;
    }

    return result;
  }
}
