
        interface IConnection {
          connect(): void;
        }
        
        class DatabaseConnection implements IConnection {
          connect(): void {
            console.log('connected');
          }
        }
      