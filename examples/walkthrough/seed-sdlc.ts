/**
 * SDLC Seed Knowledge Base
 *
 * Opinionated practices for software engineering projects following:
 * - V-model development (design + spec/tests top-down, validate bottom-up)
 * - Specification by example / BDD
 * - Planning-learning cycle integrated with development
 * - Epistemic discipline (critical analysis, confidence levels, alternatives)
 *
 * Organized into categories that map to bounded contexts in a real project.
 * ~80-100 seed units providing enough density for meaningful retrieval testing.
 */

import type { AcquireOptions, ContentType } from '../../src/core/types.js';

export interface SeedKnowledgeUnit {
  content: string;
  contentType: ContentType;
  tags: string[];
  /** Which context this should be acquired into (by name, resolved at runtime). */
  context: string;
}

// ---------------------------------------------------------------------------
// Layer 1: Epistemic Discipline
// ---------------------------------------------------------------------------

const EPISTEMIC: SeedKnowledgeUnit[] = [
  {
    content: 'Before adopting any approach, explicitly consider at least one alternative. This is not endless deliberation — it is a brief check to catch premature commitment.',
    contentType: 'rule',
    tags: ['epistemic', 'critical-analysis'],
    context: 'root',
  },
  {
    content: 'When stating a conclusion, signal the confidence level: established fact, reasoned inference, assumption, or speculation. Downstream decisions inherit this confidence.',
    contentType: 'rule',
    tags: ['epistemic', 'confidence'],
    context: 'root',
  },
  {
    content: 'Prefer reversible decisions over irreversible ones when both achieve the goal. Irreversible decisions deserve more deliberation. Structural choices like module boundaries and data models are harder to reverse than implementation details.',
    contentType: 'rule',
    tags: ['epistemic', 'decisions'],
    context: 'root',
  },
  {
    content: 'When guidance says "use approach X because Y", Y is a testable assumption. If Y proves wrong, X should be revisited. Make dependency chains between decisions and their rationale visible.',
    contentType: 'rule',
    tags: ['epistemic', 'assumptions'],
    context: 'root',
  },
  {
    content: 'Distinguish between not knowing something and not having checked. Before assuming information is unavailable, verify by querying. Before assuming an approach will not work, test it.',
    contentType: 'instruction',
    tags: ['epistemic', 'verification'],
    context: 'root',
  },
  {
    content: 'Once an approach is working, do not change it for the sake of change. Periodically ask: is this still the best approach, or are we just used to it? Use plan expectations and metrics to answer this, not intuition.',
    contentType: 'rule',
    tags: ['epistemic', 'stability'],
    context: 'root',
  },
  {
    content: 'Make tradeoffs explicit. When choosing between competing concerns such as performance versus readability, or flexibility versus simplicity, state the tradeoff. Do not silently optimize for one at the expense of another.',
    contentType: 'rule',
    tags: ['epistemic', 'tradeoffs'],
    context: 'root',
  },
];

// ---------------------------------------------------------------------------
// Layer 2: Planning and Work Breakdown
// ---------------------------------------------------------------------------

