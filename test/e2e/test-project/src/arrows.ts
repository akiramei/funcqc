export const arrowAdd = (a: number, b: number): number => a + b;

export const arrowMultiply = (x: number, y: number): number => {
  return x * y;
};

export const processArray = (items: string[]): string[] => {
  return items
    .filter(item => item.length > 0)
    .map(item => item.toUpperCase())
    .sort();
};

const privateHelper = (value: string): boolean => {
  return value.trim().length > 0;
};
