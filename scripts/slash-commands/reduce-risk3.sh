#!/bin/bash

# /reduce-risk3 - Health Intelligence-Driven Risk Reduction
# 
# Advanced refactoring workflow that leverages health command's AST analysis
# to provide intelligent, pattern-specific refactoring guidance.

set -e

# 🎨 Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 📊 Configuration
COMPLEXITY_THRESHOLD=${COMPLEXITY_THRESHOLD:-10}
SIZE_THRESHOLD=${SIZE_THRESHOLD:-40}
PRIORITY_THRESHOLD=${PRIORITY_THRESHOLD:-100}
MAX_FUNCTIONS=${MAX_FUNCTIONS:-5}

echo -e "${CYAN}🏥 /reduce-risk3 - Health Intelligence-Driven Risk Reduction${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo

# ✅ Step 1: Create Initial Snapshot
echo -e "${BLUE}📸 Step 1: Creating initial snapshot...${NC}"
INITIAL_SNAPSHOT=$(npm run --silent dev -- scan | grep -oP 'snapshot: \K[a-f0-9-]+')
echo -e "${GREEN}✓ Initial snapshot: ${INITIAL_SNAPSHOT}${NC}"
echo

# 🏥 Step 2: Health-Guided Analysis
echo -e "${BLUE}🏥 Step 2: Running health-guided analysis...${NC}"
HEALTH_ANALYSIS=$(npm run --silent dev -- refactor health-analyze --format json --limit $MAX_FUNCTIONS --complexity-threshold $COMPLEXITY_THRESHOLD --priority-threshold $PRIORITY_THRESHOLD)

