import { 
  RefactoringSession, 
  SessionFunction, 
  RefactoringPattern,
  RefactoringOpportunity
} from '../types/index.js';
import * as crypto from 'crypto';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter.js';

export interface SessionConfig {
  autoCommit?: boolean;
  branchPrefix?: string;
  maxConcurrentSessions?: number;
}

export interface SessionSummary {
  totalFunctions: number;
  completedFunctions: number;
  progressPercentage: number;
  estimatedEffort: number;
  actualEffort: number;
  patterns: Record<RefactoringPattern, number>;
}

export class SessionManager {
  private storage: PGLiteStorageAdapter;
  private config: SessionConfig;

  constructor(storage: PGLiteStorageAdapter, config: SessionConfig = {}) {
    this.storage = storage;
    this.config = {
      autoCommit: false,
      branchPrefix: 'refactor/',
      maxConcurrentSessions: 3,
      ...config
    };
  }

  /**
   * Create a new refactoring session
   */
  async createSession(
    name: string,
    description: string,
    targetBranch?: string
  ): Promise<RefactoringSession> {
    const db = this.storage.getDb();
    
    // Check for existing active sessions
    const activeSessions = await db.query(`
      SELECT * FROM refactoring_sessions 
      WHERE status = 'active'
    `);

    if (activeSessions.rows.length >= this.config.maxConcurrentSessions!) {
      throw new Error(
        `Maximum concurrent sessions (${this.config.maxConcurrentSessions}) reached. ` +
        `Please complete or cancel existing sessions first.`
      );
    }

    // Create new session with cryptographically secure random ID
    const sessionId = crypto.randomBytes(16).toString('hex');
    const now = new Date();
    const startTime = Date.now();
    
    await db.query(`
      INSERT INTO refactoring_sessions 
      (id, name, description, status, target_branch, start_time, metadata, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      sessionId,
      name,
      description,
      'active',
      targetBranch || '',
      startTime,
      JSON.stringify({}),
      now,
      now
    ]);

    return {
      id: sessionId,
      name,
      description,
      status: 'active',
      target_branch: targetBranch || '',
      start_time: startTime,
      metadata: {},
      created_at: now,
      updated_at: now
    };
  }

  /**
   * Get active sessions
   */
  async getActiveSessions(): Promise<RefactoringSession[]> {
    // More efficient database-level filtering instead of memory filtering
    const db = this.storage.getDb();
    const result = await db.query(`
      SELECT * FROM refactoring_sessions 
      WHERE status = 'active' 
      ORDER BY created_at DESC
    `);
    
    return result.rows.map(row => this.mapRowToRefactoringSession(row as {
      id: string;
      name: string;
      description: string;
      status: 'active' | 'completed' | 'cancelled';
      target_branch: string;
      start_time: string;
      end_time?: string;
      metadata: string;
      created_at: string;
      updated_at: string;
    }));
  }

  /**
   * Get all refactoring sessions (active, completed, and cancelled)
   */
  async getAllSessions(): Promise<RefactoringSession[]> {
    return await this.storage.getAllRefactoringSessions();
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<RefactoringSession | null> {
    const allSessions = await this.storage.getAllRefactoringSessions();
    return allSessions.find(session => session.id === sessionId) || null;
  }

  /**
   * Map database row to RefactoringSession type
   * Ensures type safety when converting database results
   */
  private mapRowToRefactoringSession(row: {
    id: string;
    name: string;
    description: string;
    status: 'active' | 'completed' | 'cancelled';
    target_branch: string;
    start_time: string;
    end_time?: string;
    metadata: string;
    created_at: string;
    updated_at: string;
  }): RefactoringSession {
    const session: RefactoringSession = {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      target_branch: row.target_branch,
      start_time: new Date(row.start_time).getTime(),
      metadata: this.safeJsonParse(row.metadata, {}),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
    
    if (row.end_time) {
      session.end_time = new Date(row.end_time).getTime();
    }
    
    return session;
  }

  /**
   * Safely parse JSON with fallback value
   */
  private safeJsonParse<T>(jsonString: string, fallback: T): T {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      console.warn(`Failed to parse JSON: ${jsonString}`, error);
      return fallback;
    }
  }

  /**
   * Add functions to a session
   */
  async addFunctionsToSession(
    sessionId: string,
    functionIds: string[],
    role: 'primary' | 'related' = 'primary'
  ): Promise<void> {
    const db = this.storage.getDb();
    
    // Verify session exists
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'active') {
      throw new Error(`Session ${sessionId} is not active`);
    }

    // Add functions to session
    const now = new Date();
    for (const functionId of functionIds) {
      await db.query(`
        INSERT INTO session_functions 
        (session_id, function_id, role, status, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (session_id, function_id) 
        DO UPDATE SET role = $3, updated_at = $6
      `, [
        sessionId,
        functionId,
        role,
        'pending',
        JSON.stringify({}),
        now
      ]);
    }
  }

  /**
   * Update function status in session
   */
  async updateFunctionStatus(
    sessionId: string,
    functionId: string,
    status: 'pending' | 'in_progress' | 'completed' | 'skipped',
    notes?: string
  ): Promise<void> {
    const db = this.storage.getDb();
    
    const metadata = notes ? JSON.stringify({ notes }) : JSON.stringify({});
    
    await db.query(`
      UPDATE session_functions 
      SET status = $1, metadata = $2, updated_at = $3
      WHERE session_id = $4 AND function_id = $5
    `, [status, metadata, new Date(), sessionId, functionId]);
  }

  /**
   * Get session summary
   */
  async getSessionSummary(sessionId: string): Promise<SessionSummary> {
    const db = this.storage.getDb();
    
    // Get all functions in session
    const functionsResult = await db.query(`
      SELECT * FROM session_functions 
      WHERE session_id = $1
    `, [sessionId]);

    const sessionFunctions = functionsResult.rows as SessionFunction[];

    // Get opportunities for this session
    const opportunitiesResult = await db.query(`
      SELECT * FROM refactoring_opportunities 
      WHERE session_id = $1
    `, [sessionId]);

    const opportunities = opportunitiesResult.rows as Array<{
      pattern: RefactoringPattern;
      metadata: { estimatedEffort?: number };
    }>;

    // Calculate summary
    const totalFunctions = sessionFunctions.length;
    const completedFunctions = sessionFunctions.filter(f => f.status === 'completed').length;
    const progressPercentage = totalFunctions > 0 
      ? Math.round((completedFunctions / totalFunctions) * 100) 
      : 0;

    // Calculate effort
    const estimatedEffort = opportunities.reduce((sum: number, opp) => {
      const effort = opp.metadata?.estimatedEffort || 0;
      return sum + effort;
    }, 0);

    const actualEffort = sessionFunctions
      .filter(f => f.status === 'completed')
      .reduce((sum: number, func) => {
        const metadata = func.metadata as { actualEffort?: number } | undefined;
        const effort = metadata?.actualEffort || 0;
        return sum + effort;
      }, 0);

    // Count patterns
    const patterns = opportunities.reduce((acc: Record<string, number>, opp) => {
      const pattern = opp.pattern;
      acc[pattern] = (acc[pattern] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) as Record<RefactoringPattern, number>;

    return {
      totalFunctions,
      completedFunctions,
      progressPercentage,
      estimatedEffort,
      actualEffort,
      patterns
    };
  }

  /**
   * Complete a session
   */
  async completeSession(sessionId: string, summary?: string): Promise<void> {
    const db = this.storage.getDb();
    
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'active') {
      throw new Error(`Session ${sessionId} is not active`);
    }

    const metadata = summary 
      ? JSON.stringify({ summary })
      : JSON.stringify({});

    await db.query(`
      UPDATE refactoring_sessions 
      SET status = $1, end_time = $2, metadata = $3, updated_at = $4
      WHERE id = $5
    `, ['completed', Date.now(), metadata, new Date(), sessionId]);
  }

  /**
   * Cancel a session
   */
  async cancelSession(sessionId: string, reason?: string): Promise<void> {
    const db = this.storage.getDb();
    
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'active') {
      throw new Error(`Session ${sessionId} is not active`);
    }

    const metadata = reason 
      ? JSON.stringify({ cancelReason: reason })
      : JSON.stringify({});

    await db.query(`
      UPDATE refactoring_sessions 
      SET status = $1, end_time = $2, metadata = $3, updated_at = $4
      WHERE id = $5
    `, ['cancelled', Date.now(), metadata, new Date(), sessionId]);
  }

  /**
   * Get session functions with details
   */
  async getSessionFunctions(sessionId: string): Promise<Array<SessionFunction & { functionName?: string }>> {
    const db = this.storage.getDb();
    
    const result = await db.query(`
      SELECT sf.*, f.name as functionName
      FROM session_functions sf
      LEFT JOIN functions f ON f.id = sf.function_id
      WHERE sf.session_id = $1
      ORDER BY sf.created_at ASC
    `, [sessionId]);

    return result.rows as Array<SessionFunction & { functionName?: string }>;
  }

  /**
   * Link opportunities to session
   */
  async linkOpportunitiesToSession(
    sessionId: string,
    opportunityIds: string[]
  ): Promise<void> {
    const db = this.storage.getDb();
    
    for (const opportunityId of opportunityIds) {
      await db.query(`
        UPDATE refactoring_opportunities 
        SET session_id = $1, updated_at = $2
        WHERE id = $3
      `, [sessionId, new Date(), opportunityId]);
    }
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<RefactoringSession[]> {
    const db = this.storage.getDb();
    
    const result = await db.query(`
      SELECT * FROM refactoring_sessions 
      ORDER BY created_at DESC
    `);
    
    return (result.rows as Record<string, unknown>[]).map((row: Record<string, unknown>) => {
      let metadata = row['metadata'];
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata);
        } catch (error) {
          console.warn(`Invalid JSON in session metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
          metadata = {};
        }
      }
      return {
        ...row,
        metadata
      };
    }) as RefactoringSession[];
  }

  /**
   * Get opportunities for a session
   */
  async getSessionOpportunities(sessionId: string): Promise<RefactoringOpportunity[]> {
    const db = this.storage.getDb();
    
    const result = await db.query(`
      SELECT * FROM refactoring_opportunities 
      WHERE session_id = $1
      ORDER BY impact_score DESC
    `, [sessionId]);
    
    return (result.rows as Record<string, unknown>[]).map((row: Record<string, unknown>) => ({
      ...row,
      metadata: typeof row['metadata'] === 'string' 
        ? JSON.parse(row['metadata']) 
        : row['metadata']
    })) as RefactoringOpportunity[];
  }
}