declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, any>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    }
    const local: StorageArea;
  }

  namespace runtime {
    interface MessageSender {
      tab?: { id?: number; url?: string };
      url?: string;
      id?: string;
    }
    function sendMessage<T = any>(message: unknown): Promise<T>;
    const onMessage: {
      addListener(
        callback: (
          message: any,
          sender: MessageSender,
          sendResponse: (response?: any) => void
        ) => boolean | void
      ): void;
    };
    function getManifest(): {
      version: string;
      name: string;
      host_permissions?: string[];
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      active?: boolean;
    }
    function create(createProperties: { url: string; active?: boolean }): Promise<Tab>;
    function query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
    function sendMessage<T = any>(tabId: number, message: unknown): Promise<T>;
  }
}

