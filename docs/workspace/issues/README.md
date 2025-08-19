# Known Issues

This directory contains detailed documentation of known issues in funcqc.

## 🚨 Critical Issues

### [DCD-001: Dead Code Detection Accuracy Problems](./dead-code-detection-accuracy.md)
**Status**: Identified - Needs Fix  
**Impact**: High - Critical functions incorrectly marked as dead code  
**Affected**: `funcqc dead`, `funcqc clean` commands  

**Quick Summary**: Dead code detection has false positives. Functions actively used in tests and source files are incorrectly identified as dead code, leading to potential deletion of critical functions.

**Before Using**: Always verify dead code results manually and use `--dry-run` before deletion.

### [DCD-002: Dead Code Detection Accuracy Improvements Implementation](./dead-code-detection-improvements.md)
**Status**: In Progress  
**Impact**: High - Systematic implementation to resolve DCD-001  
**Affected**: `funcqc dead`, `funcqc clean` commands  

**Quick Summary**: Implementation plan for systematic improvements to dead code detection accuracy through 3-phase approach: entry point detection enhancement, same-file call detection, and module resolution enhancement.

**Progress**: Phase 1 (Entry Points) → Phase 2 (Internal Calls) → Phase 3 (Module Resolution)

---

## 📝 How to Report Issues

1. Create a new `.md` file in this directory
2. Use the template from existing issues
3. Include reproduction steps and evidence
4. Add entry to this README
5. Assign appropriate priority and status

## 🏷️ Issue Status Labels

- **Identified**: Problem confirmed, solution not implemented
- **In Progress**: Actively being worked on
- **Fixed**: Solution implemented and tested
- **Wontfix**: Decided not to fix (with reasoning)
- **Duplicate**: Same as another issue

## 🎯 Priority Levels

- **Critical**: System unusable or data loss risk
- **High**: Major functionality broken
- **Medium**: Feature impaired but workarounds exist
- **Low**: Minor issues or enhancements