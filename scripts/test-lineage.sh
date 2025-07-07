#!/bin/bash

# Test Lineage Detection Script
# This script helps developers test lineage detection locally before creating PRs

set -euo pipefail

# Store current branch for restoration on exit
CURRENT_BRANCH=""
CLEANUP_ON_EXIT=false

# Cleanup function for trap
cleanup_on_exit() {
    if [ "$CLEANUP_ON_EXIT" = true ]; then
        echo "Script interrupted. Performing cleanup..."
        
        # Restore original branch
        if [ -n "$CURRENT_BRANCH" ] && [ "$CURRENT_BRANCH" != "$(git branch --show-current 2>/dev/null || echo '')" ]; then
            git checkout "$CURRENT_BRANCH" > /dev/null 2>&1 || true
        fi
        
        # Clean up snapshots if needed
        cleanup_snapshots 2>/dev/null || true
    fi
}

# Set up trap for proper cleanup on script exit
trap cleanup_on_exit EXIT INT TERM

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
BASE_BRANCH="main"
HEAD_BRANCH="HEAD"
CLEANUP=true
VERBOSE=false

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to display help
show_help() {
    cat << EOF
Test Lineage Detection Script

Usage: $0 [OPTIONS]

This script simulates the GitHub Actions lineage analysis workflow locally.
It helps developers preview what lineage changes will be detected in their PR.

OPTIONS:
    -b, --base BRANCH       Base branch for comparison (default: main)
    -h, --head BRANCH       Head branch/commit for comparison (default: HEAD)
    -c, --no-cleanup        Don't cleanup temporary snapshots
    -v, --verbose           Enable verbose output
    --help                  Show this help message

EXAMPLES:
    # Test current changes against main
    $0

    # Test specific branch against develop
    $0 --base develop --head feature/my-changes

    # Test with verbose output and keep snapshots
    $0 --verbose --no-cleanup

    # Test specific commits
    $0 --base abc123 --head def456

NOTES:
    - Requires funcqc to be built (npm run build)
    - Creates temporary snapshots with timestamps
    - Automatically cleans up unless --no-cleanup is specified
    - Output mirrors GitHub Actions lineage analysis format

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -b|--base)
            BASE_BRANCH="$2"
            shift 2
            ;;
        -h|--head)
            HEAD_BRANCH="$2"
            shift 2
            ;;
        -c|--no-cleanup)
            CLEANUP=false
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Check if funcqc is built
if [ ! -f "bin/funcqc.js" ]; then
    print_error "funcqc not found. Please run 'npm run build' first."
    exit 1
fi

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a git repository"
    exit 1
fi

# Validate base and head references
if ! git rev-parse --verify "$BASE_BRANCH" > /dev/null 2>&1; then
    print_error "Base reference '$BASE_BRANCH' not found"
    exit 1
fi

if ! git rev-parse --verify "$HEAD_BRANCH" > /dev/null 2>&1; then
    print_error "Head reference '$HEAD_BRANCH' not found"
    exit 1
fi

# Get actual commit hashes
BASE_COMMIT=$(git rev-parse "$BASE_BRANCH")
HEAD_COMMIT=$(git rev-parse "$HEAD_BRANCH")

print_status "Testing lineage detection between:"
echo "  Base: $BASE_BRANCH ($BASE_COMMIT)"
echo "  Head: $HEAD_BRANCH ($HEAD_COMMIT)"
echo

# Generate timestamp for unique snapshot labels
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BASE_LABEL="test-base-$TIMESTAMP"
HEAD_LABEL="test-head-$TIMESTAMP"

# Cleanup function
cleanup_snapshots() {
    if [ "$CLEANUP" = true ]; then
        print_status "Cleaning up temporary snapshots..."
        # Check if snapshots exist before attempting cleanup
        local snapshots_to_delete
        if snapshots_to_delete=$(npm run --silent dev -- history | grep -E "(test-base-$TIMESTAMP|test-head-$TIMESTAMP)" 2>/dev/null); then
            echo "$snapshots_to_delete" | while read -r snapshot_id _; do
                npm run --silent dev -- history --delete "$snapshot_id" 2>/dev/null || true
            done
        fi
        print_success "Cleanup completed"
    else
        print_warning "Skipping cleanup. Manual cleanup required:"
        echo "  npm run --silent dev -- history --delete $BASE_LABEL"
        echo "  npm run --silent dev -- history --delete $HEAD_LABEL"
    fi
}

# Set up trap for cleanup
trap cleanup_snapshots EXIT

print_status "Step 1: Analyzing base branch ($BASE_BRANCH)"
if [ "$VERBOSE" = true ]; then
    echo "Running: git checkout $BASE_BRANCH && npm run --silent dev scan --label $BASE_LABEL"
fi

# Save current branch
CURRENT_BRANCH=$(git branch --show-current)
CLEANUP_ON_EXIT=true

# Analyze base branch
git checkout "$BASE_BRANCH" > /dev/null 2>&1
if npm run --silent dev scan --label "$BASE_LABEL" > /dev/null 2>&1; then
    print_success "Base analysis completed"