const PLANNING: SeedKnowledgeUnit[] = [
  // V-model
  {
    content: 'Follow V-model decomposition: design and test specification go top-down together. At each level, define what "done" looks like before breaking down further. The test specification at each level validates the design at that level.',
    contentType: 'instruction',
    tags: ['planning', 'v-model', 'process'],
    context: 'root',
  },
  {
    content: 'V-model levels: project level defines goals and acceptance tests. Module level defines responsibilities, interfaces, and integration tests. Component level defines behavior specifications and behavior tests. Implementation level defines detailed design and unit tests.',
    contentType: 'fact',
    tags: ['planning', 'v-model', 'levels'],
    context: 'root',
  },
  {
    content: 'Each V-model level\'s tests are written before the level below is designed. This forces clarity at the right abstraction level and prevents testing implementation details instead of behavior.',
    contentType: 'rule',
    tags: ['planning', 'v-model', 'test-first'],
    context: 'root',
  },
  // Specification by example
  {
    content: 'Prefer specification by example over abstract descriptions. Do not describe behavior abstractly when a concrete example can be given. Examples serve as both specification and test cases.',
    contentType: 'rule',
    tags: ['planning', 'specification-by-example', 'bdd'],
    context: 'root',
  },
  {
    content: 'Behavior specifications use Given-When-Then format. Given a precondition, when an action occurs, then verify the expected outcome. Each scenario tests one specific behavior, not a sequence of behaviors.',
    contentType: 'instruction',
    tags: ['planning', 'bdd', 'specification'],
    context: 'root',
  },
  // Work breakdown
  {
    content: 'When decomposing work, ask: will completing this unit of work teach us something useful? If not, either the unit is too small or too large. Good work units are small enough to evaluate but large enough to produce meaningful signal.',
    contentType: 'instruction',
    tags: ['planning', 'breakdown', 'learnability'],
    context: 'root',
  },
  {
    content: 'Do not break down experimental work the same way as established work. Experimental work should be structured as hypothesis tests. Established work should be structured for efficiency.',
    contentType: 'rule',
    tags: ['planning', 'breakdown', 'maturity'],
    context: 'root',
  },
  {
    content: 'Design one level of decomposition ahead. Do not fully design all components before starting any implementation. Design module boundaries, then design one module in detail, implement it, validate, and use learnings to inform the next.',
    contentType: 'instruction',
    tags: ['planning', 'incremental', 'decomposition'],
    context: 'root',
  },
  // Risk and prioritization
  {
    content: 'Prioritize actions by highest risk and highest delivered value. Execute risky work early for fast feedback. Execute high-value work early to deliver incremental benefit.',
    contentType: 'rule',
    tags: ['planning', 'prioritization', 'risk'],
    context: 'root',
  },
  {
    content: 'Every plan should identify assumptions and risks. Include indicators that the approach is not working and define what triggers a different approach. Set maximum attempts as guidance for effort budget, not as a mechanical retry limit.',
    contentType: 'instruction',
    tags: ['planning', 'risk', 'assumptions'],
    context: 'root',
  },
  {
    content: 'When multiple approaches could deliver an objective, consider executing them as alternatives. The planner selects based on risk and cost. If the first approach fails, the alternative activates without replanning from scratch.',
    contentType: 'instruction',
    tags: ['planning', 'alternatives', 'resilience'],
    context: 'root',
  },
];

// ---------------------------------------------------------------------------
// Layer 3: Knowledge Management
// ---------------------------------------------------------------------------

const KNOWLEDGE_MGMT: SeedKnowledgeUnit[] = [
  {
    content: 'Acquire knowledge with intent. Before storing information, consider: will this be useful for future retrieval? Classify correctly at acquisition time — it saves curation effort later.',
    contentType: 'instruction',
    tags: ['knowledge', 'acquisition'],
    context: 'root',
  },
  {
    content: 'Track knowledge provenance. A rule from a user requirement has different authority than a rule inferred by an agent. An observation from a successful run has different weight than one from a failed run.',
    contentType: 'rule',
    tags: ['knowledge', 'provenance'],
    context: 'root',
  },
  {
    content: 'When new knowledge contradicts existing knowledge, do not silently supersede. The contradiction itself is valuable — it means either the old knowledge is wrong, the new knowledge is wrong, or the context has changed. Flag it.',
    contentType: 'rule',
    tags: ['knowledge', 'contradictions'],
    context: 'root',
  },
  {
    content: 'Separate what from why. When storing a decision, also store the rationale. The decision may need to change if the rationale changes, and without the rationale you cannot evaluate whether it is still valid.',
    contentType: 'rule',
    tags: ['knowledge', 'decisions', 'rationale'],
    context: 'root',
  },
  {
    content: 'Prune knowledge by evidence, not by age. Knowledge that is never retrieved might be poorly embedded, not unimportant. Before pruning, ask: is this unused because it is irrelevant, or because queries do not reach it?',
    contentType: 'instruction',
    tags: ['knowledge', 'curation', 'pruning'],
    context: 'root',
  },
];

// ---------------------------------------------------------------------------
// Layer 4: Software Engineering Practices
// ---------------------------------------------------------------------------

