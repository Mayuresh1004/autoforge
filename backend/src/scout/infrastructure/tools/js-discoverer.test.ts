import { describe, expect, it } from 'vitest';
import { discoverEndpointsFromJs } from './js-discoverer';

describe('js-discoverer', () => {
  it('discovers fetch() API endpoints with query parameters', () => {
    const js = `
      async function searchProducts(q) {
        const res = await fetch("/api/products/search?q=" + encodeURIComponent(q));
        return res.json();
      }
    `;
    const result = discoverEndpointsFromJs(js);
    const search = result.find((e) => e.path.includes('/api/products/search'));
    expect(search).toBeDefined();
    expect(search?.method).toBe('GET');
    expect(search?.parameters).toContain('q');
  });

  it('discovers fetch template strings with query parameters', () => {
    const js = 'const url = `/api/users?id=${userId}&type=${type}`; fetch(url);';
    const result = discoverEndpointsFromJs(js);
    const users = result.find((e) => e.path.includes('/api/users'));
    expect(users).toBeDefined();
    expect(users?.parameters).toEqual(['id', 'type']);
  });

  it('discovers axios GET parameters', () => {
    const js = 'axios.get("/api/products/search", { params: { q: searchVal, page: 1 } });';
    const result = discoverEndpointsFromJs(js);
    const search = result.find((e) => e.path.includes('/api/products/search'));
    expect(search).toBeDefined();
    expect(search?.parameters).toContain('q');
    expect(search?.parameters).toContain('page');
  });

  it('discovers POST body parameter keys from JSON payloads', () => {
    const js = `
      async function postComment(author, body) {
        return axios.post("/api/comments", { author, body });
      }
    `;
    const result = discoverEndpointsFromJs(js);
    const comments = result.find((e) => e.path.includes('/api/comments'));
    expect(comments).toBeDefined();
    expect(comments?.method).toBe('POST');
    expect(comments?.parameters).toContain('author');
    expect(comments?.parameters).toContain('body');
  });
});