# Extract high-priority functions
HIGH_PRIORITY_FUNCTIONS=$(echo "$HEALTH_ANALYSIS" | jq -r '.plans[] | 
  select(.priority >= '$PRIORITY_THRESHOLD') | 
  {
    name: .functionName,
    file: .filePath,
    complexity: .complexity,
    priority: .priority,
    impact: .estimatedImpact,
    patterns: .targetPatterns,
    suggestions: .healthSuggestions
  }')

FUNCTION_COUNT=$(echo "$HEALTH_ANALYSIS" | jq '.plans | length')
echo -e "${GREEN}✓ Analyzed ${FUNCTION_COUNT} functions with health intelligence${NC}"
echo

# 🎯 Step 3: Pattern Detection Summary
echo -e "${BLUE}🎯 Step 3: Pattern detection summary...${NC}"
PATTERN_SUMMARY=$(echo "$HEALTH_ANALYSIS" | jq -r '.plans[] | .targetPatterns[]' | sort | uniq -c | sort -nr)
echo -e "${PURPLE}Detected refactoring patterns:${NC}"
echo "$PATTERN_SUMMARY" | while read count pattern; do
  echo -e "  ${YELLOW}${count}x${NC} ${pattern}"
done
echo

# 🔄 Step 4: Create Refactoring Session
echo -e "${BLUE}🔄 Step 4: Creating refactoring session...${NC}"
SESSION_NAME="Health-Guided Risk Reduction $(date +%Y%m%d-%H%M%S)"
SESSION_DESC="Intelligent refactoring using health analysis patterns"
SESSION_RESPONSE=$(npm run --silent dev -- refactor track create "$SESSION_NAME" --description "$SESSION_DESC" --json)
SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.session.id')
echo -e "${GREEN}✓ Created session: ${SESSION_ID}${NC}"
echo

# 🌿 Step 5: Create Feature Branch
echo -e "${BLUE}🌿 Step 5: Creating feature branch...${NC}"
BRANCH_NAME="refactor/health-guided-$(date +%Y%m%d-%H%M%S)"
git checkout -b "$BRANCH_NAME"
echo -e "${GREEN}✓ Created branch: ${BRANCH_NAME}${NC}"
echo

# 📸 Step 6: Before Snapshot
echo -e "${BLUE}📸 Step 6: Creating before snapshot...${NC}"
npm run dev -- refactor snapshot create "Before health-guided refactoring - Session $SESSION_ID"
BEFORE_SNAPSHOT=$(npm run --silent dev -- list --json | jq -r '.snapshot.id')
echo -e "${GREEN}✓ Before snapshot: ${BEFORE_SNAPSHOT}${NC}"
echo

# 🛠️ Step 7: Pattern-Specific Refactoring
echo -e "${BLUE}🛠️ Step 7: Executing pattern-specific refactoring...${NC}"
echo -e "${YELLOW}Processing top ${MAX_FUNCTIONS} functions by priority...${NC}"
echo

REFACTORED_COUNT=0
IMPROVEMENT_LOG=""

# Process each high-priority function
echo "$HEALTH_ANALYSIS" | jq -c '.plans[] | select(.priority >= '$PRIORITY_THRESHOLD')' | head -n $MAX_FUNCTIONS | while read -r plan; do
  FUNC_NAME=$(echo "$plan" | jq -r '.functionName')
  FUNC_FILE=$(echo "$plan" | jq -r '.filePath')
  FUNC_COMPLEXITY=$(echo "$plan" | jq -r '.complexity')
  FUNC_PRIORITY=$(echo "$plan" | jq -r '.priority')
  FUNC_IMPACT=$(echo "$plan" | jq -r '.estimatedImpact')
  
  echo -e "${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}🔍 Refactoring: ${FUNC_NAME}${NC}"
  echo -e "   File: ${FUNC_FILE}"
  echo -e "   Complexity: ${FUNC_COMPLEXITY} | Priority: ${FUNC_PRIORITY} | Impact: ${FUNC_IMPACT}%"
  echo
  
  # Generate health-guided prompt
  echo -e "${YELLOW}📝 Generating health-guided prompt...${NC}"
  PROMPT=$(npm run --silent dev -- refactor health-prompt "$FUNC_NAME" --complexity-threshold $COMPLEXITY_THRESHOLD)
  
  # Save prompt to file for manual review
  PROMPT_FILE="refactor-prompt-${FUNC_NAME//[^a-zA-Z0-9]/-}.md"
  echo "$PROMPT" > "$PROMPT_FILE"
  echo -e "${GREEN}✓ Prompt saved to: ${PROMPT_FILE}${NC}"
  
  # Extract pattern-specific guidance
  PATTERNS=$(echo "$plan" | jq -r '.targetPatterns[]' 2>/dev/null || echo "general")
  SUGGESTIONS=$(echo "$plan" | jq -r '.healthSuggestions[]' 2>/dev/null || echo "No specific suggestions")
  
  echo -e "${CYAN}📋 Pattern-specific guidance:${NC}"
  echo "$PATTERNS" | while read pattern; do
    echo -e "   ${YELLOW}→${NC} Apply ${pattern} pattern"
  done
  echo
  
  echo -e "${CYAN}💡 Health suggestions:${NC}"
  echo "$SUGGESTIONS" | while read suggestion; do
    echo -e "   ${YELLOW}→${NC} ${suggestion}"
  done
  echo
  
  # Pattern validation preparation
  echo -e "${YELLOW}⏸️  Ready for refactoring. Review ${PROMPT_FILE} and apply changes.${NC}"
  echo -e "${YELLOW}   Press Enter when refactoring is complete...${NC}"
  read -r
  
  # Validate pattern implementation
  echo -e "${BLUE}🔍 Validating pattern implementation...${NC}"
  npm run dev scan --label "After refactoring ${FUNC_NAME}"
  
  AFTER_TEMP=$(npm run --silent dev -- list --json | jq -r '.snapshot.id')
  DIFF_RESULT=$(npm run --silent dev -- diff "$BEFORE_SNAPSHOT" "$AFTER_TEMP" --json 2>/dev/null || echo "{}")
  
  # Check for improvements
  if [[ $(echo "$DIFF_RESULT" | jq -r '.functionChanges[] | select(.name == "'$FUNC_NAME'") | .complexity.after < .complexity.before' 2>/dev/null) == "true" ]]; then
    echo -e "${GREEN}✓ Complexity reduced for ${FUNC_NAME}${NC}"
    ((REFACTORED_COUNT++))
    IMPROVEMENT_LOG="${IMPROVEMENT_LOG}\n✓ ${FUNC_NAME}: Complexity reduced"
  else
    echo -e "${YELLOW}⚠️  No complexity improvement detected for ${FUNC_NAME}${NC}"
    IMPROVEMENT_LOG="${IMPROVEMENT_LOG}\n⚠️  ${FUNC_NAME}: No improvement"
  fi
  echo
done

# 📸 Step 8: After Snapshot
echo -e "${BLUE}📸 Step 8: Creating after snapshot...${NC}"
npm run dev -- refactor snapshot create "After health-guided refactoring - Session $SESSION_ID"
AFTER_SNAPSHOT=$(npm run --silent dev -- list --json | jq -r '.snapshot.id')
echo -e "${GREEN}✓ After snapshot: ${AFTER_SNAPSHOT}${NC}"
echo

# 📊 Step 9: Validate Genuine Improvements
echo -e "${BLUE}📊 Step 9: Validating genuine improvements...${NC}"

# Get before and after statistics
BEFORE_STATS=$(npm run --silent dev -- show --id "$BEFORE_SNAPSHOT" --json | jq '.statistics')
AFTER_STATS=$(npm run --silent dev -- show --id "$AFTER_SNAPSHOT" --json | jq '.statistics')

# Calculate improvement metrics
BEFORE_HIGH_RISK=$(echo "$BEFORE_STATS" | jq -r '.highRiskFunctions // 0')
AFTER_HIGH_RISK=$(echo "$AFTER_STATS" | jq -r '.highRiskFunctions // 0')
BEFORE_AVG_COMPLEXITY=$(echo "$BEFORE_STATS" | jq -r '.averageComplexity // 0')
AFTER_AVG_COMPLEXITY=$(echo "$AFTER_STATS" | jq -r '.averageComplexity // 0')
BEFORE_TOTAL_FUNCTIONS=$(echo "$BEFORE_STATS" | jq -r '.totalFunctions // 0')
AFTER_TOTAL_FUNCTIONS=$(echo "$AFTER_STATS" | jq -r '.totalFunctions // 0')

# Function explosion detection
FUNCTION_INCREASE_RATIO=$(echo "scale=2; $AFTER_TOTAL_FUNCTIONS / $BEFORE_TOTAL_FUNCTIONS" | bc)
EXPLOSION_DETECTED=false
if (( $(echo "$FUNCTION_INCREASE_RATIO > 1.2" | bc -l) )); then
  EXPLOSION_DETECTED=true
fi

# Health check
echo -e "${BLUE}🏥 Running final health check...${NC}"
HEALTH_REPORT=$(npm run --silent dev -- health --json)
OVERALL_GRADE=$(echo "$HEALTH_REPORT" | jq -r '.overallGrade // "N/A"')
QUALITY_SCORE=$(echo "$HEALTH_REPORT" | jq -r '.overallScore // 0')

# 📈 Step 10: Generate Improvement Report
echo -e "${BLUE}📈 Step 10: Generating improvement report...${NC}"

REPORT_FILE="health-guided-improvement-report-$(date +%Y%m%d-%H%M%S).md"
cat > "$REPORT_FILE" << EOF
# 🏥 Health-Guided Refactoring Report

**Session ID**: ${SESSION_ID}
**Date**: $(date)
**Branch**: ${BRANCH_NAME}

## 📊 Overall Improvements

| Metric | Before | After | Change |
|--------|--------|--------|---------|
| High Risk Functions | ${BEFORE_HIGH_RISK} | ${AFTER_HIGH_RISK} | $(($BEFORE_HIGH_RISK - $AFTER_HIGH_RISK)) |
| Average Complexity | ${BEFORE_AVG_COMPLEXITY} | ${AFTER_AVG_COMPLEXITY} | $(echo "scale=2; $BEFORE_AVG_COMPLEXITY - $AFTER_AVG_COMPLEXITY" | bc) |
| Total Functions | ${BEFORE_TOTAL_FUNCTIONS} | ${AFTER_TOTAL_FUNCTIONS} | $(($AFTER_TOTAL_FUNCTIONS - $BEFORE_TOTAL_FUNCTIONS)) |
| Overall Grade | - | ${OVERALL_GRADE} | - |
| Quality Score | - | ${QUALITY_SCORE} | - |

## 🎯 Pattern Implementation Summary

${PATTERN_SUMMARY}

## ✅ Refactoring Results

${IMPROVEMENT_LOG}

## 🛡️ Genuine Refactoring Validation

- **Function Explosion Check**: $(if $EXPLOSION_DETECTED; then echo "⚠️ WARNING: Function count increased by ${FUNCTION_INCREASE_RATIO}x"; else echo "✓ PASSED (ratio: ${FUNCTION_INCREASE_RATIO})"; fi)
- **Complexity Improvement**: $(if (( $(echo "$AFTER_AVG_COMPLEXITY < $BEFORE_AVG_COMPLEXITY" | bc -l) )); then echo "✓ PASSED"; else echo "⚠️ NO IMPROVEMENT"; fi)
- **High Risk Reduction**: $(if (( $AFTER_HIGH_RISK < $BEFORE_HIGH_RISK )); then echo "✓ PASSED"; else echo "⚠️ NO IMPROVEMENT"; fi)

## 📸 Snapshots

- **Before**: ${BEFORE_SNAPSHOT}
- **After**: ${AFTER_SNAPSHOT}

## 🔍 Detailed Changes

$(npm run --silent dev -- diff "$BEFORE_SNAPSHOT" "$AFTER_SNAPSHOT")

---

Generated by /reduce-risk3 - Health Intelligence-Driven Risk Reduction
EOF

echo -e "${GREEN}✓ Report saved to: ${REPORT_FILE}${NC}"
echo

# 🎉 Summary
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}🎉 Health-Guided Refactoring Complete!${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo
echo -e "${PURPLE}📊 Summary:${NC}"
echo -e "   • Functions refactored: ${REFACTORED_COUNT}/${MAX_FUNCTIONS}"
echo -e "   • High risk functions: ${BEFORE_HIGH_RISK} → ${AFTER_HIGH_RISK}"
echo -e "   • Average complexity: ${BEFORE_AVG_COMPLEXITY} → ${AFTER_AVG_COMPLEXITY}"
echo -e "   • Overall grade: ${OVERALL_GRADE} (Score: ${QUALITY_SCORE})"
echo

if $EXPLOSION_DETECTED; then
  echo -e "${RED}⚠️  WARNING: Function explosion detected!${NC}"
  echo -e "${YELLOW}   This may indicate fake refactoring. Review changes carefully.${NC}"
  echo
fi

echo -e "${CYAN}📋 Next Steps:${NC}"
echo -e "   1. Review the improvement report: ${REPORT_FILE}"
echo -e "   2. Run tests: npm test"
echo -e "   3. Run linting: npm run lint"
echo -e "   4. Create PR with improvement metrics"
echo
echo -e "${GREEN}💡 Tip: Use 'npm run dev -- refactor track update ${SESSION_ID} --status completed' when done${NC}"