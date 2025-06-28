export async function fetchUser(id: string): Promise<User> {
  if (!id) {
    throw new Error('User ID is required');
  }
  
  const response = await fetch(`/api/users/${id}`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch user: ${response.statusText}`);
  }
  
  return response.json();
}

export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

class UserService {
  constructor(private apiKey: string) {}
  
  async getUser(id: string): Promise<User> {
    return this.fetchWithAuth(`/users/${id}`);
  }
  
  private async fetchWithAuth(url: string): Promise<any> {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });
    
    return response.json();
  }
}

interface User {
  id: string;
  name: string;
  email: string;
}

interface Item {
  id: string;
  name: string;
  price: number;
}
