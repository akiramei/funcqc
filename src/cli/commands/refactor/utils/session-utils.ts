/**
 * Session Management Utilities
 * 
 * Provides utility functions for managing refactoring sessions,
 * linking opportunities, and handling session operations.
 */

import { 
  RefactoringSession, 
  RefactoringOpportunity,
  SessionFunction,
  RefactorTrackOptions 
} from '../../../../types/index.js';
import { SessionManager } from '../../../../refactoring/session-manager-simple.js';

// ============================================
// SESSION OPERATIONS
// ============================================

/**
 * Link opportunities to a refactoring session
 */
export async function linkOpportunitiesToSession(
  sessionManager: SessionManager,
  currentSession: RefactoringSession,
  opportunities: RefactoringOpportunity[]
): Promise<void> {
  const opportunityIds = opportunities.map(opp => opp.id);
  await sessionManager.linkOpportunitiesToSession(currentSession.id, opportunityIds);
  
  const uniqueFunctionIds = new Set(opportunities.map(opp => opp.function_id));
  const functionIds = Array.from(uniqueFunctionIds);
  await sessionManager.addFunctionsToSession(currentSession.id, functionIds);
}

/**
 * Handle session creation with options
 */
export async function handleSessionCreation(
  sessionManager: SessionManager,
  options: RefactorTrackOptions,
  args: string[]
): Promise<void> {
  const sessionName = args[0] || options.name || `Session ${new Date().toISOString()}`;
  const description = options.description || 'Tracking session created via CLI';
  
  try {
    const session = await sessionManager.createSession(sessionName, description);
    console.log(`✅ Created session: ${session.id} - ${session.name}`);
    
    if (options.json) {
      console.log(JSON.stringify(session, null, 2));
    }
  } catch (error) {
    console.error(`❌ Failed to create session: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Handle session updates
 */
export async function handleSessionUpdate(
  sessionManager: SessionManager,
  sessionId: string,
  options: RefactorTrackOptions
): Promise<void> {
  const updates: Partial<RefactoringSession> = {};
  
  if (options.name) {
    updates.name = options.name;
  }
  
  if (options.description) {
    updates.description = options.description;
  }
  
  if (options.status) {
    updates.status = options.status as 'planning' | 'active' | 'completed' | 'paused';
  }
  
  if (options.notes) {
    // In a real implementation, you'd handle notes differently
    console.log(`Notes for session ${sessionId}: ${options.notes}`);
  }
  
  if (Object.keys(updates).length > 0) {
    try {
      await sessionManager.updateSession(sessionId, updates);
      console.log(`✅ Updated session: ${sessionId}`);
      
      if (options.json) {
        const updatedSession = await sessionManager.getSession(sessionId);
        console.log(JSON.stringify(updatedSession, null, 2));
      }
    } catch (error) {
      console.error(`❌ Failed to update session: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  } else {
    console.log('⚠️  No updates specified');
  }
}

/**
 * Handle session listing with filtering
 */
export async function handleSessionListing(
  sessionManager: SessionManager,
  options: RefactorTrackOptions
): Promise<void> {
  try {
    const sessions = await sessionManager.listSessions();
    
    // Apply filters
    let filteredSessions = sessions;
    
    if (options.status) {
      filteredSessions = sessions.filter(s => s.status === options.status);
    }
    
    if (options.name) {
      filteredSessions = sessions.filter(s => 
        s.name.toLowerCase().includes(options.name!.toLowerCase())
      );
    }
    
    if (options.json) {
      console.log(JSON.stringify({ sessions: filteredSessions }, null, 2));
      return;
    }
    
    if (filteredSessions.length === 0) {
      console.log('No sessions found matching criteria.');
      return;
    }
    
    console.log(`\n📋 Refactoring Sessions (${filteredSessions.length}):\n`);
    
    filteredSessions.forEach(session => {
      const statusIcon = getStatusIcon(session.status);
      const date = new Date(session.created_at).toLocaleDateString();
      
      console.log(`${statusIcon} ${session.name}`);
      console.log(`   ID: ${session.id}`);
      console.log(`   Status: ${session.status}`);
      console.log(`   Created: ${date}`);
      
      if (session.description) {
        console.log(`   Description: ${session.description}`);
      }
      
      console.log('');
    });
  } catch (error) {
    console.error(`❌ Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Handle session deletion
 */
export async function handleSessionDeletion(
  sessionManager: SessionManager,
  sessionId: string,
  options: RefactorTrackOptions
): Promise<void> {
  try {
    // Get session details for confirmation
    const session = await sessionManager.getSession(sessionId);
    if (!session) {
      console.log(`❌ Session not found: ${sessionId}`);
      return;
    }
    
    if (!options.force) {
      console.log(`⚠️  About to delete session: ${session.name} (${session.id})`);
      console.log('Use --force to confirm deletion');
      return;
    }
    
    await sessionManager.deleteSession(sessionId);
    console.log(`✅ Deleted session: ${sessionId}`);
    
    if (options.json) {
      console.log(JSON.stringify({ deleted: sessionId }, null, 2));
    }
  } catch (error) {
    console.error(`❌ Failed to delete session: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ============================================
// OPPORTUNITY MANAGEMENT
// ============================================

/**
 * Filter opportunities based on criteria
 */
export function filterOpportunities(
  opportunities: RefactoringOpportunity[],
  patterns?: string[],
  minScore?: number,
  severity?: string
): RefactoringOpportunity[] {
  let filtered = opportunities;
  
  if (patterns && patterns.length > 0) {
    filtered = filtered.filter(opp => 
      patterns.some(pattern => 
        opp.pattern.toLowerCase().includes(pattern.toLowerCase())
      )
    );
  }
  
  if (minScore !== undefined) {
    filtered = filtered.filter(opp => opp.impact_score >= minScore);
  }
  
  if (severity) {
    filtered = filtered.filter(opp => 
      opp.severity.toLowerCase() === severity.toLowerCase()
    );
  }
  
  return filtered;
}

/**
 * Group opportunities by pattern
 */
export function groupOpportunitiesByPattern(
  opportunities: RefactoringOpportunity[]
): Record<string, RefactoringOpportunity[]> {
  return opportunities.reduce((groups, opp) => {
    const pattern = opp.pattern;
    if (!groups[pattern]) {
      groups[pattern] = [];
    }
    groups[pattern].push(opp);
    return groups;
  }, {} as Record<string, RefactoringOpportunity[]>);
}

/**
 * Calculate opportunity statistics
 */
export function calculateOpportunityStats(opportunities: RefactoringOpportunity[]) {
  const totalScore = opportunities.reduce((sum, opp) => sum + opp.impact_score, 0);
  const averageScore = opportunities.length > 0 ? totalScore / opportunities.length : 0;
  
  const severityCounts = opportunities.reduce((counts, opp) => {
    counts[opp.severity] = (counts[opp.severity] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  
  const patternCounts = opportunities.reduce((counts, opp) => {
    counts[opp.pattern] = (counts[opp.pattern] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  
  return {
    total: opportunities.length,
    totalScore,
    averageScore: Math.round(averageScore * 100) / 100,
    severityCounts,
    patternCounts
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get status icon for session display
 */
function getStatusIcon(status: string): string {
  switch (status) {
    case 'planning':
      return '📝';
    case 'active':
      return '🚀';
    case 'completed':
      return '✅';
    case 'paused':
      return '⏸️';
    default:
      return '📋';
  }
}

/**
 * Validate session status
 */
export function isValidSessionStatus(status: string): boolean {
  return ['planning', 'active', 'completed', 'paused'].includes(status);
}

/**
 * Create session summary for display
 */
export function createSessionSummary(
  session: RefactoringSession,
  opportunities: RefactoringOpportunity[] = [],
  functions: SessionFunction[] = []
): string {
  const stats = calculateOpportunityStats(opportunities);
  const lines = [
    `📋 Session: ${session.name}`,
    `   Status: ${getStatusIcon(session.status)} ${session.status}`,
    `   Created: ${new Date(session.created_at).toLocaleDateString()}`,
    `   Functions: ${functions.length}`,
    `   Opportunities: ${stats.total} (avg score: ${stats.averageScore})`
  ];
  
  if (session.description) {
    lines.splice(3, 0, `   Description: ${session.description}`);
  }
  
  return lines.join('\n');
}