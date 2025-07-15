#!/bin/bash
# Detect private dead code (non-exported unused functions)

echo "🔍 Detecting Private Dead Code..."

# Function to check if a function is called within a file
check_function_usage() {
  local file="$1"
  local func_name="$2"
  
  # Count occurrences (excluding the definition line)
  local usage_count=$(grep -n "$func_name" "$file" | grep -v "function $func_name\|const $func_name\|= $func_name" | wc -l)
  echo "$usage_count"
}

# Find all TypeScript files
find src -name "*.ts" -type f | while read file; do
  echo "Analyzing: $file"
  
  # Extract function definitions (non-exported)
  grep -n "^\s*function\|^\s*const.*=.*function\|^\s*const.*=.*=>" "$file" | grep -v "export" | while IFS= read -r line; do
    line_num=$(echo "$line" | cut -d: -f1)
    func_line=$(echo "$line" | cut -d: -f2-)
    
    # Extract function name
    func_name=""
    if echo "$func_line" | grep -q "function "; then
      func_name=$(echo "$func_line" | sed 's/.*function \([A-Za-z0-9_]*\).*/\1/')
    elif echo "$func_line" | grep -q "const.*="; then
      func_name=$(echo "$func_line" | sed 's/.*const \([A-Za-z0-9_]*\).*/\1/')
    fi
    
    if [ ! -z "$func_name" ] && [ "$func_name" != "function" ]; then
      # Check usage in the same file
      usage_count=$(check_function_usage "$file" "$func_name")
      
      if [ "$usage_count" -eq 0 ]; then
        echo "  🚨 DEAD PRIVATE FUNCTION: $func_name (line $line_num)"
        echo "     Definition: $(echo "$func_line" | sed 's/^[[:space:]]*//')"
      fi
    fi
  done
  echo ""
done

echo "🔍 Checking method calls within classes..."

# Check for unused private methods in classes
find src -name "*.ts" -type f | while IFS= read -r file; do
  # Extract private methods
  grep -n "private.*(" "$file" | while IFS= read -r line; do
    line_num=$(echo "$line" | cut -d: -f1)
    method_line=$(echo "$line" | cut -d: -f2-)
    
    # Extract method name
    method_name=$(echo "$method_line" | sed 's/.*private \([A-Za-z0-9_]*\).*/\1/')
    
    if [ ! -z "$method_name" ] && [ "$method_name" != "private" ]; then
      # Check if method is called (this.methodName or just methodName)
      usage_count=$(grep -c "\.$method_name\|this\.$method_name" "$file")
      
      if [ "$usage_count" -eq 0 ]; then
        echo "  🚨 DEAD PRIVATE METHOD: $method_name in $file (line $line_num)"
      fi
    fi
  done
done