# Lineage CLI Commands Reference

## Overview

The funcqc lineage commands provide comprehensive tools for tracking and managing function evolution across code changes. This reference covers all lineage-related CLI commands with detailed examples and options.

## Command Categories

- **Analysis**: `diff --lineage` - Generate lineage between snapshots
- **Browsing**: `lineage list` - Browse and filter lineage records  
- **Details**: `lineage show` - View detailed lineage information
- **Management**: `lineage review` - Approve, reject, or modify lineages
- **Deletion**: `lineage delete` - Delete individual lineages
- **Cleanup**: `lineage clean` - Batch delete lineages by criteria

---

## diff --lineage

Generate lineage analysis between two snapshots to detect function evolution.

### Syntax
```bash
funcqc diff <from-snapshot> <to-snapshot> --lineage [options]
```

### Options
| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output in JSON format | false |
| `--lineage-auto-save` | Automatically save detected lineage as draft | false |
| `--min-confidence` | Minimum confidence threshold (0.0-1.0) | 0.6 |
| `--max-candidates` | Maximum candidates per function | 50 |
| `--file` | Limit analysis to specific files | all files |
| `--cross-file` | Enable cross-file lineage detection | true |
| `--types` | Lineage types to detect | all types |
| `--no-change-detection` | Disable smart change detection | false |
| `--change-detection-min-score` | Minimum score for lineage suggestion (0-100) | 50 |

### Examples

#### Basic Lineage Analysis
```bash
# Analyze changes between two snapshots (detection only)
funcqc diff baseline feature-branch --lineage

# Auto-save detected lineages as drafts
funcqc diff main HEAD --lineage --lineage-auto-save

# Output in JSON format
funcqc diff main HEAD --lineage --json
```

#### Filtered Analysis
```bash
# Analyze specific files only
funcqc diff main HEAD --lineage --file "src/**/*.ts"

# Focus on high-confidence lineages
funcqc diff v1.0 v2.0 --lineage --min-confidence 0.8

# Detect only renames and signature changes
funcqc diff main branch --lineage --types rename,signature-change
```

#### Cross-file Analysis
```bash
# Enable detection of functions moved between files
funcqc diff main refactor --lineage --cross-file

# Disable cross-file for performance (large codebases)
funcqc diff main HEAD --lineage --no-cross-file
```

### Output Format

#### Standard Output
```
🔄 Function Lineage Analysis

📊 Summary:
- Renames: 3
- Signature Changes: 2  
- Splits: 1
- Merges: 0
- Inlines: 1

🔍 Detected Lineages:

RENAME: getUserData → fetchUserProfile (95% confidence)
├─ From: src/api/users.ts:15
└─ To: src/api/users.ts:15

SIGNATURE-CHANGE: processData → processData (87% confidence)  
├─ From: src/utils/data.ts:42 (params: 2)
└─ To: src/utils/data.ts:42 (params: 3)

SPLIT: handleRequest → handleRequestValidation + processRequest (78% confidence)
├─ From: src/handlers/request.ts:28
├─ To: src/handlers/validation.ts:15
└─ To: src/handlers/process.ts:22
```

#### JSON Output
```json
{
  "diff": {
    "from": { /* snapshot metadata */ },
    "to": { /* snapshot metadata */ },
    "added": [ /* new functions */ ],
    "removed": [ /* deleted functions */ ],
    "modified": [ /* changed functions */ ]
  },
  "lineages": [
    {
      "id": "lin_a1b2c3d4",
      "kind": "rename",
      "confidence": 0.95,
      "status": "draft",
      "from_functions": [{
        "id": "func_12345",
        "name": "getUserData",
        "file_path": "src/api/users.ts",
        "start_line": 15
      }],
      "to_functions": [{
        "id": "func_67890", 
        "name": "fetchUserProfile",
        "file_path": "src/api/users.ts",
        "start_line": 15
      }],
      "git_commit": "abc123",
      "created_at": "2024-03-15T10:30:00Z",
      "metadata": {
        "similarity_scores": {
          "name": 0.3,
          "signature": 1.0,
          "structure": 0.98,
          "content": 0.97
        }
      }
    }
  ]
}
```

