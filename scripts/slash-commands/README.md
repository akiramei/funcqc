# funcqc Slash Commands

This directory contains custom slash commands for funcqc that integrate with Claude AI to provide intelligent refactoring workflows.

## Available Commands

### `/reduce-risk3`

Advanced health intelligence-driven risk reduction workflow that leverages funcqc's health analysis capabilities for pattern-specific refactoring.

**Key Features:**
- Uses `refactor health-analyze` for intelligent function prioritization
- Generates pattern-specific refactoring prompts with `refactor health-prompt`
- Detects and prevents fake refactoring (function explosion)
- Provides comprehensive validation and reporting

**Usage:**
1. Copy the command content from `reduce-risk3.md`
2. Create a custom slash command in Claude
3. Execute the command when you need intelligent refactoring guidance

## How to Use Custom Slash Commands

1. **In Claude Interface:**
   - Click on the slash (/) menu
   - Select "Create custom command"
   - Name it `/reduce-risk3`
   - Paste the content from `reduce-risk3.md`

2. **During Refactoring:**
   - Type `/reduce-risk3` in Claude
   - Follow the guided workflow
   - Claude will help execute each step with health intelligence

## Command Philosophy

These commands are designed to:
- Leverage funcqc's health analysis for intelligent decision making
- Focus on genuine code quality improvements, not metric gaming
- Provide pattern-specific guidance based on AST analysis
- Validate improvements to ensure real complexity reduction

## Contributing

When creating new slash commands:
1. Focus on AI-friendly prompts, not executable scripts
2. Include clear step-by-step instructions
3. Leverage funcqc's advanced features (health analysis, pattern detection)
4. Always include validation steps to ensure genuine improvements
5. Document expected outcomes and success criteria