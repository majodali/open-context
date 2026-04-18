/**
 * SDLC Evaluation Suite
 *
 * Hand-crafted benchmark for software engineering retrieval.
 * Models a small SaaS Todo project with bounded contexts for auth, API,
 * frontend, database, and deployment.
 *
 * Designed to test:
 * - Direct queries (basic vector retrieval)
 * - Conceptual queries (semantic understanding)
 * - Cross-context queries (hierarchical retrieval value)
 * - Methodological queries (surfacing practices for domain tasks)
 *
 * The judgments are the author's best estimate of relevance — they should
 * be reviewed and refined based on actual usage outcomes.
 */

import type { EvaluationSuite, BenchmarkContext, BenchmarkUnit, BenchmarkQuery } from './types.js';

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

const contexts: BenchmarkContext[] = [
  { id: 'root', name: 'SaaS Todo Project', description: 'Full-stack SaaS Todo application' },
  { id: 'auth', name: 'Authentication', description: 'Auth, JWT, sessions', parentId: 'root' },
  { id: 'api', name: 'API', description: 'REST endpoints, middleware', parentId: 'root' },
  { id: 'frontend', name: 'Frontend', description: 'React UI', parentId: 'root' },
  { id: 'database', name: 'Database', description: 'PostgreSQL schema', parentId: 'root' },
  { id: 'deployment', name: 'Deployment', description: 'AWS CDK', parentId: 'root' },
];

// ---------------------------------------------------------------------------
// Units (with stable corpus IDs)
// ---------------------------------------------------------------------------