**Note**: Without `--lineage-auto-save`, lineages are only detected and displayed. With `--lineage-auto-save`, they are saved to the database with `status: "draft"` for later review.

---

## lineage list

Browse and filter lineage records with flexible sorting and filtering options.

### Syntax
```bash
funcqc lineage list [options]
```

### Options
| Option | Description | Default |
|--------|-------------|---------|
| `--status` | Filter by status: draft, approved, rejected | all |
| `--kind` | Filter by lineage type | all |
| `--confidence` | Filter by confidence range | all |
| `--limit` | Maximum records to display | 50 |
| `--offset` | Skip records (pagination) | 0 |
| `--sort` | Sort field: created_at, confidence, kind | created_at |
| `--order` | Sort order: asc, desc | desc |
| `--from` | Filter by source function name pattern | all |
| `--to` | Filter by target function name pattern | all |
| `--commit` | Filter by Git commit hash | all |
| `--since` | Show lineages created since date | all |
| `--json` | Output in JSON format | false |

### Examples

#### Basic Listing
```bash
# List all lineages
funcqc lineage list

# Show only draft lineages
funcqc lineage list --status draft

# Show recent lineages (last 10)
funcqc lineage list --limit 10
```

#### Filtering by Type and Confidence
```bash
# Show only rename lineages
funcqc lineage list --kind rename

# High-confidence lineages only
funcqc lineage list --confidence ">=0.9"

# Medium to high confidence range
funcqc lineage list --confidence "0.7..0.9"
```

#### Function Name Filtering
```bash
# Lineages involving specific functions
funcqc lineage list --from "*User*"
funcqc lineage list --to "*validate*"

# Both source and target filters
funcqc lineage list --from "*Data*" --to "*Process*"
```

#### Sorting and Pagination
```bash
# Sort by confidence (highest first)
funcqc lineage list --sort confidence --order desc

# Sort by creation date (oldest first)  
funcqc lineage list --sort created_at --order asc

# Pagination
funcqc lineage list --limit 25 --offset 50
```

#### Date-based Filtering
```bash
# Lineages from last week
funcqc lineage list --since "1 week ago"

# Lineages from specific date
funcqc lineage list --since "2024-03-01"

# Lineages from specific commit
funcqc lineage list --commit abc123
```

### Output Format

#### Table Format (Default)
```
ID       Kind            Confidence  Status   From Function        To Function         Created
──────── ─────────────── ─────────── ──────── ──────────────────── ──────────────────── ──────────────
a1b2c3d4 rename          95%         draft    getUserData          fetchUserProfile     2024-03-15 10:30
e5f6g7h8 signature-change 87%        draft    processData          processData         2024-03-15 11:15
i9j0k1l2 split           78%         draft    handleRequest        [2 functions]       2024-03-15 12:00
```

#### JSON Format
```json
{
  "total": 3,
  "lineages": [
    {
      "id": "lin_a1b2c3d4",
      "kind": "rename", 
      "confidence": 0.95,
      "status": "draft",
      "from_functions": ["getUserData"],
      "to_functions": ["fetchUserProfile"],
      "created_at": "2024-03-15T10:30:00Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "has_more": false
  }
}
```

---

## lineage show

Display detailed information about a specific lineage record.

### Syntax
```bash
funcqc lineage show <lineage-id> [options]
```

### Options
| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output in JSON format | false |
| `--show-diffs` | Include function content diffs | false |
| `--show-metadata` | Include detailed analysis metadata | false |

### Examples

#### Basic Information
```bash
# Show lineage details
funcqc lineage show lin_a1b2c3d4

# Include function content diffs
funcqc lineage show lin_a1b2c3d4 --show-diffs

# Full details with metadata
funcqc lineage show lin_a1b2c3d4 --show-metadata --json
```

### Output Format

#### Standard Format
```
🔄 Lineage Details: lin_a1b2c3d4

📝 Basic Information:
├─ Type: rename
├─ Confidence: 95% (Very High)
├─ Status: draft
├─ Created: 2024-03-15 10:30:00 UTC
└─ Git Commit: abc123def

🔍 Function Mapping:
├─ From: getUserData
│  ├─ File: src/api/users.ts:15-28
│  ├─ Parameters: 2
│  └─ Complexity: 8
└─ To: fetchUserProfile  
   ├─ File: src/api/users.ts:15-28
   ├─ Parameters: 2
   └─ Complexity: 8

📊 Similarity Analysis:
├─ Name Similarity: 30% (different names)
├─ Signature Similarity: 100% (identical)
├─ Structure Similarity: 98% (nearly identical)
└─ Content Similarity: 97% (minor changes)

💡 Analysis Notes:
Simple rename operation detected. Function signature and structure
remain essentially unchanged with only the function name modified.
```

