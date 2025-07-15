/**
 * Command Handlers Index
 * 
 * Centralized exports for all refactor command handlers
 */

// Main command handlers
export { refactorAnalyzeCommandImpl } from './analyze.js';
export { refactorDetectCommandImpl } from './detect.js';
export { refactorSnapshotCommandImpl } from './snapshot.js';

// TODO: Add other handlers as they are extracted
// export { refactorInteractiveCommandImpl } from './interactive.js';
// export { refactorPlanCommandImpl } from './plan.js';
// export { refactorStatusCommandImpl } from './status.js';
// export { refactorTrackCommandImpl } from './track.js';
// export { refactorAssessCommandImpl } from './assess.js';
// export { refactorVerifyCommandImpl } from './verify.js';