/**
 * Domain port interface for Pull Request delivery.
 *
 * Provides a provider-neutral interface to create a Pull Request for an
 * approved remediation patch. Does not expose tokens or credentials.
 */

export interface CreatePullRequestInput {
  readonly owner: string;
  readonly repo: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly title: string;
  readonly body: string;
  readonly filePath: string;
  readonly diffContent: string;
  readonly patchId: string;
  readonly cloneUrl: string;
}

export interface CreatePullRequestResult {
  readonly prNumber: number;
  readonly prUrl: string;
  readonly commitSha: string;
  readonly headBranch: string;
  readonly prStatus: string;
}

export interface PullRequestGateway {
  createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult>;
}
