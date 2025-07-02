/**
 * Hash Winnowing Utility - Independent implementation of the winnowing algorithm
 * for selecting representative hash values from a rolling window
 */

/**
 * Apply winnowing algorithm to reduce fingerprint count using rolling window minimum
 * This achieves O(n) complexity using a deque-based approach
 */
export function winnowHashes(hashes: bigint[], windowSize: number): bigint[] {
  if (hashes.length === 0) return [];
  
  // Handle edge cases: window size larger than hash array or invalid window size
  if (windowSize <= 0 || windowSize >= hashes.length) {
    // Find minimum bigint value without type conversion to avoid precision loss
    let minHash = hashes[0];
    for (let i = 1; i < hashes.length; i++) {
      if (hashes[i] < minHash) {
        minHash = hashes[i];
      }
    }
    return [minHash];
  }
  
  const winnowed: bigint[] = [];
  const seen = new Set<string>(); // Track hash+position to avoid exact duplicates
  
  // Rolling minimum with deque for O(n) complexity instead of O(n*w)
  const deque: { value: bigint; index: number }[] = [];
  
  for (let i = 0; i < hashes.length; i++) {
    // Remove elements outside current window
    while (deque.length > 0 && deque[0].index <= i - windowSize) {
      deque.shift();
    }
    
    // Remove elements larger than current (they can't be minimum in future windows)
    while (deque.length > 0 && deque[deque.length - 1].value > hashes[i]) {
      deque.pop();
    }
    
    deque.push({ value: hashes[i], index: i });
    
    // If we have a complete window, take the minimum
    if (i >= windowSize - 1) {
      const minHash = deque[0].value;
      const windowStart = i - windowSize + 1;
      
      // Add with position info to avoid duplicates while preserving different positions
      const key = `${minHash.toString()}_${windowStart}`;
      if (!seen.has(key)) {
        winnowed.push(minHash);
        seen.add(key);
      }
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