else
    print_warning "Base analysis completed with warnings"
fi

print_status "Step 2: Analyzing head branch ($HEAD_BRANCH)"
if [ "$VERBOSE" = true ]; then
    echo "Running: git checkout $HEAD_BRANCH && npm run --silent dev scan --label $HEAD_LABEL"
fi

# Analyze head branch
git checkout "$HEAD_BRANCH" > /dev/null 2>&1
if npm run --silent dev scan --label "$HEAD_LABEL" > /dev/null 2>&1; then
    print_success "Head analysis completed"
else
    print_warning "Head analysis completed with warnings"
fi

# Return to original branch
if [ -n "$CURRENT_BRANCH" ]; then
    git checkout "$CURRENT_BRANCH" > /dev/null 2>&1
fi

print_status "Step 3: Generating lineage analysis"
if [ "$VERBOSE" = true ]; then
    echo "Running: npm run --silent dev -- diff $BASE_LABEL $HEAD_LABEL --lineage"
fi

# Generate lineage analysis
LINEAGE_OUTPUT=$(npm run --silent dev -- diff "$BASE_LABEL" "$HEAD_LABEL" --lineage --json 2>/dev/null || echo '{"lineages": [], "summary": {"total": 0}}')

# Parse results
TOTAL_LINEAGES=$(echo "$LINEAGE_OUTPUT" | jq -r '.summary.total // 0' 2>/dev/null || echo "0")
RENAME_COUNT=$(echo "$LINEAGE_OUTPUT" | jq -r '.lineages | map(select(.kind == "rename")) | length' 2>/dev/null || echo "0")
SIGNATURE_COUNT=$(echo "$LINEAGE_OUTPUT" | jq -r '.lineages | map(select(.kind == "signature-change")) | length' 2>/dev/null || echo "0")
SPLIT_COUNT=$(echo "$LINEAGE_OUTPUT" | jq -r '.lineages | map(select(.kind == "split")) | length' 2>/dev/null || echo "0")
INLINE_COUNT=$(echo "$LINEAGE_OUTPUT" | jq -r '.lineages | map(select(.kind == "inline")) | length' 2>/dev/null || echo "0")

print_success "Lineage analysis completed"
echo

# Display results in GitHub Actions format
echo "=================================================================="
echo "🔄 Function Lineage Analysis Report"
echo "=================================================================="
echo
echo "Base: $BASE_BRANCH ($BASE_COMMIT)"
echo "Head: $HEAD_BRANCH ($HEAD_COMMIT)"
echo
echo "📊 Summary"
echo "----------"
printf "%-20s | %s\n" "Change Type" "Count"
printf "%-20s | %s\n" "--------------------" "-----"
printf "%-20s | %s\n" "🏷️  Rename" "$RENAME_COUNT"
printf "%-20s | %s\n" "✏️  Signature Change" "$SIGNATURE_COUNT"
printf "%-20s | %s\n" "🔄 Split" "$SPLIT_COUNT"
printf "%-20s | %s\n" "📎 Inline" "$INLINE_COUNT"
printf "%-20s | %s\n" "**Total**" "**$TOTAL_LINEAGES**"
echo

if [ "$TOTAL_LINEAGES" -gt "0" ]; then
    echo "🔍 Detected Changes"
    echo "-------------------"
    
    # Format detailed lineages
    echo "$LINEAGE_OUTPUT" | jq -r '.lineages[] | 
        "\n### \(.kind | ascii_upcase): \(.from_functions[0].name // "unknown") → \(.to_functions[0].name // "unknown")\n" +
        "- **Confidence:** \((.confidence * 100) | floor)%\n" +
        "- **From:** \(.from_functions[0].file_path // "unknown"):\(.from_functions[0].start_line // "?")\n" +
        "- **To:** \(.to_functions[0].file_path // "unknown"):\(.to_functions[0].start_line // "?")\n" +
        (if .note and .note != "" then "- **Note:** \(.note)\n" else "" end)
    ' 2>/dev/null || echo "Error formatting lineage details"
    
else
    echo "✅ No function lineage changes detected."
    echo
    echo "This indicates that either:"
    echo "- No function definitions were modified"
    echo "- Changes were too minor to trigger lineage detection"
    echo "- All changes were additions/deletions rather than modifications"
fi

echo
echo "=================================================================="
echo

# Provide next steps
if [ "$TOTAL_LINEAGES" -gt "0" ]; then
    print_success "Lineage changes detected! This is what will appear in your PR."
    echo
    echo "Next steps:"
    echo "1. Review the detected changes for accuracy"
    echo "2. Consider if function names and relationships are correct"
    echo "3. Create your PR - the analysis will run automatically"
    echo "4. Use 'funcqc lineage review' commands if needed after merge"
else
    print_success "No lineage changes detected. Your PR will have a clean lineage report."
fi

echo
echo "Local testing completed successfully!"

# Show command to view raw JSON if verbose
if [ "$VERBOSE" = true ]; then
    echo
    echo "Raw JSON output:"
    echo "$LINEAGE_OUTPUT" | jq . 2>/dev/null || echo "$LINEAGE_OUTPUT"
fi