#### With Diffs
```bash
funcqc lineage show lin_a1b2c3d4 --show-diffs
```
```
🔄 Lineage Details: lin_a1b2c3d4
[... basic information ...]

📋 Function Content Diff:
- function getUserData(userId: string, options?: UserOptions) {
+ function fetchUserProfile(userId: string, options?: UserOptions) {
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    return this.apiClient.get(`/users/${userId}`, options);
  }
```

---

## lineage review

Manage lineage record status through approval, rejection, or modification.

### Syntax
```bash
funcqc lineage review <action> <lineage-id> [options]
```

### Actions
- `approve` - Mark lineage as approved
- `reject` - Mark lineage as rejected  
- `reset` - Reset to draft status
- `batch` - Process multiple lineages

### Options
| Option | Description | Default |
|--------|-------------|---------|
| `--reason` | Reason for the decision | none |
| `--confidence` | Override confidence score | original |
| `--batch-file` | File with lineage IDs for batch processing | none |
| `--auto-approve` | Auto-approve lineages above threshold | none |
| `--dry-run` | Show what would be done without changes | false |

### Examples

#### Individual Decisions
```bash
# Approve a lineage
funcqc lineage review approve lin_a1b2c3d4

# Reject with reason
funcqc lineage review reject lin_e5f6g7h8 --reason "False positive - unrelated functions"

# Reset to draft
funcqc lineage review reset lin_i9j0k1l2 --reason "Needs further analysis"
```

#### Confidence Adjustment
```bash
# Approve with confidence adjustment
funcqc lineage review approve lin_a1b2c3d4 --confidence 0.98 --reason "Manual verification confirms rename"
```

#### Batch Processing
```bash
# Auto-approve high-confidence lineages
funcqc lineage review batch --auto-approve 0.95

# Batch process from file
echo "lin_a1b2c3d4 approve
lin_e5f6g7h8 reject False positive
lin_i9j0k1l2 approve" > decisions.txt

funcqc lineage review batch --batch-file decisions.txt

# Dry run to preview changes
funcqc lineage review batch --auto-approve 0.9 --dry-run
```

### Batch File Format
```
# decisions.txt
lineage_id action [reason]
lin_a1b2c3d4 approve Manual verification
lin_e5f6g7h8 reject False positive detection
lin_i9j0k1l2 approve High confidence rename
```

### Output Examples

#### Individual Decision
```bash
funcqc lineage review approve lin_a1b2c3d4
```
```
✅ Lineage lin_a1b2c3d4 approved successfully

📝 Summary:
├─ Type: rename (getUserData → fetchUserProfile)
├─ Confidence: 95%
├─ Status: draft → approved
└─ Updated: 2024-03-15 14:22:00 UTC
```

#### Batch Processing
```bash
funcqc lineage review batch --auto-approve 0.9
```
```
🔄 Batch Review Results

✅ Approved (3):
├─ lin_a1b2c3d4: rename (95% confidence)
├─ lin_m3n4o5p6: signature-change (92% confidence)  
└─ lin_q7r8s9t0: inline (91% confidence)

⏸️  Pending Review (2):
├─ lin_u1v2w3x4: split (78% confidence) - below threshold
└─ lin_y5z6a7b8: merge (65% confidence) - below threshold

📊 Summary:
├─ Processed: 5 lineages
├─ Approved: 3 lineages
├─ Rejected: 0 lineages
└─ Remaining drafts: 2 lineages
```

---

## lineage delete

Delete a specific lineage record from the database.

### Syntax
```bash
funcqc lineage delete <lineage-id> [options]
```

### Options
| Option | Description | Default |
|--------|-------------|---------|
| `-v, --verbose` | Show verbose output | false |

### Examples