const ENGINEERING: SeedKnowledgeUnit[] = [
  // Testing philosophy
  {
    content: 'Tests are executable specifications, not afterthoughts. A module\'s integration tests define its contract. A component\'s behavior tests define its functionality. The implementation satisfies the specification.',
    contentType: 'rule',
    tags: ['engineering', 'testing', 'specification'],
    context: 'root',
  },
  {
    content: 'Validate bottom-up against top-down specification. Unit tests validate components. Integration tests validate modules. Acceptance tests validate the system. Each level checks different concerns.',
    contentType: 'instruction',
    tags: ['engineering', 'testing', 'validation', 'v-model'],
    context: 'root',
  },
  {
    content: 'Each increment should leave the system in a valid state. All existing tests pass, no architectural regressions, the increment is cohesive. Prefer small, complete increments over large, incomplete ones.',
    contentType: 'rule',
    tags: ['engineering', 'incremental', 'delivery'],
    context: 'root',
  },
  {
    content: 'Refactoring changes structure without changing behavior, verified by existing tests. Changing behavior requires updating the specification first, then the implementation. Never do both at once.',
    contentType: 'rule',
    tags: ['engineering', 'refactoring', 'discipline'],
    context: 'root',
  },
  // Architecture
  {
    content: 'Define clear module boundaries based on domain concepts, not technical layers. A module owns its data and exposes a contract. Internal implementation details are hidden.',
    contentType: 'instruction',
    tags: ['engineering', 'architecture', 'modules'],
    context: 'root',
  },
  {
    content: 'Dependencies should point inward: domain logic depends on nothing, application logic depends on domain, infrastructure depends on application. Never let domain logic depend on infrastructure.',
    contentType: 'rule',
    tags: ['engineering', 'architecture', 'dependencies'],
    context: 'root',
  },
  {
    content: 'Interfaces between modules should be stable. Implementation behind interfaces can change freely. When an interface must change, update all consumers as a single coordinated change.',
    contentType: 'rule',
    tags: ['engineering', 'architecture', 'interfaces'],
    context: 'root',
  },
  // Code quality
  {
    content: 'Name things for what they represent in the domain, not for their technical implementation. A function called calculateShippingCost is better than processData. Names are documentation.',
    contentType: 'instruction',
    tags: ['engineering', 'code-quality', 'naming'],
    context: 'root',
  },
  {
    content: 'Handle errors at the level that has enough context to make a meaningful decision. Do not catch exceptions just to log and rethrow. Let errors propagate to where they can be properly handled or reported.',
    contentType: 'rule',
    tags: ['engineering', 'error-handling'],
    context: 'root',
  },
  {
    content: 'Every public API should have clear input validation, documented error cases, and consistent error formats. Internal functions can trust their callers; external boundaries must not.',
    contentType: 'rule',
    tags: ['engineering', 'api-design', 'validation'],
    context: 'root',
  },
];

// ---------------------------------------------------------------------------
// Project-specific: SaaS Todo Application
// ---------------------------------------------------------------------------

const PROJECT_ROOT: SeedKnowledgeUnit[] = [
  {
    content: 'Project: Full-stack SaaS Todo application. TypeScript throughout. Node.js backend, React frontend. PostgreSQL database. Deploy to AWS using CDK. Target: production-ready MVP.',
    contentType: 'fact',
    tags: ['project', 'overview'],
    context: 'root',
  },
  {
    content: 'Architecture: monorepo with packages for api, web, shared. The api package is an Express.js server. The web package is a React SPA. The shared package contains domain types and validation logic used by both.',
    contentType: 'fact',
    tags: ['project', 'architecture', 'structure'],
    context: 'root',
  },
  {
    content: 'All API responses follow JSON:API specification. All dates use ISO 8601 format in UTC. All IDs are UUIDs.',
    contentType: 'rule',
    tags: ['project', 'conventions', 'api'],
    context: 'root',
  },
  {
    content: 'Decision: use PostgreSQL for the database because we need ACID transactions, complex queries, and the team has PostgreSQL experience. Evaluated alternatives: MongoDB (rejected, no strong need for document model), SQLite (rejected, need multi-connection support for production).',
    contentType: 'decision',
    tags: ['project', 'database', 'rationale'],
    context: 'root',
  },
];

const AUTH_KNOWLEDGE: SeedKnowledgeUnit[] = [
  {
    content: 'Authentication uses JWT tokens with RS256 signing algorithm. Access tokens expire after 1 hour. Refresh tokens expire after 30 days and are rotated on each use.',
    contentType: 'fact',
    tags: ['auth', 'jwt', 'tokens'],
    context: 'auth',
  },
  {
    content: 'Always validate the JWT token signature before processing any request. Verify the issuer claim, audience claim, and expiration. Reject tokens with missing or invalid claims.',
    contentType: 'rule',
    tags: ['auth', 'validation', 'security'],
    context: 'auth',
  },
  {
    content: 'Store password hashes using bcrypt with cost factor 12. Never store plaintext passwords. Never log password values even in debug mode.',
    contentType: 'rule',
    tags: ['auth', 'passwords', 'security'],
    context: 'auth',
  },
  {
    content: 'Login endpoint: POST /api/v1/auth/login. Accepts email and password. Returns access token and refresh token. Rate limited to 5 attempts per minute per email.',
    contentType: 'fact',
    tags: ['auth', 'endpoints', 'login'],
    context: 'auth',
  },
  {
    content: 'Registration endpoint: POST /api/v1/auth/register. Accepts email, password, and display name. Validates email format, password strength minimum 8 characters with mixed case and number. Returns created user without tokens — user must log in separately.',
    contentType: 'fact',
    tags: ['auth', 'endpoints', 'registration'],
    context: 'auth',
  },
  {
    content: 'Token refresh endpoint: POST /api/v1/auth/refresh. Accepts refresh token. Returns new access token and new refresh token. Old refresh token is invalidated immediately.',
    contentType: 'fact',
    tags: ['auth', 'endpoints', 'refresh'],
    context: 'auth',
  },
  {
    content: 'Auth middleware extracts the Bearer token from the Authorization header. Validates the token. Attaches the decoded user to the request context. Returns 401 if token is missing or invalid.',
    contentType: 'fact',
    tags: ['auth', 'middleware', 'implementation'],
    context: 'auth',
  },
  {
    content: 'Decision: use RS256 over HS256 for JWT signing because it allows token verification without sharing the private key. The public key can be distributed to any service that needs to verify tokens.',
    contentType: 'decision',
    tags: ['auth', 'jwt', 'rationale'],
    context: 'auth',
  },
];

