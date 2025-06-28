export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(x: number, y: number): number {
  return x * y;
}

export async function fetchData(url: string): Promise<any> {
  const response = await fetch(url);
  return response.json();
}
