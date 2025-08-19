# funcqc setup

🛠️ Unified setup and configuration command for funcqc initialization and management.

## Usage

```bash
funcqc setup [options]
```

## Description

The `setup` command consolidates initialization and configuration management into a single, intuitive interface. It handles project initialization, configuration presets, and settings management.

## Options

### Basic Options
- `--action <action>` - Action to perform (init, config, preset)
- `--preset <name>` - Use predefined configuration preset
- `--interactive` - Interactive setup mode
- `--force` - Force overwrite existing configuration
- `--verbose` - Detailed output during setup

### Configuration Options
- `--config-path <path>` - Custom configuration file path
- `--template <name>` - Use configuration template
- `--scope <scope>` - Set default analysis scope (src, test, all)
- `--output-dir <path>` - Set default output directory

## Actions

### init - Project Initialization
Initialize funcqc in your project with sensible defaults.

```bash
# Basic initialization
funcqc setup --action init

# Interactive setup with custom options
funcqc setup --action init --interactive

# Force reinitialize existing project
funcqc setup --action init --force
```

**What it does:**
- Creates `.funcqcrc` configuration file
- Sets up default analysis scope
- Configures output directories
- Initializes database schema

### config - Configuration Management
Manage funcqc configuration settings.

```bash
# View current configuration
funcqc setup --action config

# Set specific configuration values
funcqc setup --action config --scope src --output-dir ./reports

# Use interactive configuration editor
funcqc setup --action config --interactive
```

### preset - Apply Presets
Apply predefined configuration presets for common scenarios.

```bash
# Apply team development preset
funcqc setup --action preset --preset team-dev

# Apply CI/CD preset
funcqc setup --action preset --preset ci-cd

# Apply strict quality preset
funcqc setup --action preset --preset strict
```

## Available Presets

### `team-dev` - Team Development
Optimized for collaborative development:
- Moderate quality thresholds
- Comprehensive analysis scope
- Team-friendly output formats
- Regular snapshot intervals

### `ci-cd` - Continuous Integration
Optimized for automated CI/CD pipelines:
- Fast analysis levels
- JSON output formats
- Exit codes for quality gates
- Minimal console output

### `strict` - Strict Quality
High-quality standards for critical projects:
- Low complexity thresholds
- Comprehensive analysis
- Detailed reporting
- Strict quality gates

### `performance` - Performance Focused
Optimized for fast analysis:
- Quick measurement levels
- Essential analysis only
- Minimal output
- Fast processing

## Examples

### Basic Project Setup

```bash
# Initialize new project
cd my-typescript-project
funcqc setup --action init

# Verify setup
funcqc assess --type health
```

### Interactive Setup

```bash
# Start interactive configuration
funcqc setup --action init --interactive

# Follow prompts to configure:
# - Analysis scope (src/, test/, all)
# - Quality thresholds
# - Output preferences
# - CI integration
```

### Team Project Setup

```bash
# Apply team preset with custom scope
funcqc setup --action preset --preset team-dev --scope src

# Customize for your team
funcqc setup --action config --interactive
```

### CI/CD Integration

```bash
# Quick CI setup
funcqc setup --action preset --preset ci-cd

# Verify CI configuration
funcqc measure --level quick
funcqc assess --type health --json
```

## Configuration File

The `setup` command creates a `.funcqcrc` file with your project configuration:

```json
{
  "scope": "src",
  "outputDir": "./funcqc-reports",
  "measurementLevel": "standard",
  "qualityThresholds": {
    "complexity": 10,
    "risk": 50,
    "healthIndex": 60
  },
  "ciIntegration": {
    "enabled": true,
    "exitOnFailure": true,
    "outputFormat": "json"
  }
}
```

## Advanced Usage

### Custom Configuration Template

```bash
# Create configuration from template
funcqc setup --action init --template enterprise

# Apply custom configuration file
funcqc setup --action config --config-path ./custom-funcqc.json
```

### Environment-Specific Setup

```bash
# Development environment
funcqc setup --action preset --preset team-dev

# Production CI environment
funcqc setup --action preset --preset ci-cd --output-dir ./ci-reports
```

## Integration with Other Commands

After setup, other funcqc commands will use your configuration:

```bash
# Setup defines default behavior
funcqc setup --action init --scope src

# Subsequent commands use setup configuration
funcqc measure  # Uses scope=src from setup
funcqc assess   # Uses quality thresholds from setup
```

## Troubleshooting

### Common Issues

**Q: Setup fails with permission errors**
A: Ensure write permissions in project directory and try with `--force`

**Q: Configuration not taking effect**
A: Verify `.funcqcrc` exists and check for syntax errors with `--verbose`

**Q: Preset not found**
A: Use `funcqc setup --help` to see available presets

### Validation

```bash
# Validate setup
funcqc setup --action config --verbose

# Test configuration
funcqc measure --level quick
```

## See Also

- [measure](measure.md) - Project measurement and analysis
- [assess](assess.md) - Quality assessment using setup configuration
- [Migration Guide](../migration-guide.md) - Upgrading from legacy `init` and `config` commands