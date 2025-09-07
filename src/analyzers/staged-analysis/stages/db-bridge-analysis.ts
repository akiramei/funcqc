import { Logger } from '../../../utils/cli-utils';
import { StorageAdapter } from '../../../types';
import type { TypeDefinition, TypeMember } from '../../../types/type-system';
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
  // Caches to reduce repeated DB lookups within a single analysis run
  private typeByNameCache = new Map<string, TypeDefinition | null>(); // key: `${snapshotId}:${name}`
  private typeMembersCache = new Map<string, TypeMember[]>(); // key: typeId
  private implementingClassesCache = new Map<string, TypeDefinition[]>(); // key: interfaceId
  private extendsChainCache = new Map<string, string[]>(); // key: `${snapshotId}:${typeId}`
  private interfaceExtendersIdsCache = new Map<string, string[]>(); // key: `${snapshotId}:${interfaceId}`
  private transitiveImplementorsCache = new Map<string, TypeDefinition[]>(); // key: `${snapshotId}:${interfaceId}`

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
        const typeDef = await this.getTypeByNameCached(call.receiverType, snapshotId);
        if (!typeDef) {
          unresolvedRemaining.push(call);
          continue;
        }

        const candidateFunctionIds = new Set<string>();

        if (typeDef.kind === 'class') {
          // Search methods in the class and its parent chain (extends)
          const searchTypeIds = await this.collectClassAndParentsCached(typeDef.id, typeDef.snapshotId);
          for (const tid of searchTypeIds) {
            const members = await this.getTypeMembersCached(tid);
            for (const m of members) {
              if ((m.memberKind === 'method' || m.memberKind === 'getter' || m.memberKind === 'setter') && m.name === call.methodName && m.functionId) {
                candidateFunctionIds.add(m.functionId);
              }
            }
          }
        } else if (typeDef.kind === 'interface') {
          // Collect classes implementing this interface directly or via child interfaces (transitive)
          const implementingClasses = await this.collectTransitiveImplementingClassesCached(typeDef.id, typeDef.snapshotId);
          for (const cls of implementingClasses) {
            const members = await this.getTypeMembersCached(cls.id);
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

  /**
   * Cached helpers
   */
  private async getTypeByNameCached(name: string, snapshotId: string): Promise<TypeDefinition | null> {
    const key = `${snapshotId}:${name}`;
    if (this.typeByNameCache.has(key)) return this.typeByNameCache.get(key)!;
    const res = await this.storage.findTypeByName(name, snapshotId);
    this.typeByNameCache.set(key, res);
    return res;
  }

  private async getTypeMembersCached(typeId: string): Promise<TypeMember[]> {
    if (this.typeMembersCache.has(typeId)) return this.typeMembersCache.get(typeId)!;
    const members = await this.storage.getTypeMembers(typeId);
    this.typeMembersCache.set(typeId, members);
    return members;
  }

  private async getImplementingClassesCached(interfaceId: string): Promise<TypeDefinition[]> {
    if (this.implementingClassesCache.has(interfaceId)) return this.implementingClassesCache.get(interfaceId)!;
    const classes = await this.storage.getImplementingClasses(interfaceId);
    this.implementingClassesCache.set(interfaceId, classes);
    return classes;
  }

  private async collectClassAndParentsCached(typeId: string, snapshotId: string, maxDepth = 5): Promise<string[]> {
    const key = `${snapshotId}:${typeId}`;
    if (this.extendsChainCache.has(key)) return this.extendsChainCache.get(key)!;
    const ids = await this.collectClassAndParents(typeId, snapshotId, maxDepth);
    this.extendsChainCache.set(key, ids);
    return ids;
  }

  private async getExtendingInterfaceIdsCached(interfaceId: string, snapshotId: string): Promise<string[]> {
    const key = `${snapshotId}:${interfaceId}`;
    if (this.interfaceExtendersIdsCache.has(key)) return this.interfaceExtendersIdsCache.get(key)!;
    try {
      const q = await this.storage.query(
        `SELECT tr.source_type_id AS child_id
         FROM type_relationships tr
         JOIN type_definitions td ON td.id = tr.source_type_id
         WHERE tr.snapshot_id = $1 AND tr.target_type_id = $2 AND tr.relationship_kind = 'extends' AND td.kind = 'interface'`,
        [snapshotId, interfaceId]
      );
      const ids: string[] = [];
      for (const row of q.rows) {
        const child = (row as { child_id?: unknown }).child_id;
        if (typeof child === 'string' && child) ids.push(child);
      }
      this.interfaceExtendersIdsCache.set(key, ids);
      return ids;
    } catch (e) {
      this.logger.debug(`getExtendingInterfaceIdsCached failed: ${e instanceof Error ? e.message : String(e)}`);
      this.interfaceExtendersIdsCache.set(key, []);
      return [];
    }
  }

  private async collectTransitiveImplementingClassesCached(interfaceId: string, snapshotId: string): Promise<TypeDefinition[]> {
    const key = `${snapshotId}:${interfaceId}`;
    if (this.transitiveImplementorsCache.has(key)) return this.transitiveImplementorsCache.get(key)!;

    const visited = new Set<string>();
    const queue: string[] = [interfaceId];
    const classes: TypeDefinition[] = [];
    const seenClassIds = new Set<string>();

    while (queue.length > 0) {
      const iid = queue.shift()!;
      if (visited.has(iid)) continue;
      visited.add(iid);

      // Direct implementing classes
      try {
        const impls = await this.getImplementingClassesCached(iid);
        for (const cls of impls) {
          if (!seenClassIds.has(cls.id)) {
            classes.push(cls);
            seenClassIds.add(cls.id);
          }
        }
      } catch (e) {
        this.logger.debug(`getImplementingClassesCached failed: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Enqueue child interfaces (those that extend current interface)
      const childIds = await this.getExtendingInterfaceIdsCached(iid, snapshotId);
      for (const cid of childIds) {
        if (!visited.has(cid)) queue.push(cid);
      }
    }

    this.transitiveImplementorsCache.set(key, classes);
    return classes;
  }
}
