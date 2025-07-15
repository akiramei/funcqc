#!/bin/bash
# funcqc Dead Code Detection Script

echo "🔍 Detecting Dead Code in funcqc..."

# 1. Unused exports detection
echo "📦 Checking unused exports..."
npx ts-unused-exports tsconfig.json --silent > unused-exports.txt
UNUSED_COUNT=$(cat unused-exports.txt | wc -l)
echo "Found $UNUSED_COUNT files with unused exports"

# 2. Specific patterns for funcqc dead code
echo "🎯 Checking funcqc-specific dead code patterns..."

# Check for RefactoringCandidateEvaluator usage
echo "Checking RefactoringCandidateEvaluator usage:"
USAGE_COUNT=$(grep -r "RefactoringCandidateEvaluator" src/ --include="*.ts" | grep -v "export" | grep -v "import" | wc -l)
echo "  Actual usage count: $USAGE_COUNT"
if [ "$USAGE_COUNT" -eq 0 ]; then
  echo "  🚨 RefactoringCandidateEvaluator is DEAD CODE"
fi

# Check for orphaned functions (defined but never called)
echo "🔍 Checking for orphaned functions..."
grep -r "export.*function\|export.*class" src/ --include="*.ts" | while IFS= read -r line; do
  FILE=$(echo "$line" | cut -d: -f1)
  FUNC_NAME=$(echo "$line" | sed 's/.*export.*\(function\|class\) \([A-Za-z0-9_]*\).*/\2/')
  
  if [ ! -z "$FUNC_NAME" ]; then
    USAGE=$(grep -r "$FUNC_NAME" src/ --include="*.ts" | grep -v "$FILE" | wc -l)
    if [ "$USAGE" -eq 0 ]; then
      echo "  🚨 Dead function: $FUNC_NAME in $FILE"
    fi
  fi
done

# 3. Large functions that might be over-engineered
echo "📏 Checking for over-engineered functions..."
npm run --silent dev -- list --cc-ge 5 --json | jq -r '.functions[] | select(.metrics.linesOfCode > 50) | "\(.name) (\(.metrics.linesOfCode) lines, CC: \(.metrics.cyclomaticComplexity))"' | head -5

# 4. Check for recent additions that might be unused
echo "📅 Checking recent additions (potential dead code)..."
git log --since="1 week ago" --name-only --pretty=format: | sort | uniq | grep "\.ts$" | while IFS= read -r file; do
  if [ -f "$file" ]; then
    echo "Recent file: $file"
    # Check if this file exports are used
    EXPORTS=$(grep "export" "$file" | wc -l)
    if [ "$EXPORTS" -gt 0 ]; then
      echo "  Has $EXPORTS exports - checking usage..."
    fi
  fi
done

echo ""
echo "📊 Summary:"
echo "  Unused exports: $UNUSED_COUNT files"
echo "  See unused-exports.txt for details"
echo ""
echo "💡 Recommendations:"
echo "  1. Review unused-exports.txt"
echo "  2. Remove unused imports and exports"
echo "  3. Consider removing over-engineered functions"
echo "  4. Use 'npm run dev similar' to find duplicate code"