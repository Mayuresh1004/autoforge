# PROJECT_RULES.md

## Never

- Generate code without types.

- Execute exploits outside Docker.

- Store secrets in Git.

- Bypass the Repository Analyzer.

- Allow agents to communicate directly without LangGraph.

- Merge generated patches automatically.

- Use any in TypeScript unless justified.

## Always

- Keep modules independent.

- Use DTOs at API boundaries.

- Log every agent execution.

- Validate inputs.

- Write integration tests for agent workflows.

- Keep prompts version-controlled.