const API_KNOWLEDGE: SeedKnowledgeUnit[] = [
  {
    content: 'REST endpoints follow /api/v1/{resource} pattern. Use plural nouns for resource names. Use HTTP methods correctly: GET for reads, POST for creates, PATCH for updates, DELETE for removes.',
    contentType: 'rule',
    tags: ['api', 'rest', 'conventions'],
    context: 'api',
  },
  {
    content: 'All endpoints require authentication except POST /api/v1/auth/login, POST /api/v1/auth/register, and GET /api/v1/health.',
    contentType: 'rule',
    tags: ['api', 'auth', 'endpoints'],
    context: 'api',
  },
  {
    content: 'Rate limiting: 100 requests per minute per authenticated user. 20 requests per minute for unauthenticated endpoints. Return 429 Too Many Requests when exceeded with Retry-After header.',
    contentType: 'rule',
    tags: ['api', 'rate-limiting', 'security'],
    context: 'api',
  },
  {
    content: 'Todo CRUD endpoints: GET /api/v1/todos (list, paginated), POST /api/v1/todos (create), GET /api/v1/todos/:id (read), PATCH /api/v1/todos/:id (update), DELETE /api/v1/todos/:id (soft delete). Users can only access their own todos.',
    contentType: 'fact',
    tags: ['api', 'todos', 'endpoints'],
    context: 'api',
  },
  {
    content: 'Pagination uses cursor-based approach. Default page size 20, maximum 100. Response includes next cursor and total count.',
    contentType: 'fact',
    tags: ['api', 'pagination', 'conventions'],
    context: 'api',
  },
  {
    content: 'Error responses use problem details format (RFC 7807). Include type, title, status, detail, and instance fields. For validation errors, include a list of field-specific errors.',
    contentType: 'rule',
    tags: ['api', 'errors', 'conventions'],
    context: 'api',
  },
  {
    content: 'Use Express.js middleware chain: request logging, CORS, body parsing, authentication, rate limiting, route handler, error handler. Middleware order matters — authentication must come before route handlers.',
    contentType: 'instruction',
    tags: ['api', 'express', 'middleware'],
    context: 'api',
  },
  {
    content: 'API must return CORS headers allowing the frontend origin. In development allow localhost:3000. In production allow only the configured domain.',
    contentType: 'rule',
    tags: ['api', 'cors', 'security'],
    context: 'api',
  },
];

const FRONTEND_KNOWLEDGE: SeedKnowledgeUnit[] = [
  {
    content: 'Frontend uses React 18 with TypeScript strict mode. Functional components only, no class components. Use hooks for state and effects.',
    contentType: 'rule',
    tags: ['frontend', 'react', 'conventions'],
    context: 'frontend',
  },
  {
    content: 'Data fetching uses TanStack Query (React Query). Define query keys consistently as arrays: [resource, id?, filters?]. Use mutations for write operations with optimistic updates where appropriate.',
    contentType: 'instruction',
    tags: ['frontend', 'data-fetching', 'tanstack-query'],
    context: 'frontend',
  },
  {
    content: 'Styling uses Tailwind CSS. No custom CSS files except for global resets. Component variants use class-variance-authority (cva). Design tokens defined in tailwind.config.',
    contentType: 'rule',
    tags: ['frontend', 'styling', 'tailwind'],
    context: 'frontend',
  },
  {
    content: 'Store auth tokens in httpOnly cookies set by the server, never in localStorage or sessionStorage. The frontend sends credentials with every request via fetch credentials: include.',
    contentType: 'rule',
    tags: ['frontend', 'auth', 'security'],
    context: 'frontend',
  },
  {
    content: 'Component structure: pages in /pages, reusable components in /components, hooks in /hooks, API client functions in /api. Colocate tests with source files using .test.tsx suffix.',
    contentType: 'instruction',
    tags: ['frontend', 'structure', 'organization'],
    context: 'frontend',
  },
  {
    content: 'Forms use react-hook-form with zod validation schemas. Validation schemas are shared between frontend and API via the shared package.',
    contentType: 'instruction',
    tags: ['frontend', 'forms', 'validation'],
    context: 'frontend',
  },
  {
    content: 'Routing uses React Router v6. Protected routes redirect to login. After login, redirect back to the originally requested page.',
    contentType: 'fact',
    tags: ['frontend', 'routing', 'auth'],
    context: 'frontend',
  },
];