#### Delete Individual Lineage
```bash
# Delete a draft lineage
funcqc lineage delete lin_a1b2c3d4

# Delete with verbose output
funcqc lineage delete lin_a1b2c3d4 --verbose
```

### Safety Features

- **Confirmation Required**: All deletions require user confirmation
- **Status Display**: Shows lineage details before deletion
- **Approved Warning**: Extra warning for approved lineages requiring "yes" confirmation
- **Not Found Handling**: Clear error message for invalid lineage IDs

### Output Example

#### Draft Lineage Deletion
```bash
funcqc lineage delete lin_a1b2c3d4
```
```
⚠️  About to delete lineage:

ID: lin_a1b2c3d4
Kind: ✂️ split
Status: 📝 draft
From/To: 1 → 2 functions
Note: Auto-detected: advanced-structural detected 100.0% similarity

Are you sure you want to delete this lineage? (y/N): y
✅ Lineage lin_a1b2c3d4 has been deleted.
```

#### Approved Lineage Deletion
```bash
funcqc lineage delete lin_e5f6g7h8
```
```
⚠️  About to delete lineage:

ID: lin_e5f6g7h8
Kind: ✏️ rename
Status: ✅ approved
From/To: 1 → 1 functions

⚠️  WARNING: This lineage is APPROVED!
Deleting approved lineages removes important project history.

Are you sure you want to delete this APPROVED lineage? Type "yes" to confirm: no
ℹ️ Deletion cancelled.
```

---

## lineage clean

Delete multiple lineages based on filtering criteria. Provides batch deletion capabilities with safety controls.

### Syntax
```bash
funcqc lineage clean [options]
```

### Options
| Option | Description | Default |
|--------|-------------|---------|
| `--status <status>` | Filter by status (draft\|approved\|rejected) | draft |
| `--older-than <days>` | Delete lineages older than N days | none |
| `--dry-run` | Preview what would be deleted without making changes | false |
| `-y, --yes` | Skip confirmation prompt | false |
| `--include-approved` | Include approved lineages (requires --force) | false |
| `--force` | Required flag when deleting approved lineages | false |
| `-v, --verbose` | Show detailed list of lineages to be deleted | false |

### Examples

#### Basic Cleanup
```bash
# Delete all draft lineages (with confirmation)
funcqc lineage clean

# Preview what would be deleted
funcqc lineage clean --dry-run

# Delete without confirmation
funcqc lineage clean --yes
```

#### Time-based Cleanup
```bash
# Delete draft lineages older than 30 days
funcqc lineage clean --older-than 30

# Delete all lineages older than 7 days
funcqc lineage clean --older-than 7 --include-approved --force
```

#### Status-specific Cleanup
```bash
# Delete all rejected lineages
funcqc lineage clean --status rejected

# Delete specific status with time filter
funcqc lineage clean --status draft --older-than 14
```

#### Advanced Cleanup (Dangerous)
```bash
# Delete all lineages including approved (requires confirmation)
funcqc lineage clean --include-approved --force

# Delete all approved lineages older than 90 days
funcqc lineage clean --status approved --older-than 90 --force
```

### Safety Features

- **Default to Draft**: Only deletes draft lineages by default
- **Confirmation Required**: Asks for confirmation unless `--yes` is used
- **Force Flag**: Requires `--force` when deleting approved lineages
- **Dry Run Mode**: Preview deletions with `--dry-run`
- **Extra Warnings**: Special warnings when approved lineages are included

### Output Examples

#### Standard Cleanup
```bash
funcqc lineage clean --older-than 30
```
```
🧹 Lineages to be deleted (12):

  📝 draft: 12

Details:
  1. 2c668ece - split (draft)
  2. 7f4cc3ad - split (draft)
  3. aadad585 - split (draft)
  [... 9 more ...]

Proceed with deletion? (y/N): y
✅ Deleted 12 lineages.
```

#### Dry Run Mode
```bash
funcqc lineage clean --dry-run
```
```
🧹 Lineages to be deleted (48):

  📝 draft: 48

(Dry run - no changes made)
```

#### Including Approved Lineages
```bash
funcqc lineage clean --include-approved --force
```
```
🧹 Lineages to be deleted (50):

  ✅ approved: 2
  📝 draft: 48

⚠️  WARNING: This will delete 2 APPROVED lineages!

Type "yes" to confirm deletion of approved lineages: no
ℹ️ Deletion cancelled.
```

