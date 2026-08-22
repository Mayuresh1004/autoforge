import { describe, expect, it } from 'vitest';
import { parseOpenApiSpec } from './openapi-parser';

describe('openapi-parser', () => {
  it('parses OpenAPI 3.0 paths and parameters', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      paths: {
        '/api/products/search': {
          get: {
            summary: 'Search products',
            parameters: [
              { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
              { name: 'limit', in: 'query', schema: { type: 'integer' } }
            ]
          }
        },
        '/api/users': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    properties: {
                      username: { type: 'string' },
                      password: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    const endpoints = parseOpenApiSpec(spec);
    expect(endpoints).toHaveLength(2);

    const search = endpoints.find((e) => e.path === '/api/products/search');
    expect(search?.method).toBe('GET');
    expect(search?.parameters).toEqual(['q', 'limit']);

    const users = endpoints.find((e) => e.path === '/api/users');
    expect(users?.method).toBe('POST');
    expect(users?.parameters).toEqual(['username', 'password']);
  });

  it('returns empty array on invalid JSON or missing paths', () => {
    expect(parseOpenApiSpec('invalid json')).toEqual([]);
    expect(parseOpenApiSpec('{}')).toEqual([]);
  });
});
