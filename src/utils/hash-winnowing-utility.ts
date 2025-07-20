/**
 * Hash Winnowing Utility - Independent implementation of the winnowing algorithm
 * for selecting representative hash values from a rolling window
 */

/**
 * Apply winnowing algorithm to reduce fingerprint count using rolling window minimum
 * This achieves O(n) complexity using a deque-based approach
 */

function cleanupDeque(deque: { value: bigint; index: number }[], currentIndex: number, windowSize: number): void {
  // Remove elements outside current window
  while (deque.length > 0 && deque[0].index <= currentIndex - windowSize) {
    deque.shift();
  }
}

function maintainMinimumProperty(deque: { value: bigint; index: number }[], currentValue: bigint): void {
  // Remove elements larger than current (they can't be minimum in future windows)
  deque: { value: bigint; index: number }[],
  windowStart: number,
  winnowed: bigint[],
  seen: Set<string>
): void {
  const minHash = deque[0].value;
  const key = `${minHash.toString()}_${windowStart}`;
export function winnowHashes(hashes: bigint[], windowSize: number): bigint[] {
  if (hashes.length === 0) return [];

  // Handle edge cases: window size larger than hash array or invalid window size
  if (windowSize <= 0 || windowSize >= hashes.length) {
    return [findMinimumHash(hashes)];
  }
    // If we have a complete window, take the minimum
    if (i >= windowSize - 1) {
      const windowStart = i - windowSize + 1;
      addMinimumToResult(deque, windowStart, winnowed, seen);
    }
  }

  return winnowed;
}

/**
 * Extract k-grams from token array
 */
export function extractKGrams(tokens: string[], k: number): string[][] {
  const kGrams: string[][] = [];
  for (let i = 0; i <= tokens.length - k; i++) {
    kGrams.push(tokens.slice(i, i + k));
  }
  return kGrams;
}