const DATABASE_KNOWLEDGE: SeedKnowledgeUnit[] = [
  {
    content: 'Database migrations use a versioned migration tool. Each migration has an up and down function. Migrations are applied in order and tracked in a migrations table. Never modify a migration that has been applied.',
    contentType: 'rule',
    tags: ['database', 'migrations', 'discipline'],
    context: 'database',
  },
  {
    content: 'Users table: id (UUID, PK), email (unique, not null), password_hash (not null), display_name (not null), created_at (timestamp), updated_at (timestamp), deleted_at (nullable timestamp for soft delete).',
    contentType: 'fact',
    tags: ['database', 'schema', 'users'],
    context: 'database',
  },
  {
    content: 'Todos table: id (UUID, PK), user_id (UUID, FK to users, not null), title (not null), description (nullable text), completed (boolean, default false), due_date (nullable timestamp), created_at, updated_at, deleted_at.',
    contentType: 'fact',
    tags: ['database', 'schema', 'todos'],
    context: 'database',
  },
  {
    content: 'Refresh tokens table: id (UUID, PK), user_id (UUID, FK), token_hash (not null, unique), expires_at (timestamp, not null), revoked_at (nullable timestamp), created_at.',
    contentType: 'fact',
    tags: ['database', 'schema', 'tokens'],
    context: 'database',
  },
  {
    content: 'Use database transactions for operations that modify multiple tables. The token refresh operation must invalidate the old token and create the new one atomically.',
    contentType: 'rule',
    tags: ['database', 'transactions', 'consistency'],
    context: 'database',
  },
  {
    content: 'Index strategy: unique index on users.email, index on todos.user_id, index on refresh_tokens.token_hash, index on refresh_tokens.user_id. Add indexes based on query patterns, not speculatively.',
    contentType: 'instruction',
    tags: ['database', 'indexes', 'performance'],
    context: 'database',
  },
];

const DEPLOYMENT_KNOWLEDGE: SeedKnowledgeUnit[] = [
  {
    content: 'Deploy to AWS using CDK. Infrastructure defined as code in an infra package within the monorepo. Environments: dev, staging, production. Each environment has isolated resources.',
    contentType: 'fact',
    tags: ['deployment', 'aws', 'cdk'],
    context: 'deployment',
  },
  {
    content: 'CI/CD pipeline: on push to main, run linting, type checking, and all tests. On tag, deploy to staging. Production deploys require manual approval after staging validation.',
    contentType: 'instruction',
    tags: ['deployment', 'ci-cd', 'pipeline'],
    context: 'deployment',
  },
  {
    content: 'Environment variables for secrets: DATABASE_URL, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY. Never commit secrets to version control. Use AWS Secrets Manager in deployed environments.',
    contentType: 'rule',
    tags: ['deployment', 'secrets', 'security'],
    context: 'deployment',
  },
];

// ---------------------------------------------------------------------------
// Export all seed knowledge
// ---------------------------------------------------------------------------

export const SDLC_SEED: SeedKnowledgeUnit[] = [
  ...EPISTEMIC,
  ...PLANNING,
  ...KNOWLEDGE_MGMT,
  ...ENGINEERING,
  ...PROJECT_ROOT,
  ...AUTH_KNOWLEDGE,
  ...API_KNOWLEDGE,
  ...FRONTEND_KNOWLEDGE,
  ...DATABASE_KNOWLEDGE,
  ...DEPLOYMENT_KNOWLEDGE,
];

/** Unique context names referenced by seed units. */
export const SEED_CONTEXTS = [...new Set(SDLC_SEED.map((u) => u.context))];
