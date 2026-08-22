import type { HttpMethod } from '../../domain/models/attack-surface';

export interface OpenApiDiscoveredEndpoint {
  readonly path: string;
  readonly method: HttpMethod;
  readonly parameters: readonly string[];
}

/**
 * Parses OpenAPI 2.0 (Swagger) and OpenAPI 3.0 / 3.1 JSON definitions.
 * Extracts declared paths, HTTP methods, query parameters, path parameters, and request body schema keys.
 */
export function parseOpenApiSpec(specContent: string): readonly OpenApiDiscoveredEndpoint[] {
  const endpoints: OpenApiDiscoveredEndpoint[] = [];

  let spec: Record<string, unknown>;
  try {
    spec = JSON.parse(specContent);
  } catch {
    return [];
  }

  if (!spec || typeof spec !== 'object') return [];
  const pathsObj = spec.paths;
  if (!pathsObj || typeof pathsObj !== 'object') return [];

  const validMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

  for (const [pathKey, pathItem] of Object.entries(pathsObj)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [methodKey, operation] of Object.entries(pathItem as Record<string, unknown>)) {
      const upperMethod = methodKey.toUpperCase() as HttpMethod;
      if (!validMethods.includes(upperMethod)) continue;
      if (!operation || typeof operation !== 'object') continue;

      const opObj = operation as Record<string, unknown>;
      const parameters = new Set<string>();

      // 1. Extract query / path / formData / body parameters from operation.parameters
      const paramsList = Array.isArray(opObj.parameters) ? opObj.parameters : [];
      for (const p of paramsList) {
        if (p && typeof p === 'object' && typeof p.name === 'string') {
          parameters.add(p.name);
        }
      }

      // 2. Extract requestBody properties (OpenAPI 3.x)
      const requestBody = opObj.requestBody as Record<string, unknown> | undefined;
      if (requestBody && typeof requestBody === 'object') {
        const content = requestBody.content as Record<string, unknown> | undefined;
        if (content && typeof content === 'object') {
          for (const mediaTypeObj of Object.values(content)) {
            if (mediaTypeObj && typeof mediaTypeObj === 'object') {
              const schema = (mediaTypeObj as Record<string, unknown>).schema as Record<string, unknown> | undefined;
              if (schema && typeof schema === 'object') {
                const props = schema.properties as Record<string, unknown> | undefined;
                if (props && typeof props === 'object') {
                  for (const propName of Object.keys(props)) {
                    parameters.add(propName);
                  }
                }
              }
            }
          }
        }
      }

      endpoints.push({
        path: pathKey,
        method: upperMethod,
        parameters: [...parameters],
      });
    }
  }

  return endpoints;
}
