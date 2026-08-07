/**
 * Domain models produced by API / route discovery.
 */

export type ApiProtocol = 'rest' | 'graphql' | 'websocket' | 'rpc';

export interface ApiEndpoint {
  /** `GET`, `POST`, ... or `ANY` when the method is not specified. */
  readonly method: string;
  /** Route template as declared (may include path params). */
  readonly path: string;
  /** Source file that declares the route. */
  readonly file: string;
}

export interface ApiInventory {
  readonly endpoints: readonly ApiEndpoint[];
  /** Communication protocols found (rest/graphql/websocket/rpc). */
  readonly protocols: readonly ApiProtocol[];
  /** Files that look like GraphQL schemas/manifests. */
  readonly graphqlSources: readonly string[];
}