# Contributing to funcqc

Thank you for your interest in contributing to funcqc! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style](#code-style)
- [Submitting Changes](#submitting-changes)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/yourusername/funcqc.git
   cd funcqc
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/originalowner/funcqc.git
   ```

## Development Setup

### Prerequisites

- Node.js 18+ 
- npm 9+
- Git

### Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Start development mode
npm run dev
```

### Verify Setup

```bash
# Test the CLI locally
node dist/cli.js --help

# Run on a sample project
cd examples
node ../dist/cli.js init
node ../dist/cli.js scan
```

## Project Structure

```
funcqc/
├── src/
│   ├── cli/              # CLI command implementations
│   ├── core/             # Core business logic
│   ├── analyzers/        # Code analysis engines
│   ├── storage/          # Data persistence layer
│   ├── metrics/          # Quality metrics calculation
│   ├── types/            # TypeScript type definitions
│   └── utils/            # Utility functions
├── test/
│   ├── fixtures/         # Test data and sample files
│   ├── e2e/              # End-to-end tests
│   └── *.test.ts         # Unit tests
├── docs/                 # Documentation
└── examples/             # Usage examples and configs
```

## Development Workflow

### Creating a Feature Branch

```bash
# Sync with upstream
git fetch upstream
git checkout main
git merge upstream/main

# Create feature branch
git checkout -b feature/your-feature-name
```

### Making Changes

1. **Write tests first** (TDD approach preferred)
2. **Implement the feature** 
3. **Update documentation** if needed
4. **Add examples** for new features

### Before Committing

```bash
# Run all checks
npm run typecheck
npm run lint
npm run test
npm run test:e2e

# Fix any issues
npm run lint:fix
npm run format
```

## Testing

### Unit Tests

```bash
# Run all unit tests
npm test

# Run specific test file
npm test -- typescript-analyzer.test.ts

# Run with coverage
npm run test:coverage
```

### E2E Tests

```bash
# Run end-to-end tests
npm run test:e2e

# Run specific E2E test
npm run test:e2e -- cli.test.ts
```

### Adding Tests

- **Unit tests**: Create `*.test.ts` files alongside the code they test
- **E2E tests**: Add to `test/e2e/` directory
- **Test fixtures**: Add sample TypeScript files to `test/fixtures/`

### Test Guidelines

- Write descriptive test names
- Test edge cases and error conditions
- Use the AAA pattern (Arrange, Act, Assert)
- Mock external dependencies
- Aim for high test coverage

## Code Style

### TypeScript Guidelines

- Use **strict TypeScript** configuration
- Prefer **explicit types** over `any`
- Use **interfaces** for object shapes
- Use **enums** for constants
- Add **JSDoc comments** for public APIs

### Code Formatting

We use Prettier and ESLint:

```bash
# Auto-fix formatting issues
npm run lint:fix
npm run format

# Check formatting
npm run lint
npm run format:check
```

### Naming Conventions

- **Files**: kebab-case (`typescript-analyzer.ts`)
- **Classes**: PascalCase (`TypeScriptAnalyzer`)
- **Functions/Variables**: camelCase (`analyzeFunction`)
- **Constants**: UPPER_SNAKE_CASE (`DEFAULT_CONFIG`)
- **Types/Interfaces**: PascalCase (`FunctionInfo`)

## Submitting Changes

### Commit Messages

Use conventional commit format:

```
type(scope): description

feat(cli): add new list command filtering options
fix(analyzer): handle arrow functions in class methods
docs(readme): update installation instructions
test(e2e): add tests for scan command
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `style`, `chore`

### Pull Request Process

1. **Update your branch**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push your changes**:
   ```bash
   git push origin feature/your-feature-name
   ```

3. **Create Pull Request** on GitHub with:
   - Clear title and description
   - Reference related issues
   - Include screenshots for UI changes
   - List breaking changes

4. **Address review feedback**:
   - Make requested changes
   - Add new commits (don't force-push during review)
   - Respond to comments

5. **Final steps**:
   - Squash commits if requested
   - Ensure CI passes
   - Wait for maintainer approval

### Pull Request Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature  
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] E2E tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Tests added/updated
```

## Release Process

Releases follow semantic versioning (semver):

- **Patch** (0.1.1): Bug fixes
- **Minor** (0.2.0): New features, backward compatible
- **Major** (1.0.0): Breaking changes

## Getting Help

- **Questions**: Open a discussion on GitHub
- **Bugs**: Create an issue with the bug report template
- **Features**: Create an issue with the feature request template
- **Chat**: Join our community discussions

## Recognition

Contributors will be recognized in:
- README.md contributors section
- Release notes for significant contributions
- GitHub contributor graphs

Thank you for contributing to funcqc! 🎉
