import type { TechnologySignal } from '../signal';

/**
 * Cloud / PaaS / serverless platform detection.
 */
export const CLOUD_SIGNALS: readonly TechnologySignal[] = [
  {
    name: 'AWS',
    category: 'cloud',
    confidence: 0.9,
    files: ['serverless.yml', 'serverless.yaml'],
    pkgDependencies: ['aws-sdk', 'aws-cdk', '@aws-sdk/client-s3'],
    pyDependencies: ['boto3', 'aws-cdk-lib'],
    directories: ['.aws'],
  },
  {
    name: 'Google Cloud',
    category: 'cloud',
    confidence: 0.85,
    files: ['app.yaml', 'dispatch.yaml'],
    pyDependencies: ['google-cloud'],
    pkgDependencies: ['@google-cloud/storage'],
    directories: ['.gcloudignore'],
  },
  {
    name: 'Microsoft Azure',
    category: 'cloud',
    confidence: 0.8,
    directories: ['azure'],
    files: ['azure.yaml', 'bicep.json'],
    pkgDependencies: ['@azure/identity'],
  },
  { name: 'Vercel', category: 'cloud', confidence: 0.95, files: ['vercel.json'] },
  { name: 'Netlify', category: 'cloud', confidence: 0.95, files: ['netlify.toml', 'netlify.json'] },
  { name: 'Firebase', category: 'cloud', confidence: 0.95, files: ['firebase.json', 'firebase.jsonc'], pkgDependencies: ['firebase', 'firebase-admin', '@firebase/app'] },
  { name: 'Supabase', category: 'cloud', confidence: 0.9, paths: ['supabase/config.toml'], pkgDependencies: ['@supabase/supabase-js', '@supabase/ssr'] },
  { name: 'Heroku', category: 'cloud', confidence: 0.9, files: ['Procfile', 'Procfile.dev'] },
  { name: 'Render', category: 'cloud', confidence: 0.9, files: ['render.yaml'] },
  { name: 'Railway', category: 'cloud', confidence: 0.85, files: ['railway.json', 'railway.toml'] },
  { name: 'Cloudflare Workers', category: 'cloud', confidence: 0.9, files: ['wrangler.toml', 'wrangler.jsonc'], pkgDependencies: ['wrangler'] },
  { name: 'Terraform', category: 'cloud', confidence: 0.9, globs: ['**/*.tf'], directories: ['terraform'] },
  { name: 'Pulumi', category: 'cloud', confidence: 0.85, globs: ['Pulumi.*.yaml'] },
];

/**
 * Public-API detection from config files and package dependencies.
 */
export const CLOUD_API_SIGNALS: readonly TechnologySignal[] = [
  { name: 'OpenAI', category: 'cloud', confidence: 0.9, pyDependencies: ['openai'], pkgDependencies: ['openai'] },
  { name: 'Anthropic', category: 'cloud', confidence: 0.9, pyDependencies: ['anthropic'], pkgDependencies: ['@anthropic-ai/sdk'] },
  { name: 'Stripe', category: 'cloud', confidence: 0.9, pyDependencies: ['stripe'], pkgDependencies: ['stripe', '@stripe/stripe-js'] },
  { name: 'GitHub API', category: 'cloud', confidence: 0.85, pkgDependencies: ['octokit', '@octokit/rest'], pyDependencies: ['PyGithub'] },
];