const units: BenchmarkUnit[] = [
  // ── Methodological (root) ──
  {
    corpusId: 'method-vmodel',
    contextId: 'root',
    contentType: 'instruction',
    tags: ['methodology', 'planning', 'v-model'],
    content:
      'Follow V-model decomposition: design and test specification go top-down together. ' +
      'At each level, define what done looks like before breaking down further. The test ' +
      'specification at each level validates the design at that level.',
  },
  {
    corpusId: 'method-bdd',
    contextId: 'root',
    contentType: 'instruction',
    tags: ['methodology', 'testing', 'bdd'],
    content:
      'Behavior specifications use Given-When-Then format. Given a precondition, when an ' +
      'action occurs, then verify the expected outcome. Each scenario tests one specific ' +
      'behavior, not a sequence of behaviors.',
  },
  {
    corpusId: 'method-spec-by-example',
    contextId: 'root',
    contentType: 'rule',
    tags: ['methodology', 'specification', 'bdd'],
    content:
      'Prefer specification by example over abstract descriptions. Do not describe behavior ' +
      'abstractly when a concrete example can be given. Examples serve as both specification ' +
      'and test cases.',
  },
  {
    corpusId: 'method-tests-as-spec',
    contextId: 'root',
    contentType: 'rule',
    tags: ['methodology', 'testing', 'specification'],
    content:
      'Tests are executable specifications, not afterthoughts. A modules integration tests ' +
      'define its contract. A components behavior tests define its functionality. The ' +
      'implementation satisfies the specification.',
  },
  {
    corpusId: 'method-incremental',
    contextId: 'root',
    contentType: 'rule',
    tags: ['methodology', 'delivery'],
    content:
      'Each increment should leave the system in a valid state. All existing tests pass, ' +
      'no architectural regressions, the increment is cohesive. Prefer small, complete ' +
      'increments over large, incomplete ones.',
  },
  {
    corpusId: 'method-refactor-vs-rewrite',
    contextId: 'root',
    contentType: 'rule',
    tags: ['methodology', 'refactoring'],
    content:
      'Refactoring changes structure without changing behavior, verified by existing tests. ' +
      'Changing behavior requires updating the specification first, then the implementation. ' +
      'Never do both at once.',
  },
  {
    corpusId: 'method-error-handling',
    contextId: 'root',
    contentType: 'rule',
    tags: ['methodology', 'error-handling'],
    content:
      'Handle errors at the level that has enough context to make a meaningful decision. ' +
      'Do not catch exceptions just to log and rethrow. Let errors propagate to where they ' +
      'can be properly handled or reported.',
  },
  {
    corpusId: 'method-consider-alternatives',
    contextId: 'root',
    contentType: 'rule',
    tags: ['methodology', 'epistemic', 'critical-analysis'],
    content:
      'Before adopting any approach, explicitly consider at least one alternative. This is ' +
      'not endless deliberation — it is a brief check to catch premature commitment.',
  },
  {
    corpusId: 'method-naming',
    contextId: 'root',
    contentType: 'instruction',
    tags: ['methodology', 'code-quality'],
    content:
      'Name things for what they represent in the domain, not for their technical ' +
      'implementation. A function called calculateShippingCost is better than processData. ' +
      'Names are documentation.',
  },
  {
    corpusId: 'method-api-validation',
    contextId: 'root',
    contentType: 'rule',
    tags: ['methodology', 'api-design'],
    content:
      'Every public API should have clear input validation, documented error cases, and ' +
      'consistent error formats. Internal functions can trust their callers; external ' +
      'boundaries must not.',
  },

  // ── Project root ──
  {
    corpusId: 'project-overview',
    contextId: 'root',
    contentType: 'fact',
    tags: ['project', 'overview'],
    content:
      'Project: Full-stack SaaS Todo application. TypeScript throughout. Node.js backend, ' +
      'React frontend. PostgreSQL database. Deploy to AWS using CDK.',
  },
  {
    corpusId: 'project-architecture',
    contextId: 'root',
    contentType: 'fact',
    tags: ['project', 'architecture'],
    content:
      'Architecture: monorepo with packages for api, web, shared. The api package is an ' +
      'Express.js server. The web package is a React SPA. The shared package contains ' +
      'domain types and validation logic used by both.',
  },
  {
    corpusId: 'project-api-conventions',
    contextId: 'root',
    contentType: 'rule',
    tags: ['project', 'conventions'],
    content:
      'All API responses follow JSON:API specification. All dates use ISO 8601 format in ' +
      'UTC. All IDs are UUIDs.',
  },
  {
    corpusId: 'project-db-decision',
    contextId: 'root',
    contentType: 'decision',
    tags: ['project', 'database', 'rationale'],
    content:
      'Decision: use PostgreSQL for the database because we need ACID transactions, complex ' +
      'queries, and the team has PostgreSQL experience.',
  },

  // ── Auth ──
  {
    corpusId: 'auth-jwt-rs256',
    contextId: 'auth',
    contentType: 'fact',
    tags: ['auth', 'jwt', 'tokens', 'applies-to:JWTToken'],
    content:
      'Authentication uses JWT tokens with RS256 signing algorithm. Access tokens expire ' +
      'after 1 hour. Refresh tokens expire after 30 days and are rotated on each use.',
  },
  {
    corpusId: 'auth-validate-tokens',
    contextId: 'auth',
    contentType: 'rule',
    tags: ['auth', 'validation', 'security', 'applies-to:JWTToken'],
    content:
      'Always validate the JWT token signature before processing any request. Verify the ' +
      'issuer claim, audience claim, and expiration. Reject tokens with missing or invalid claims.',
  },
  {
    corpusId: 'auth-bcrypt',
    contextId: 'auth',
    contentType: 'rule',
    tags: ['auth', 'passwords', 'security'],
    content:
      'Store password hashes using bcrypt with cost factor 12. Never store plaintext ' +
      'passwords. Never log password values even in debug mode.',
  },
  {
    corpusId: 'auth-login-endpoint',
    contextId: 'auth',
    contentType: 'fact',
    tags: ['auth', 'endpoints', 'login'],
    content:
      'Login endpoint: POST /api/v1/auth/login. Accepts email and password. Returns ' +
      'access token and refresh token. Rate limited to 5 attempts per minute per email.',
  },
  {
    corpusId: 'auth-register-endpoint',
    contextId: 'auth',
    contentType: 'fact',
    tags: ['auth', 'endpoints', 'registration'],
    content:
      'Registration endpoint: POST /api/v1/auth/register. Accepts email, password, and ' +
      'display name. Validates email format, password strength minimum 8 characters with ' +
      'mixed case and number.',
  },
  {
    corpusId: 'auth-refresh-endpoint',
    contextId: 'auth',
    contentType: 'fact',
    tags: ['auth', 'endpoints', 'refresh'],
    content:
      'Token refresh endpoint: POST /api/v1/auth/refresh. Accepts refresh token. Returns ' +
      'new access token and new refresh token. Old refresh token is invalidated immediately.',
  },
  {
    corpusId: 'auth-middleware',
    contextId: 'auth',
    contentType: 'fact',
    tags: ['auth', 'middleware', 'implementation'],
    content:
      'Auth middleware extracts the Bearer token from the Authorization header. Validates ' +
      'the token. Attaches the decoded user to the request context. Returns 401 if token ' +
      'is missing or invalid.',
  },
  {
    corpusId: 'auth-rs256-rationale',
    contextId: 'auth',
    contentType: 'decision',
    tags: ['auth', 'jwt', 'rationale'],
    content:
      'Decision: use RS256 over HS256 for JWT signing because it allows token verification ' +
      'without sharing the private key. The public key can be distributed to any service ' +
      'that needs to verify tokens.',
  },

  // ── API ──
  {
    corpusId: 'api-rest-conventions',
    contextId: 'api',
    contentType: 'rule',
    tags: ['api', 'rest', 'conventions'],
    content:
      'REST endpoints follow /api/v1/{resource} pattern. Use plural nouns for resource ' +
      'names. Use HTTP methods correctly: GET for reads, POST for creates, PATCH for ' +
      'updates, DELETE for removes.',
  },
  {
    corpusId: 'api-auth-required',
    contextId: 'api',
    contentType: 'rule',
    tags: ['api', 'auth', 'endpoints'],
    content:
      'All endpoints require authentication except POST /api/v1/auth/login, POST ' +
      '/api/v1/auth/register, and GET /api/v1/health.',
  },
  {
    corpusId: 'api-rate-limiting',
    contextId: 'api',
    contentType: 'rule',
    tags: ['api', 'rate-limiting', 'security'],
    content:
      'Rate limiting: 100 requests per minute per authenticated user. 20 requests per ' +
      'minute for unauthenticated endpoints. Return 429 Too Many Requests when exceeded ' +
      'with Retry-After header.',
  },
  {
    corpusId: 'api-todos-crud',
    contextId: 'api',
    contentType: 'fact',
    tags: ['api', 'todos', 'endpoints'],
    content:
      'Todo CRUD endpoints: GET /api/v1/todos (list, paginated), POST /api/v1/todos ' +
      '(create), GET /api/v1/todos/:id (read), PATCH /api/v1/todos/:id (update), DELETE ' +
      '/api/v1/todos/:id (soft delete). Users can only access their own todos.',
  },
  {
    corpusId: 'api-pagination',
    contextId: 'api',
    contentType: 'fact',
    tags: ['api', 'pagination'],
    content:
      'Pagination uses cursor-based approach. Default page size 20, maximum 100. Response ' +
      'includes next cursor and total count.',
  },
  {
    corpusId: 'api-error-format',
    contextId: 'api',
    contentType: 'rule',
    tags: ['api', 'errors', 'conventions'],
    content:
      'Error responses use problem details format (RFC 7807). Include type, title, status, ' +
      'detail, and instance fields. For validation errors, include a list of field-specific ' +
      'errors.',
  },
  {
    corpusId: 'api-express-middleware',
    contextId: 'api',
    contentType: 'instruction',
    tags: ['api', 'express', 'middleware'],
    content:
      'Use Express.js middleware chain: request logging, CORS, body parsing, ' +
      'authentication, rate limiting, route handler, error handler. Middleware order ' +
      'matters — authentication must come before route handlers.',
  },
  {
    corpusId: 'api-cors',
    contextId: 'api',
    contentType: 'rule',
    tags: ['api', 'cors', 'security'],
    content:
      'API must return CORS headers allowing the frontend origin. In development allow ' +
      'localhost:3000. In production allow only the configured domain.',
  },

  // ── Frontend ──
  {
    corpusId: 'frontend-react-conventions',
    contextId: 'frontend',
    contentType: 'rule',
    tags: ['frontend', 'react', 'conventions'],
    content:
      'Frontend uses React 18 with TypeScript strict mode. Functional components only, no ' +
      'class components. Use hooks for state and effects.',
  },
  {
    corpusId: 'frontend-data-fetching',
    contextId: 'frontend',
    contentType: 'instruction',
    tags: ['frontend', 'data-fetching', 'tanstack-query'],
    content:
      'Data fetching uses TanStack Query (React Query). Define query keys consistently as ' +
      'arrays: [resource, id?, filters?]. Use mutations for write operations with ' +
      'optimistic updates where appropriate.',
  },
  {
    corpusId: 'frontend-styling',
    contextId: 'frontend',
    contentType: 'rule',
    tags: ['frontend', 'styling', 'tailwind'],
    content:
      'Styling uses Tailwind CSS. No custom CSS files except for global resets. Component ' +
      'variants use class-variance-authority (cva). Design tokens defined in tailwind.config.',
  },
  {
    corpusId: 'frontend-auth-cookies',
    contextId: 'frontend',
    contentType: 'rule',
    tags: ['frontend', 'auth', 'security'],
    content:
      'Store auth tokens in httpOnly cookies set by the server, never in localStorage or ' +
      'sessionStorage. The frontend sends credentials with every request via fetch ' +
      'credentials: include.',
  },
  {
    corpusId: 'frontend-structure',
    contextId: 'frontend',
    contentType: 'instruction',
    tags: ['frontend', 'structure', 'organization'],
    content:
      'Component structure: pages in /pages, reusable components in /components, hooks in ' +
      '/hooks, API client functions in /api. Colocate tests with source files using .test.tsx suffix.',
  },
  {
    corpusId: 'frontend-forms',
    contextId: 'frontend',
    contentType: 'instruction',
    tags: ['frontend', 'forms', 'validation'],
    content:
      'Forms use react-hook-form with zod validation schemas. Validation schemas are ' +
      'shared between frontend and API via the shared package.',
  },
  {
    corpusId: 'frontend-routing',
    contextId: 'frontend',
    contentType: 'fact',
    tags: ['frontend', 'routing', 'auth'],
    content:
      'Routing uses React Router v6. Protected routes redirect to login. After login, ' +
      'redirect back to the originally requested page.',
  },

  // ── Database ──
  {
    corpusId: 'db-migrations',
    contextId: 'database',
    contentType: 'rule',
    tags: ['database', 'migrations'],
    content:
      'Database migrations use a versioned migration tool. Each migration has an up and ' +
      'down function. Migrations are applied in order and tracked in a migrations table. ' +
      'Never modify a migration that has been applied.',
  },
  {
    corpusId: 'db-users-table',
    contextId: 'database',
    contentType: 'fact',
    tags: ['database', 'schema', 'users', 'applies-to:User'],
    content:
      'Users table: id (UUID, PK), email (unique, not null), password_hash (not null), ' +
      'display_name (not null), created_at (timestamp), updated_at (timestamp), ' +
      'deleted_at (nullable timestamp for soft delete).',
  },
  {
    corpusId: 'db-todos-table',
    contextId: 'database',
    contentType: 'fact',
    tags: ['database', 'schema', 'todos', 'applies-to:TodoItem'],
    content:
      'Todos table: id (UUID, PK), user_id (UUID, FK to users, not null), title (not null), ' +
      'description (nullable text), completed (boolean, default false), due_date (nullable ' +
      'timestamp), created_at, updated_at, deleted_at.',
  },
  {
    corpusId: 'db-tokens-table',
    contextId: 'database',
    contentType: 'fact',
    tags: ['database', 'schema', 'tokens', 'applies-to:JWTToken'],
    content:
      'Refresh tokens table: id (UUID, PK), user_id (UUID, FK), token_hash (not null, ' +
      'unique), expires_at (timestamp, not null), revoked_at (nullable timestamp), created_at.',
  },
  {
    corpusId: 'db-transactions',
    contextId: 'database',
    contentType: 'rule',
    tags: ['database', 'transactions'],
    content:
      'Use database transactions for operations that modify multiple tables. The token ' +
      'refresh operation must invalidate the old token and create the new one atomically.',
  },
  {
    corpusId: 'db-indexes',
    contextId: 'database',
    contentType: 'instruction',
    tags: ['database', 'indexes'],
    content:
      'Index strategy: unique index on users.email, index on todos.user_id, index on ' +
      'refresh_tokens.token_hash, index on refresh_tokens.user_id. Add indexes based on ' +
      'query patterns, not speculatively.',
  },

  // ── Deployment ──
  {
    corpusId: 'deploy-aws-cdk',
    contextId: 'deployment',
    contentType: 'fact',
    tags: ['deployment', 'aws', 'cdk'],
    content:
      'Deploy to AWS using CDK. Infrastructure defined as code in an infra package within ' +
      'the monorepo. Environments: dev, staging, production. Each environment has isolated resources.',
  },
  {
    corpusId: 'deploy-cicd',
    contextId: 'deployment',
    contentType: 'instruction',
    tags: ['deployment', 'ci-cd'],
    content:
      'CI/CD pipeline: on push to main, run linting, type checking, and all tests. On tag, ' +
      'deploy to staging. Production deploys require manual approval after staging validation.',
  },
  {
    corpusId: 'deploy-secrets',
    contextId: 'deployment',
    contentType: 'rule',
    tags: ['deployment', 'secrets', 'security'],
    content:
      'Environment variables for secrets: DATABASE_URL, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY. ' +
      'Never commit secrets to version control. Use AWS Secrets Manager in deployed environments.',
  },
];

