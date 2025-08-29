import { describe, it, expect } from 'vitest';
import { FunctionMetadataConverter } from '../../src/analyzers/function-metadata-converter';
import { toUnifiedProjectPath } from '../../src/utils/path-normalizer';
import type { FunctionInfo } from '../../src/types';

function makeFunctionInfo(overrides: Partial<FunctionInfo> = {}): FunctionInfo {
  const base: FunctionInfo = {
    id: 'func-id-1234',
    snapshotId: 'snap-1',
    semanticId: 'sem-1',
    name: 'fn',
    displayName: 'fn',
    signature: 'fn()',
    signatureHash: 'sig-1',
    filePath: 'src/cli.ts',
    fileHash: 'filehash-1',
    startLine: 1,
    endLine: 10,
    startColumn: 0,
    endColumn: 1,
    astHash: 'asthash-1',
    isExported: true,
    isAsync: false,
    isGenerator: false,
    isArrowFunction: false,
    isMethod: false,
    isConstructor: false,
    isStatic: false,
    parameters: [],
  };
  return { ...base, ...overrides } as FunctionInfo;
}

describe('Path Unification', () => {
  it('toUnifiedProjectPath normalizes to /src/... (POSIX + leading slash)', () => {
    expect(toUnifiedProjectPath('src/cli.ts')).toBe('/src/cli.ts');
    expect(toUnifiedProjectPath('./src/cli.ts')).toBe('/src/cli.ts');
    expect(toUnifiedProjectPath('/src/cli.ts')).toBe('/src/cli.ts');
    expect(toUnifiedProjectPath('src\\cli.ts')).toBe('/src/cli.ts');
    expect(toUnifiedProjectPath('C:\\repo\\src\\cli.ts').endsWith('/src/cli.ts')).toBe(true);
  });

  it('toUnifiedProjectPath strips CWD for POSIX absolute paths under project root', () => {
    const abs = `${process.cwd().replace(/\\\\/g, '/')}/src/cli.ts`;
    expect(toUnifiedProjectPath(abs)).toBe('/src/cli.ts');
  });

  it('FunctionMetadataConverter.convert produces unified /src/... paths', () => {
    const variants = [
      'src/cli.ts',
      './src/cli.ts',
      '/src/cli.ts',
      'src\\cli.ts',
    ];

    for (const fp of variants) {
      const fi = makeFunctionInfo({ id: `id-${fp}`, filePath: fp });
      const { metadataMap } = FunctionMetadataConverter.convert([fi]);
      const meta = metadataMap.get(fi.id)!;
      expect(meta.filePath).toBe('/src/cli.ts');
    }
  });
});