### Use Cases

1. **Regular Maintenance**: Clean up old draft lineages periodically
2. **False Positive Cleanup**: Remove incorrectly detected lineages after fixing detection logic
3. **Project Reset**: Clear all lineages when restructuring project
4. **Storage Management**: Reduce database size by removing old records

---

## Integration Examples

### Workflow Integration
```bash
# Pre-commit lineage check (detection only)
git add .
funcqc scan --label "pre-commit"
funcqc diff HEAD pre-commit --lineage --min-confidence 0.8

# Post-merge analysis with auto-save
git checkout main
git pull origin main
funcqc scan --label "post-merge"
funcqc diff main~10 post-merge --lineage --lineage-auto-save --json > lineage-report.json
```

### CI/CD Pipeline
```bash
# Generate and save lineage for release
funcqc diff v1.0 v2.0 --lineage --lineage-auto-save --min-confidence 0.7 --json > release-lineage.json

# Validate all lineages are reviewed
PENDING=$(funcqc lineage list --status draft --json | jq 'length')
if [ "$PENDING" -gt 0 ]; then
  echo "Warning: $PENDING lineages pending review"
  funcqc lineage list --status draft
fi
```

### Draft Lineage Workflow
```bash
# 1. Detect and save lineages as drafts
funcqc diff main feature-branch --lineage --lineage-auto-save

# 2. Review drafts - approve, reject, or delete
funcqc lineage list --status draft
funcqc lineage review approve lin_abc123 --reason "Confirmed refactoring"
funcqc lineage review reject lin_def456 --reason "False positive"
funcqc lineage delete lin_ghi789  # Delete individual false positive

# 3. Clean up old drafts periodically
funcqc lineage clean --older-than 30 --dry-run  # Preview cleanup
funcqc lineage clean --older-than 30            # Perform cleanup

# 4. Export approved lineages
funcqc lineage list --status approved --json > approved-lineages.json
```

### Maintenance Workflow
```bash
# Weekly cleanup of old draft lineages
funcqc lineage clean --older-than 14 --dry-run
funcqc lineage clean --older-than 14 --yes

# Remove all rejected lineages (cleanup storage)
funcqc lineage clean --status rejected --yes

# Emergency cleanup after detection logic fix
funcqc lineage clean --dry-run              # Preview all drafts
funcqc lineage clean --yes                  # Delete all drafts
funcqc diff main HEAD --lineage --lineage-auto-save  # Re-detect with fixed logic
```

### Reporting and Analytics
```bash
# Generate monthly lineage report
funcqc lineage list --since "1 month ago" --json > monthly-lineages.json

# Export approved lineages for documentation
funcqc lineage list --status approved --json | \
  jq '.lineages[] | {type: .kind, from: .from_functions[0], to: .to_functions[0], confidence: .confidence}' > approved-lineages.json
```

## Error Handling

### Common Errors

**Lineage ID Not Found**
```bash
funcqc lineage show invalid_id
# Error: Lineage 'invalid_id' not found
```

**Invalid Confidence Range**
```bash
funcqc lineage list --confidence "invalid"
# Error: Invalid confidence format. Use number (0.8) or range (0.7..0.9)
```

**Snapshot Not Found**
```bash
funcqc diff nonexistent-snapshot main --lineage
# Error: Snapshot 'nonexistent-snapshot' not found
```

### Exit Codes
- `0` - Success
- `1` - General error
- `2` - Invalid arguments  
- `3` - Not found (snapshot, lineage, etc.)
- `4` - Database error
- `5` - Git integration error

---

## Configuration

Global lineage settings can be configured in `.funcqcrc`:

```json
{
  "lineage": {
    "similarity_thresholds": {
      "rename": 0.8,
      "signature_change": 0.7,
      "split": 0.6,
      "merge": 0.6,
      "inline": 0.75
    },
    "analysis": {
      "max_candidates": 50,
      "enable_cross_file": true,
      "timeout_seconds": 300
    },
    "display": {
      "default_limit": 50,
      "show_confidence_as_percentage": true,
      "truncate_function_names": 30
    }
  }
}
```

See [Configuration Guide](./configuration.md) for complete options.