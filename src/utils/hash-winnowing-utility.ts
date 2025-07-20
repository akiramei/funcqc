/**
 * Hash Winnowing Utility - Independent implementation of the winnowing algorithm
 * for selecting representative hash values from a rolling window
 */

/**
 * Apply winnowing algorithm to reduce fingerprint count using rolling window minimum
 * This achieves O(n) complexity using a deque-based approach
 */
function findMinimumHash(hashes: bigint[]): bigint {
  let minHash = hashes[0];
  for (let i = 1; i < hashes.length; i++) {
    if (hashes[i] < minHash) {
      minHash = hashes[i];
    }
  }
  return minHash;
}

function cleanupDeque(deque: { value: bigint; index: number }[], currentIndex: number, windowSize: number): void {
  // Remove elements outside current window
  while (deque.length > 0 && deque[0].index <= currentIndex - windowSize) {
    deque.shift();
  }
}

function maintainMinimumProperty(deque: { value: bigint; index: number }[], currentValue: bigint): void {
  // Remove elements larger than current (they can't be minimum in future windows)
  while (deque.length > 0 && deque[deque.length - 1].value > currentValue) {
    deque.pop();
  }
}

function addMinimumToResult(
  deque: { value: bigint; index: number }[],
  windowStart: number,
  winnowed: bigint[],
  seen: Set<string>
): void {
  const minHash = deque[0].value;
  const key = `${minHash.toString()}_${windowStart}`;
  if (!seen.has(key)) {
    winnowed.push(minHash);
    seen.add(key);
  }
}

export function winnowHashes(hashes: bigint[], windowSize: number): bigint[] {
  if (hashes.length === 0) return [];

  // Handle edge cases: window size larger than hash array or invalid window size
  if (windowSize <= 0 || windowSize >= hashes.length) {
    return [findMinimumHash(hashes)];
  }

  const winnowed: bigint[] = [];
  const seen = new Set<string>(); // Track hash+position to avoid exact duplicates

  // Rolling minimum with deque for O(n) complexity instead of O(n*w)
  const deque: { value: bigint; index: number }[] = [];

  for (let i = 0; i < hashes.length; i++) {
    cleanupDeque(deque, i, windowSize);
    maintainMinimumProperty(deque, hashes[i]);

    deque.push({ value: hashes[i], index: i });

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
