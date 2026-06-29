/**
 * Minimal ambient types for `@alicloud/pop-core` (the package ships no `.d.ts`
 * and there is no `@types/alicloud__pop-core`). We only use `RPCClient` to call
 * a couple of Alibaba IMM RPC actions, so the surface declared here is
 * deliberately narrow.
 */
declare module '@alicloud/pop-core' {
  export interface RPCClientConfig {
    accessKeyId: string;
    accessKeySecret: string;
    securityToken?: string;
    endpoint: string;
    apiVersion: string;
    opts?: Record<string, unknown>;
  }

  export interface RPCRequestOptions {
    method?: 'GET' | 'POST';
    formatParams?: boolean;
    timeout?: number;
    [key: string]: unknown;
  }

  export class RPCClient {
    constructor(config: RPCClientConfig);
    request<T = Record<string, unknown>>(
      action: string,
      params?: Record<string, unknown>,
      options?: RPCRequestOptions,
    ): Promise<T>;
  }

  export class ROAClient {
    constructor(config: RPCClientConfig);
  }

  const _default: {
    RPCClient: typeof RPCClient;
    ROAClient: typeof ROAClient;
  };
  export default _default;
}