// ---------------------------------------------------------------------------
// Queries with relevance judgments
// ---------------------------------------------------------------------------

const queries: BenchmarkQuery[] = [
  // ── Direct queries (closely match unit text) ──
  {
    id: 'q-direct-1',
    text: 'How do I implement the login endpoint with JWT?',
    fromContextId: 'auth',
    queryTags: ['auth', 'jwt'],
    category: 'direct',
    description: 'Direct query for login endpoint within auth context',
    judgments: [
      { corpusId: 'auth-login-endpoint', relevance: 'essential' },
      { corpusId: 'auth-jwt-rs256', relevance: 'essential' },
      { corpusId: 'auth-bcrypt', relevance: 'essential' },
      { corpusId: 'auth-validate-tokens', relevance: 'helpful' },
      { corpusId: 'auth-rs256-rationale', relevance: 'helpful' },
      { corpusId: 'auth-refresh-endpoint', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-direct-2',
    text: 'What is the rate limiting policy for API endpoints?',
    fromContextId: 'api',
    queryTags: ['api', 'rate-limiting'],
    category: 'direct',
    judgments: [
      { corpusId: 'api-rate-limiting', relevance: 'essential' },
      { corpusId: 'auth-login-endpoint', relevance: 'helpful' }, // mentions rate limit
    ],
  },
  {
    id: 'q-direct-3',
    text: 'How is the users database table structured?',
    fromContextId: 'database',
    queryTags: ['database', 'applies-to:User'],
    category: 'direct',
    judgments: [
      { corpusId: 'db-users-table', relevance: 'essential' },
      { corpusId: 'db-indexes', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-direct-4',
    text: 'What styling library do we use in the frontend?',
    fromContextId: 'frontend',
    queryTags: ['frontend', 'styling'],
    category: 'direct',
    judgments: [
      { corpusId: 'frontend-styling', relevance: 'essential' },
      { corpusId: 'frontend-react-conventions', relevance: 'tangential' },
    ],
  },
  {
    id: 'q-direct-5',
    text: 'How do we handle database migrations?',
    fromContextId: 'database',
    queryTags: ['database'],
    category: 'direct',
    judgments: [
      { corpusId: 'db-migrations', relevance: 'essential' },
    ],
  },
  {
    id: 'q-direct-6',
    text: 'What is our deployment infrastructure?',
    fromContextId: 'deployment',
    queryTags: ['deployment'],
    category: 'direct',
    judgments: [
      { corpusId: 'deploy-aws-cdk', relevance: 'essential' },
      { corpusId: 'deploy-cicd', relevance: 'helpful' },
      { corpusId: 'deploy-secrets', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-direct-7',
    text: 'How should error responses be formatted in the API?',
    fromContextId: 'api',
    queryTags: ['api', 'errors'],
    category: 'direct',
    judgments: [
      { corpusId: 'api-error-format', relevance: 'essential' },
      { corpusId: 'method-error-handling', relevance: 'helpful' },
      { corpusId: 'method-api-validation', relevance: 'helpful' },
    ],
  },

  // ── Conceptual queries (semantic, not lexical match) ──
  {
    id: 'q-concept-1',
    text: 'How do we keep user passwords safe?',
    fromContextId: 'auth',
    queryTags: ['auth', 'security'],
    category: 'conceptual',
    description: 'Asks about password safety; relevant unit talks about hashing',
    judgments: [
      { corpusId: 'auth-bcrypt', relevance: 'essential' },
      { corpusId: 'auth-validate-tokens', relevance: 'tangential' },
    ],
  },
  {
    id: 'q-concept-2',
    text: 'How do users prove who they are when making API requests?',
    fromContextId: 'auth',
    queryTags: ['auth'],
    category: 'conceptual',
    description: 'Authentication concept without using the word',
    judgments: [
      { corpusId: 'auth-jwt-rs256', relevance: 'essential' },
      { corpusId: 'auth-validate-tokens', relevance: 'essential' },
      { corpusId: 'auth-middleware', relevance: 'essential' },
      { corpusId: 'auth-login-endpoint', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-concept-3',
    text: 'How does the system prevent abuse?',
    fromContextId: 'api',
    queryTags: ['api', 'security'],
    category: 'conceptual',
    judgments: [
      { corpusId: 'api-rate-limiting', relevance: 'essential' },
      { corpusId: 'auth-login-endpoint', relevance: 'helpful' }, // login rate limiting
      { corpusId: 'auth-validate-tokens', relevance: 'tangential' },
    ],
  },
  {
    id: 'q-concept-4',
    text: 'Where does the user interface state live?',
    fromContextId: 'frontend',
    queryTags: ['frontend'],
    category: 'conceptual',
    judgments: [
      { corpusId: 'frontend-data-fetching', relevance: 'essential' },
      { corpusId: 'frontend-react-conventions', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-concept-5',
    text: 'How are entities uniquely identified across the system?',
    fromContextId: 'root',
    queryTags: [],
    category: 'conceptual',
    judgments: [
      { corpusId: 'project-api-conventions', relevance: 'essential' }, // says all IDs are UUIDs
      { corpusId: 'db-users-table', relevance: 'helpful' },
      { corpusId: 'db-todos-table', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-concept-6',
    text: 'What happens when something fails inside an API handler?',
    fromContextId: 'api',
    queryTags: ['api'],
    category: 'conceptual',
    judgments: [
      { corpusId: 'api-error-format', relevance: 'essential' },
      { corpusId: 'method-error-handling', relevance: 'essential' },
      { corpusId: 'api-express-middleware', relevance: 'helpful' },
    ],
  },

  // ── Cross-context queries (most relevant content lives elsewhere) ──
  {
    id: 'q-cross-1',
    text: 'When implementing the JWT validation middleware, what should I check?',
    fromContextId: 'api',
    queryTags: ['auth', 'jwt', 'applies-to:JWTToken'],
    category: 'cross-context',
    description: 'Asked from API context but auth context has the answer',
    judgments: [
      { corpusId: 'auth-validate-tokens', relevance: 'essential' },
      { corpusId: 'auth-jwt-rs256', relevance: 'essential' },
      { corpusId: 'auth-middleware', relevance: 'essential' },
      { corpusId: 'api-express-middleware', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-cross-2',
    text: 'What database tables are needed to support authentication?',
    fromContextId: 'auth',
    queryTags: ['auth', 'database'],
    category: 'cross-context',
    description: 'Auth context needs database schema info',
    judgments: [
      { corpusId: 'db-users-table', relevance: 'essential' },
      { corpusId: 'db-tokens-table', relevance: 'essential' },
      { corpusId: 'auth-bcrypt', relevance: 'helpful' }, // password_hash usage
      { corpusId: 'auth-jwt-rs256', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-cross-3',
    text: 'How should the frontend send authenticated requests to the API?',
    fromContextId: 'frontend',
    queryTags: ['frontend', 'auth', 'api'],
    category: 'cross-context',
    judgments: [
      { corpusId: 'frontend-auth-cookies', relevance: 'essential' },
      { corpusId: 'auth-middleware', relevance: 'essential' },
      { corpusId: 'api-cors', relevance: 'helpful' },
      { corpusId: 'auth-jwt-rs256', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-cross-4',
    text: 'What secrets does the deployment need to access tokens?',
    fromContextId: 'deployment',
    queryTags: ['deployment', 'auth'],
    category: 'cross-context',
    judgments: [
      { corpusId: 'deploy-secrets', relevance: 'essential' },
      { corpusId: 'auth-jwt-rs256', relevance: 'helpful' }, // RS256 = key pair
      { corpusId: 'auth-rs256-rationale', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-cross-5',
    text: 'When implementing the todos API, what database queries do I need?',
    fromContextId: 'api',
    queryTags: ['api', 'database', 'applies-to:TodoItem'],
    category: 'cross-context',
    judgments: [
      { corpusId: 'api-todos-crud', relevance: 'essential' },
      { corpusId: 'db-todos-table', relevance: 'essential' },
      { corpusId: 'db-indexes', relevance: 'helpful' },
      { corpusId: 'api-pagination', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-cross-6',
    text: 'What are the form validation rules for user registration on the frontend?',
    fromContextId: 'frontend',
    queryTags: ['frontend', 'auth'],
    category: 'cross-context',
    judgments: [
      { corpusId: 'frontend-forms', relevance: 'essential' },
      { corpusId: 'auth-register-endpoint', relevance: 'essential' },
      { corpusId: 'project-architecture', relevance: 'tangential' }, // shared validation
    ],
  },

  // ── Methodological queries (practices, approach, principles) ──
  {
    id: 'q-method-1',
    text: 'What testing approach should I use when implementing the login endpoint?',
    fromContextId: 'auth',
    queryTags: ['methodology', 'testing', 'auth'],
    category: 'methodological',
    description: 'Asks about approach in domain context — methodology lives at root',
    judgments: [
      { corpusId: 'method-bdd', relevance: 'essential' },
      { corpusId: 'method-tests-as-spec', relevance: 'essential' },
      { corpusId: 'method-spec-by-example', relevance: 'essential' },
      { corpusId: 'method-vmodel', relevance: 'helpful' },
      { corpusId: 'auth-login-endpoint', relevance: 'tangential' },
    ],
  },
  {
    id: 'q-method-2',
    text: 'Before implementing the todo list component, what should I consider?',
    fromContextId: 'frontend',
    queryTags: ['methodology', 'frontend'],
    category: 'methodological',
    judgments: [
      { corpusId: 'method-consider-alternatives', relevance: 'essential' },
      { corpusId: 'method-vmodel', relevance: 'helpful' },
      { corpusId: 'method-incremental', relevance: 'helpful' },
      { corpusId: 'frontend-react-conventions', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-method-3',
    text: 'How should I refactor the existing auth code to add OAuth support?',
    fromContextId: 'auth',
    queryTags: ['methodology', 'refactoring'],
    category: 'methodological',
    judgments: [
      { corpusId: 'method-refactor-vs-rewrite', relevance: 'essential' },
      { corpusId: 'method-incremental', relevance: 'essential' },
      { corpusId: 'method-tests-as-spec', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-method-4',
    text: 'How should I name a function that calculates the next page cursor?',
    fromContextId: 'api',
    queryTags: ['methodology', 'code-quality'],
    category: 'methodological',
    judgments: [
      { corpusId: 'method-naming', relevance: 'essential' },
      { corpusId: 'api-pagination', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-method-5',
    text: 'How should I decompose the work for adding a new payment feature?',
    fromContextId: 'root',
    queryTags: ['methodology', 'planning'],
    category: 'methodological',
    judgments: [
      { corpusId: 'method-vmodel', relevance: 'essential' },
      { corpusId: 'method-incremental', relevance: 'essential' },
      { corpusId: 'method-consider-alternatives', relevance: 'helpful' },
      { corpusId: 'project-architecture', relevance: 'helpful' },
    ],
  },
  {
    id: 'q-method-6',
    text: 'What validation should the registration endpoint perform on inputs?',
    fromContextId: 'auth',
    queryTags: ['auth', 'methodology', 'validation'],
    category: 'methodological',
    judgments: [
      { corpusId: 'auth-register-endpoint', relevance: 'essential' },
      { corpusId: 'method-api-validation', relevance: 'essential' },
      { corpusId: 'frontend-forms', relevance: 'helpful' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Suite export
// ---------------------------------------------------------------------------

export const SDLC_EVALUATION_SUITE: EvaluationSuite = {
  name: 'sdlc-saas-todo',
  description:
    'Hand-crafted SDLC evaluation suite for a SaaS Todo project. ' +
    `Includes ${units.length} units across ${contexts.length} bounded contexts ` +
    `and ${queries.length} queries spanning direct, conceptual, cross-context, ` +
    'and methodological categories.',
  corpus: {
    name: 'sdlc-saas-todo-corpus',
    description: 'SaaS Todo project: auth, API, frontend, database, deployment',
    contexts,
    units,
  },
  queries,
};
