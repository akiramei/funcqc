export const arrowAdd = (a: number, b: number): number => a + b;

export const arrowMultiply = (x: number, y: number): number => {
  return x * y;
};

const privateHelper = (value: string): boolean => {
  return value.trim().length > 0;
};

export const processArray = (items: string[]): string[] => {
  return items
    .filter(privateHelper)
    .map(item => item.toUpperCase())
    .sort();
};
