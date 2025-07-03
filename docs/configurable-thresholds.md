# Configurable Quality Thresholds

This document explains how to configure custom quality thresholds for funcqc's enhanced quality scorer.

## Overview

The enhanced quality scorer (v1.6) supports configurable thresholds for:
- **Complexity penalties**: Warning and critical thresholds for cyclomatic complexity
- **Size penalties**: Warning and critical thresholds for lines of code  
- **Maintainability thresholds**: Critical and warning levels for maintainability index
- **Grading boundaries**: Letter grade assignment (A, B, C, D, F)

## Configuration Format

### Basic Configuration File

Create a `.funcqcrc` (JSON) or `funcqc.config.js` file in your project root:

```json
{
  "funcqcThresholds": {
    "quality": {
      "complexity": {
        "warning": 8,
        "critical": 15,
        "warningPenalty": 10,
        "criticalPenalty": 20
      },
      "size": {
        "warning": 30,
        "critical": 80,
        "warningPenalty": 3,
        "criticalPenalty": 8
      },
      "maintainability": {
        "critical": 40,
        "warning": 65
      },
      "grading": {
        "A": 95,
        "B": 85,
        "C": 75,
        "D": 65
      }
    }
  }
}
```

### JavaScript Configuration

```javascript
// funcqc.config.js
export default {
  funcqcThresholds: {
    quality: {
      complexity: {
        warning: 8,
        critical: 15,
        warningPenalty: 10,
        criticalPenalty: 20
      },
      grading: {
        A: 95,
        B: 85,  
        C: 75,
        D: 65
      }
    }
  }
};
```

## Default Values

If not specified, funcqc uses these default thresholds:

```typescript
{
  complexity: {
    warning: 5,        // Functions with complexity > 5 get penalty
    critical: 10,      // Functions with complexity > 10 get higher penalty
    warningPenalty: 8, // Points deducted per unit over warning threshold
    criticalPenalty: 15 // Additional points deducted per unit over critical threshold
  },
  size: {
    warning: 20,       // Functions with > 20 lines get penalty
    critical: 50,      // Functions with > 50 lines get higher penalty  
    warningPenalty: 2, // Points deducted per line over warning threshold
    criticalPenalty: 5 // Additional points deducted per line over critical threshold
  },
  maintainability: {
    critical: 50,      // Functions with maintainability < 50 are critical
    warning: 70        // Functions with maintainability < 70 are problematic
  },
  grading: {
    A: 90,            // Scores >= 90 get grade A
    B: 80,            // Scores >= 80 get grade B
    C: 70,            // Scores >= 70 get grade C
    D: 60             // Scores >= 60 get grade D (< 60 is F)
  }
}
```

## Project-Specific Recommendations

### Small Projects (< 10k LOC)
Use stricter thresholds to maintain high quality:

```json
{
  "funcqcThresholds": {
    "quality": {
      "complexity": {
        "warning": 4,
        "critical": 8
      },
      "size": {
        "warning": 15,
        "critical": 30
      }
    }
  }
}
```

### Large Projects (> 100k LOC)
Use more lenient thresholds to accommodate complexity:

```json
{
  "funcqcThresholds": {
    "quality": {
      "complexity": {
        "warning": 8,
        "critical": 15
      },
      "size": {
        "warning": 40,
        "critical": 100
      },
      "grading": {
        "A": 85,
        "B": 75,
        "C": 65,
        "D": 55
      }
    }
  }
}
```

### Legacy Projects
Use very lenient thresholds during modernization:

```json
{
  "funcqcThresholds": {
    "quality": {
      "complexity": {
        "warning": 12,
        "critical": 20,
        "warningPenalty": 5,
        "criticalPenalty": 10
      },
      "size": {
        "warning": 50,
        "critical": 150
      },
      "grading": {
        "A": 80,
        "B": 70,
        "C": 60,
        "D": 50
      }
    }
  }
}
```

## Programmatic Usage

You can also configure thresholds programmatically:

```typescript
import { QualityScorerV16 } from 'funcqc';

// Create scorer with custom thresholds
const customThresholds = {
  complexity: {
    warning: 8,
    critical: 15,
    warningPenalty: 10,
    criticalPenalty: 20
  }
};

const scorer = new QualityScorerV16(undefined, customThresholds);

// Get current thresholds
const currentThresholds = scorer.getThresholds();

// Update thresholds
scorer.updateThresholds({
  grading: {
    A: 95,
    B: 85,
    C: 75,
    D: 65
  }
});
```

## Validation Rules

The system validates threshold configurations:

1. **Complexity**: Warning threshold must be less than critical threshold
2. **Size**: Warning threshold must be less than critical threshold  
3. **Maintainability**: Critical threshold must be less than warning threshold
4. **Grading**: Thresholds must be in descending order (A > B > C > D)
5. **Penalties**: Must be positive numbers
6. **All thresholds**: Must be positive numbers within reasonable ranges

Invalid configurations will throw validation errors with specific details.

## Migration from Hard-coded Values

If you were relying on the previous hard-coded values:
- Complexity: warning=5, critical=10, penalties=8/15
- Size: warning=20, critical=50, penalties=2/5
- Grading: A=90, B=80, C=70, D=60

These remain the default values, so existing behavior is preserved unless you explicitly configure new thresholds.

## Configuration Priority

Threshold configurations are merged in this order:
1. Built-in defaults (lowest priority)
2. Configuration file values
3. Programmatic overrides (highest priority)

Only specified values are overridden; unspecified values retain their defaults.