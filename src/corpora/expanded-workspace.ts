/**
 * Expanded workspace corpus for walkthroughs.
 *
 * A multi-domain knowledge base modeling a workspace that spans:
 * - methodology (shared practices)
 * - sdlc (software engineering — dense)
 * - project-management
 * - process-workflow
 * - physical-engineering
 * - mathematics
 *
 * Designed to support cross-domain queries (e.g., "V-model for engineering",
 * "statistics for A/B testing", "retrospective for the auth module") and
 * test retrieval's ability to surface relevant content from distant contexts.
 *
 * Lower density than the SDLC evaluation suite for non-SDLC domains — the
 * goal is breadth, not depth.
 */

import type { BenchmarkCorpus, BenchmarkContext, BenchmarkUnit } from '../benchmark/types.js';

// ---------------------------------------------------------------------------
// Context hierarchy
// ---------------------------------------------------------------------------

const contexts: BenchmarkContext[] = [
  // Root
  { id: 'workspace', name: 'Workspace', description: 'Shared workspace root spanning multiple domains' },

  // Shared methodology
  { id: 'methodology', name: 'Methodology', description: 'Practices and principles that apply across domains', parentId: 'workspace' },

  // SDLC
  { id: 'sdlc', name: 'Software Development', description: 'Software engineering practices and patterns', parentId: 'workspace' },
  { id: 'sdlc-auth', name: 'Authentication', description: 'Auth, JWT, sessions', parentId: 'sdlc' },
  { id: 'sdlc-api', name: 'API', description: 'REST endpoints, middleware', parentId: 'sdlc' },
  { id: 'sdlc-frontend', name: 'Frontend', description: 'React UI', parentId: 'sdlc' },
  { id: 'sdlc-database', name: 'Database', description: 'PostgreSQL schema', parentId: 'sdlc' },
  { id: 'sdlc-deployment', name: 'Deployment', description: 'AWS CDK infrastructure', parentId: 'sdlc' },

  // Project management
  { id: 'pm', name: 'Project Management', description: 'Planning, execution, governance of projects', parentId: 'workspace' },

  // Process and workflow
  { id: 'process', name: 'Process & Workflow', description: 'Business process management, operational workflows', parentId: 'workspace' },

  // Physical engineering
  { id: 'pe', name: 'Physical Engineering', description: 'Mechanical design, simulation, manufacturing', parentId: 'workspace' },
  { id: 'pe-cad', name: 'CAD', description: 'Computer-aided design, solid modeling, parametric design', parentId: 'pe' },
  { id: 'pe-simulation', name: 'Simulation', description: 'FEA, CFD, kinematics', parentId: 'pe' },
  { id: 'pe-manufacturing', name: 'Manufacturing', description: 'CNC, additive, subtractive, design-for-manufacturability', parentId: 'pe' },

  // Mathematics
  { id: 'math', name: 'Mathematics', description: 'Applied mathematics and statistics', parentId: 'workspace' },
];

// ---------------------------------------------------------------------------
// Methodology — shared practices (applies across all domains)
// ---------------------------------------------------------------------------

const methodologyUnits: BenchmarkUnit[] = [
  {
    corpusId: 'method-vmodel',
    contextId: 'methodology',
    contentType: 'instruction',
    tags: ['methodology:v-model', 'planning', 'applies-to:any-engineering'],
    content:
      'V-model decomposition: design and test specification go top-down together. ' +
      'At each level, define what done looks like before breaking down further. ' +
      'The test specification at each level validates the design at that level. ' +
      'Applies to software, hardware, and physical engineering projects.',
  },
  {
    corpusId: 'method-bdd',
    contextId: 'methodology',
    contentType: 'instruction',
    tags: ['methodology:bdd', 'testing', 'applies-to:software'],
    content:
      'Behavior-driven development. Behavior specifications use Given-When-Then ' +
      'format: given a precondition, when an action occurs, then verify the ' +
      'expected outcome. Each scenario tests one specific behavior, not a ' +
      'sequence of behaviors.',
  },
  {
    corpusId: 'method-spec-by-example',
    contextId: 'methodology',
    contentType: 'rule',
    tags: ['methodology:spec-by-example', 'specification'],
    content:
      'Prefer specification by example over abstract descriptions. Do not describe ' +
      'behavior abstractly when a concrete example can be given. Examples serve ' +
      'as both specification and test cases.',
  },
  {
    corpusId: 'method-tests-as-spec',
    contextId: 'methodology',
    contentType: 'rule',
    tags: ['methodology', 'testing', 'applies-to:software'],
    content:
      'Tests are executable specifications, not afterthoughts. A module\'s integration ' +
      'tests define its contract. A component\'s behavior tests define its functionality. ' +
      'The implementation satisfies the specification.',
  },
  {
    corpusId: 'method-incremental',
    contextId: 'methodology',
    contentType: 'rule',
    tags: ['methodology', 'delivery'],
    content:
      'Each increment should leave the system in a valid state. All existing tests ' +
      'pass, no architectural regressions, the increment is cohesive. Prefer small, ' +
      'complete increments over large, incomplete ones. Applies to software releases, ' +
      'hardware revisions, and process changes.',
  },
  {
    corpusId: 'method-refactor-vs-rewrite',
    contextId: 'methodology',
    contentType: 'rule',
    tags: ['methodology', 'refactoring', 'applies-to:software'],
    content:
      'Refactoring changes structure without changing behavior, verified by existing ' +
      'tests. Changing behavior requires updating the specification first, then the ' +
      'implementation. Never do both at once.',
  },
  {
    corpusId: 'method-consider-alternatives',
    contextId: 'methodology',
    contentType: 'rule',
    tags: ['methodology:epistemic', 'critical-analysis'],
    content:
      'Before adopting any approach, explicitly consider at least one alternative. ' +
      'This is not endless deliberation — it is a brief check to catch premature ' +
      'commitment. Applies universally: design decisions, process choices, team ' +
      'structures, material selection.',
  },
  {
    corpusId: 'method-confidence-levels',
    contextId: 'methodology',
    contentType: 'rule',
    tags: ['methodology:epistemic', 'reasoning'],
    content:
      'Distinguish confidence levels: established fact, reasoned inference, ' +
      'working assumption, speculation. Decisions and artifacts should signal ' +
      'their confidence so downstream consumers weight them correctly.',
  },
  {
    corpusId: 'method-naming',
    contextId: 'methodology',
    contentType: 'instruction',
    tags: ['methodology', 'code-quality', 'applies-to:software'],
    content:
      'Name things for what they represent in the domain, not for their technical ' +
      'implementation. A function called calculateShippingCost is better than ' +
      'processData. Names are documentation.',
  },
  {
    corpusId: 'method-risk-early',
    contextId: 'methodology',
    contentType: 'rule',
    tags: ['methodology', 'risk-management'],
    content:
      'Prioritize high-risk, high-value work early. Risk unknowns sooner so you ' +
      'have time to respond. Low-risk mechanical work can wait. This principle ' +
      'applies to software project ordering, research sequencing, and physical ' +
      'prototyping.',
  },
  {
    corpusId: 'method-small-reversible',
    contextId: 'methodology',
    contentType: 'rule',
    tags: ['methodology', 'decisions'],
    content:
      'Prefer small, reversible steps over large, irreversible ones. When you must ' +
      'make an irreversible choice, deliberate more carefully and document the ' +
      'rationale. Applies to architectural decisions, material selection, vendor ' +
      'commitments, and process changes.',
  },
  {
    corpusId: 'method-validate-assumptions',
    contextId: 'methodology',
    contentType: 'rule',
    tags: ['methodology:epistemic', 'risk-management'],
    content:
      'Every plan rests on assumptions. List them explicitly. For each, decide how ' +
      'you will validate it — through testing, research, experiment, or stakeholder ' +
      'confirmation — and do that validation before committing major effort.',
  },
];

// ---------------------------------------------------------------------------
// SDLC content (dense — most of our existing software knowledge)
// ---------------------------------------------------------------------------

const sdlcUnits: BenchmarkUnit[] = [
  // Project overview
  {
    corpusId: 'sdlc-project-overview',
    contextId: 'sdlc',
    contentType: 'fact',
    tags: ['project', 'overview', 'domain:sdlc'],
    content:
      'Example project: a SaaS Todo application. TypeScript throughout. Node.js ' +
      'backend, React frontend. PostgreSQL database. Deploy to AWS using CDK. ' +
      'Monorepo with packages: api (Express.js), web (React SPA), shared (types + validation).',
  },
  {
    corpusId: 'sdlc-conventions',
    contextId: 'sdlc',
    contentType: 'rule',
    tags: ['project', 'conventions', 'domain:sdlc'],
    content:
      'All API responses follow JSON:API specification. All dates use ISO 8601 ' +
      'format in UTC. All IDs are UUIDs. Validation schemas are shared between ' +
      'frontend and API via the shared package.',
  },
  {
    corpusId: 'sdlc-db-decision',
    contextId: 'sdlc',
    contentType: 'decision',
    tags: ['project', 'database', 'rationale', 'domain:sdlc'],
    content:
      'Decision: use PostgreSQL for the database because we need ACID transactions, ' +
      'complex queries, and the team has PostgreSQL experience. Evaluated MongoDB ' +
      'and rejected (no strong need for document model). Evaluated SQLite and ' +
      'rejected (need multi-connection production support).',
  },
  {
    corpusId: 'sdlc-module-boundaries',
    contextId: 'sdlc',
    contentType: 'rule',
    tags: ['architecture', 'domain:sdlc'],
    content:
      'Define clear module boundaries based on domain concepts, not technical layers. ' +
      'A module owns its data and exposes a contract. Internal implementation details ' +
      'are hidden. Dependencies point inward: domain logic depends on nothing, ' +
      'application depends on domain, infrastructure depends on application.',
  },
  {
    corpusId: 'sdlc-error-handling',
    contextId: 'sdlc',
    contentType: 'rule',
    tags: ['error-handling', 'domain:sdlc'],
    content:
      'Handle errors at the level with enough context to make a meaningful decision. ' +
      'Do not catch exceptions just to log and rethrow. Let errors propagate to where ' +
      'they can be properly handled or reported.',
  },
  {
    corpusId: 'sdlc-api-validation',
    contextId: 'sdlc',
    contentType: 'rule',
    tags: ['api-design', 'validation', 'domain:sdlc'],
    content:
      'Every public API should have clear input validation, documented error cases, ' +
      'and consistent error formats. Internal functions can trust their callers; ' +
      'external boundaries must not.',
  },

  // Auth
  {
    corpusId: 'sdlc-auth-jwt',
    contextId: 'sdlc-auth',
    contentType: 'fact',
    tags: ['auth', 'jwt', 'tokens', 'applies-to:JWTToken', 'domain:sdlc'],
    content:
      'Authentication uses JWT tokens with RS256 signing algorithm. Access tokens ' +
      'expire after 1 hour. Refresh tokens expire after 30 days and are rotated ' +
      'on each use.',
  },
  {
    corpusId: 'sdlc-auth-validate',
    contextId: 'sdlc-auth',
    contentType: 'rule',
    tags: ['auth', 'validation', 'security', 'applies-to:JWTToken', 'domain:sdlc'],
    content:
      'Always validate the JWT token signature before processing any request. Verify ' +
      'the issuer claim, audience claim, and expiration. Reject tokens with missing ' +
      'or invalid claims.',
  },
  {
    corpusId: 'sdlc-auth-bcrypt',
    contextId: 'sdlc-auth',
    contentType: 'rule',
    tags: ['auth', 'passwords', 'security', 'domain:sdlc'],
    content:
      'Store password hashes using bcrypt with cost factor 12. Never store plaintext ' +
      'passwords. Never log password values even in debug mode.',
  },
  {
    corpusId: 'sdlc-auth-login',
    contextId: 'sdlc-auth',
    contentType: 'fact',
    tags: ['auth', 'endpoints', 'login', 'domain:sdlc'],
    content:
      'Login endpoint: POST /api/v1/auth/login. Accepts email and password. Returns ' +
      'access token and refresh token. Rate limited to 5 attempts per minute per email.',
  },
  {
    corpusId: 'sdlc-auth-register',
    contextId: 'sdlc-auth',
    contentType: 'fact',
    tags: ['auth', 'endpoints', 'registration', 'domain:sdlc'],
    content:
      'Registration endpoint: POST /api/v1/auth/register. Accepts email, password, ' +
      'and display name. Validates email format, password strength (minimum 8 ' +
      'characters with mixed case and number). Returns created user without tokens.',
  },
  {
    corpusId: 'sdlc-auth-refresh',
    contextId: 'sdlc-auth',
    contentType: 'fact',
    tags: ['auth', 'endpoints', 'refresh', 'domain:sdlc'],
    content:
      'Token refresh endpoint: POST /api/v1/auth/refresh. Accepts refresh token. ' +
      'Returns new access token and new refresh token. Old refresh token is ' +
      'invalidated immediately.',
  },
  {
    corpusId: 'sdlc-auth-middleware',
    contextId: 'sdlc-auth',
    contentType: 'fact',
    tags: ['auth', 'middleware', 'implementation', 'domain:sdlc'],
    content:
      'Auth middleware extracts the Bearer token from the Authorization header, ' +
      'validates the token, attaches the decoded user to the request context, and ' +
      'returns 401 if the token is missing or invalid.',
  },
  {
    corpusId: 'sdlc-auth-rs256-rationale',
    contextId: 'sdlc-auth',
    contentType: 'decision',
    tags: ['auth', 'jwt', 'rationale', 'domain:sdlc'],
    content:
      'Decision: use RS256 over HS256 for JWT signing because it allows token ' +
      'verification without sharing the private key. The public key can be ' +
      'distributed to any service that needs to verify tokens.',
  },

  // API
  {
    corpusId: 'sdlc-api-rest',
    contextId: 'sdlc-api',
    contentType: 'rule',
    tags: ['api', 'rest', 'conventions', 'domain:sdlc'],
    content:
      'REST endpoints follow /api/v1/{resource} pattern. Use plural nouns for ' +
      'resource names. Use HTTP methods correctly: GET for reads, POST for creates, ' +
      'PATCH for updates, DELETE for removes.',
  },
  {
    corpusId: 'sdlc-api-auth-required',
    contextId: 'sdlc-api',
    contentType: 'rule',
    tags: ['api', 'auth', 'endpoints', 'domain:sdlc'],
    content:
      'All endpoints require authentication except POST /api/v1/auth/login, ' +
      'POST /api/v1/auth/register, and GET /api/v1/health.',
  },
  {
    corpusId: 'sdlc-api-rate-limiting',
    contextId: 'sdlc-api',
    contentType: 'rule',
    tags: ['api', 'rate-limiting', 'security', 'domain:sdlc'],
    content:
      'Rate limiting: 100 requests per minute per authenticated user. 20 requests ' +
      'per minute for unauthenticated endpoints. Return 429 Too Many Requests when ' +
      'exceeded with Retry-After header.',
  },
  {
    corpusId: 'sdlc-api-todos',
    contextId: 'sdlc-api',
    contentType: 'fact',
    tags: ['api', 'todos', 'endpoints', 'domain:sdlc'],
    content:
      'Todo CRUD endpoints: GET /api/v1/todos (list, paginated), POST /api/v1/todos ' +
      '(create), GET /api/v1/todos/:id (read), PATCH /api/v1/todos/:id (update), ' +
      'DELETE /api/v1/todos/:id (soft delete). Users can only access their own todos.',
  },
  {
    corpusId: 'sdlc-api-pagination',
    contextId: 'sdlc-api',
    contentType: 'fact',
    tags: ['api', 'pagination', 'domain:sdlc'],
    content:
      'Pagination uses cursor-based approach. Default page size 20, maximum 100. ' +
      'Response includes next cursor and total count.',
  },
  {
    corpusId: 'sdlc-api-errors',
    contextId: 'sdlc-api',
    contentType: 'rule',
    tags: ['api', 'errors', 'conventions', 'domain:sdlc'],
    content:
      'Error responses use problem details format (RFC 7807). Include type, title, ' +
      'status, detail, and instance fields. For validation errors, include a list ' +
      'of field-specific errors.',
  },
  {
    corpusId: 'sdlc-api-middleware',
    contextId: 'sdlc-api',
    contentType: 'instruction',
    tags: ['api', 'express', 'middleware', 'domain:sdlc'],
    content:
      'Express.js middleware chain: request logging, CORS, body parsing, ' +
      'authentication, rate limiting, route handler, error handler. Middleware order ' +
      'matters — authentication must come before route handlers.',
  },
  {
    corpusId: 'sdlc-api-cors',
    contextId: 'sdlc-api',
    contentType: 'rule',
    tags: ['api', 'cors', 'security', 'domain:sdlc'],
    content:
      'API must return CORS headers allowing the frontend origin. In development ' +
      'allow localhost:3000. In production allow only the configured domain.',
  },

  // Frontend
  {
    corpusId: 'sdlc-frontend-react',
    contextId: 'sdlc-frontend',
    contentType: 'rule',
    tags: ['frontend', 'react', 'conventions', 'domain:sdlc'],
    content:
      'Frontend uses React 18 with TypeScript strict mode. Functional components ' +
      'only, no class components. Use hooks for state and effects.',
  },
  {
    corpusId: 'sdlc-frontend-data',
    contextId: 'sdlc-frontend',
    contentType: 'instruction',
    tags: ['frontend', 'data-fetching', 'tanstack-query', 'domain:sdlc'],
    content:
      'Data fetching uses TanStack Query (React Query). Define query keys ' +
      'consistently as arrays: [resource, id?, filters?]. Use mutations for write ' +
      'operations with optimistic updates where appropriate.',
  },
  {
    corpusId: 'sdlc-frontend-styling',
    contextId: 'sdlc-frontend',
    contentType: 'rule',
    tags: ['frontend', 'styling', 'tailwind', 'domain:sdlc'],
    content:
      'Styling uses Tailwind CSS. No custom CSS files except for global resets. ' +
      'Component variants use class-variance-authority (cva). Design tokens defined ' +
      'in tailwind.config.',
  },
  {
    corpusId: 'sdlc-frontend-auth-cookies',
    contextId: 'sdlc-frontend',
    contentType: 'rule',
    tags: ['frontend', 'auth', 'security', 'domain:sdlc'],
    content:
      'Store auth tokens in httpOnly cookies set by the server, never in localStorage ' +
      'or sessionStorage. The frontend sends credentials with every request via ' +
      'fetch credentials: include.',
  },
  {
    corpusId: 'sdlc-frontend-forms',
    contextId: 'sdlc-frontend',
    contentType: 'instruction',
    tags: ['frontend', 'forms', 'validation', 'domain:sdlc'],
    content:
      'Forms use react-hook-form with zod validation schemas. Validation schemas ' +
      'are shared between frontend and API via the shared package.',
  },
  {
    corpusId: 'sdlc-frontend-routing',
    contextId: 'sdlc-frontend',
    contentType: 'fact',
    tags: ['frontend', 'routing', 'auth', 'domain:sdlc'],
    content:
      'Routing uses React Router v6. Protected routes redirect to login. After ' +
      'login, redirect back to the originally requested page.',
  },

  // Database
  {
    corpusId: 'sdlc-db-migrations',
    contextId: 'sdlc-database',
    contentType: 'rule',
    tags: ['database', 'migrations', 'domain:sdlc'],
    content:
      'Database migrations use a versioned migration tool. Each migration has an up ' +
      'and down function. Migrations are applied in order and tracked in a ' +
      'migrations table. Never modify a migration that has been applied.',
  },
  {
    corpusId: 'sdlc-db-users',
    contextId: 'sdlc-database',
    contentType: 'fact',
    tags: ['database', 'schema', 'users', 'applies-to:User', 'domain:sdlc'],
    content:
      'Users table: id (UUID, PK), email (unique, not null), password_hash (not null), ' +
      'display_name (not null), created_at (timestamp), updated_at (timestamp), ' +
      'deleted_at (nullable timestamp for soft delete).',
  },
  {
    corpusId: 'sdlc-db-todos',
    contextId: 'sdlc-database',
    contentType: 'fact',
    tags: ['database', 'schema', 'todos', 'applies-to:TodoItem', 'domain:sdlc'],
    content:
      'Todos table: id (UUID, PK), user_id (UUID, FK to users, not null), title ' +
      '(not null), description (nullable text), completed (boolean, default false), ' +
      'due_date (nullable timestamp), created_at, updated_at, deleted_at.',
  },
  {
    corpusId: 'sdlc-db-tokens',
    contextId: 'sdlc-database',
    contentType: 'fact',
    tags: ['database', 'schema', 'tokens', 'applies-to:JWTToken', 'domain:sdlc'],
    content:
      'Refresh tokens table: id (UUID, PK), user_id (UUID, FK), token_hash ' +
      '(not null, unique), expires_at (timestamp, not null), revoked_at (nullable ' +
      'timestamp), created_at.',
  },
  {
    corpusId: 'sdlc-db-transactions',
    contextId: 'sdlc-database',
    contentType: 'rule',
    tags: ['database', 'transactions', 'domain:sdlc'],
    content:
      'Use database transactions for operations that modify multiple tables. The ' +
      'token refresh operation must invalidate the old token and create the new one ' +
      'atomically.',
  },
  {
    corpusId: 'sdlc-db-indexes',
    contextId: 'sdlc-database',
    contentType: 'instruction',
    tags: ['database', 'indexes', 'domain:sdlc'],
    content:
      'Index strategy: unique index on users.email, index on todos.user_id, index ' +
      'on refresh_tokens.token_hash, index on refresh_tokens.user_id. Add indexes ' +
      'based on query patterns, not speculatively.',
  },

  // Deployment
  {
    corpusId: 'sdlc-deploy-cdk',
    contextId: 'sdlc-deployment',
    contentType: 'fact',
    tags: ['deployment', 'aws', 'cdk', 'domain:sdlc'],
    content:
      'Deploy to AWS using CDK. Infrastructure defined as code in an infra package ' +
      'within the monorepo. Environments: dev, staging, production. Each environment ' +
      'has isolated resources.',
  },
  {
    corpusId: 'sdlc-deploy-cicd',
    contextId: 'sdlc-deployment',
    contentType: 'instruction',
    tags: ['deployment', 'ci-cd', 'domain:sdlc'],
    content:
      'CI/CD pipeline: on push to main, run linting, type checking, and all tests. ' +
      'On tag, deploy to staging. Production deploys require manual approval after ' +
      'staging validation.',
  },
  {
    corpusId: 'sdlc-deploy-secrets',
    contextId: 'sdlc-deployment',
    contentType: 'rule',
    tags: ['deployment', 'secrets', 'security', 'domain:sdlc'],
    content:
      'Environment variables for secrets: DATABASE_URL, JWT_PRIVATE_KEY, ' +
      'JWT_PUBLIC_KEY. Never commit secrets to version control. Use AWS Secrets ' +
      'Manager in deployed environments.',
  },
];

// ---------------------------------------------------------------------------
// Project management (lower density)
// ---------------------------------------------------------------------------

const pmUnits: BenchmarkUnit[] = [
  {
    corpusId: 'pm-wbs',
    contextId: 'pm',
    contentType: 'instruction',
    tags: ['pm', 'planning', 'wbs', 'domain:project-management'],
    content:
      'Work breakdown structure (WBS): decompose a project into progressively ' +
      'smaller deliverables until each can be estimated and assigned. Each level ' +
      'is a complete representation of the work above it — together, the leaves ' +
      'sum to the project. Not a task list — a deliverable hierarchy.',
  },
  {
    corpusId: 'pm-critical-path',
    contextId: 'pm',
    contentType: 'fact',
    tags: ['pm', 'planning', 'scheduling', 'domain:project-management'],
    content:
      'Critical path: the longest chain of dependent activities through a project. ' +
      'Delays on the critical path delay the project. Activities off the critical ' +
      'path have slack. Identify the critical path to know where attention is most ' +
      'valuable.',
  },
  {
    corpusId: 'pm-risk-register',
    contextId: 'pm',
    contentType: 'instruction',
    tags: ['pm', 'risk-management', 'domain:project-management'],
    content:
      'Maintain a risk register: a living list of known risks with probability, ' +
      'impact, owner, mitigation strategy, and current status. Review at each ' +
      'check-in. New risks are added as identified; closed risks are archived with ' +
      'an outcome note.',
  },
  {
    corpusId: 'pm-raci',
    contextId: 'pm',
    contentType: 'fact',
    tags: ['pm', 'governance', 'domain:project-management'],
    content:
      'RACI matrix: for each major deliverable or decision, identify who is ' +
      'Responsible (does the work), Accountable (approves and owns outcome), ' +
      'Consulted (input before decision), and Informed (notified after). One and ' +
      'only one Accountable per item.',
  },
  {
    corpusId: 'pm-agile-iteration',
    contextId: 'pm',
    contentType: 'instruction',
    tags: ['pm', 'agile', 'domain:project-management'],
    content:
      'Agile iterations (sprints) are fixed-length timeboxes — typically 1 to 3 ' +
      'weeks. The team commits to a set of work at the start, delivers at the end, ' +
      'and reviews progress. Scope can be reduced within an iteration but not ' +
      'increased; the timebox does not slip.',
  },
  {
    corpusId: 'pm-retrospective',
    contextId: 'pm',
    contentType: 'instruction',
    tags: ['pm', 'agile', 'improvement', 'domain:project-management'],
    content:
      'Retrospective: after each iteration or milestone, the team discusses what ' +
      'went well, what did not, and what to change. Identify one or two improvements ' +
      'to try in the next iteration. A retrospective without action items is ' +
      'performative.',
  },
  {
    corpusId: 'pm-kanban',
    contextId: 'pm',
    contentType: 'fact',
    tags: ['pm', 'agile', 'kanban', 'domain:project-management'],
    content:
      'Kanban: visualize work-in-progress on a board with columns (e.g., Todo, ' +
      'In Progress, Review, Done). Limit WIP per column to reduce context switching ' +
      'and surface bottlenecks. Pull work rather than push; new work starts only ' +
      'when capacity opens.',
  },
  {
    corpusId: 'pm-stakeholder',
    contextId: 'pm',
    contentType: 'instruction',
    tags: ['pm', 'stakeholders', 'communication', 'domain:project-management'],
    content:
      'Stakeholder analysis: identify who has influence and interest in the project. ' +
      'Plan communication frequency and depth by quadrant — high-influence, ' +
      'high-interest stakeholders need close engagement; low on both need only ' +
      'periodic updates.',
  },
  {
    corpusId: 'pm-estimation',
    contextId: 'pm',
    contentType: 'instruction',
    tags: ['pm', 'estimation', 'domain:project-management'],
    content:
      'Estimates are probabilistic, not deterministic. Prefer ranges over single ' +
      'numbers (e.g., "3–5 weeks") and track how estimates converge with execution. ' +
      'Reference-class forecasting: compare with past similar projects rather than ' +
      'bottom-up summing alone.',
  },
  {
    corpusId: 'pm-change-control',
    contextId: 'pm',
    contentType: 'rule',
    tags: ['pm', 'governance', 'change-management', 'domain:project-management'],
    content:
      'Scope changes require change control: document the change, analyze impact on ' +
      'schedule, cost, and risk, then get explicit approval from the accountable ' +
      'sponsor before acting. Uncontrolled scope is the most common cause of project ' +
      'overruns.',
  },
  {
    corpusId: 'pm-milestones',
    contextId: 'pm',
    contentType: 'instruction',
    tags: ['pm', 'planning', 'domain:project-management'],
    content:
      'Define milestones as checkpoints with clear, verifiable completion criteria. ' +
      'Milestones are not tasks — they mark the end of a set of work with ' +
      'demonstrable deliverables. Good milestones reduce ambiguity about progress.',
  },
  {
    corpusId: 'pm-definition-of-done',
    contextId: 'pm',
    contentType: 'rule',
    tags: ['pm', 'agile', 'quality', 'applies-to:any-deliverable', 'domain:project-management'],
    content:
      'Definition of done: an explicit, team-agreed checklist that a deliverable ' +
      'must satisfy before being considered complete. Prevents premature closure ' +
      'and misunderstandings. Includes quality checks (tests, review, documentation) ' +
      'and integration requirements (merged, deployed, verified).',
  },
  {
    corpusId: 'pm-capacity',
    contextId: 'pm',
    contentType: 'fact',
    tags: ['pm', 'planning', 'domain:project-management'],
    content:
      'Capacity planning: estimate team bandwidth in hours or story points per ' +
      'iteration, accounting for meetings, support, and non-project overhead. ' +
      'Typical useful-hours-per-engineer-per-week is 25–30, not 40. Plan from ' +
      'actual historical capacity, not theoretical.',
  },
  {
    corpusId: 'pm-prioritization',
    contextId: 'pm',
    contentType: 'instruction',
    tags: ['pm', 'prioritization', 'domain:project-management'],
    content:
      'Prioritize work by expected value and urgency, not by who requested it. ' +
      'Common frameworks: MoSCoW (Must/Should/Could/Won\'t), WSJF (weighted shortest ' +
      'job first), or impact/effort quadrants. Re-prioritize as conditions change.',
  },
  {
    corpusId: 'pm-lessons-learned',
    contextId: 'pm',
    contentType: 'instruction',
    tags: ['pm', 'knowledge-management', 'domain:project-management'],
    content:
      'Lessons learned: at project milestones or end, document what to repeat and ' +
      'what to change. Cross-reference with prior projects\' lessons before ' +
      'starting new work. Organizations that fail to capture lessons relearn them ' +
      'at cost.',
  },
];

// ---------------------------------------------------------------------------
// Process and workflow
// ---------------------------------------------------------------------------

const processUnits: BenchmarkUnit[] = [
  {
    corpusId: 'process-bpm',
    contextId: 'process',
    contentType: 'fact',
    tags: ['process', 'bpm', 'domain:process-workflow'],
    content:
      'Business process management (BPM) is the discipline of modeling, automating, ' +
      'executing, measuring, and improving business processes. A process is a ' +
      'repeated sequence of steps that transforms input into output with ' +
      'identifiable actors and decision points.',
  },
  {
    corpusId: 'process-request-fulfillment',
    contextId: 'process',
    contentType: 'instruction',
    tags: ['process', 'operations', 'domain:process-workflow'],
    content:
      'Request fulfillment workflow: intake (capture request and requester), ' +
      'triage (categorize, assess impact, assign priority), assignment (route to ' +
      'appropriate owner), execution (perform the work), verification (confirm ' +
      'with requester), closure (record outcome and close).',
  },
  {
    corpusId: 'process-incident-management',
    contextId: 'process',
    contentType: 'instruction',
    tags: ['process', 'operations', 'incident', 'domain:process-workflow'],
    content:
      'Incident management: detect an unplanned interruption, restore service as ' +
      'fast as possible, log a record. Post-incident review identifies root cause ' +
      'and preventive actions separate from the immediate restoration work. ' +
      'Severity drives response time and communication cadence.',
  },
  {
    corpusId: 'process-change-management',
    contextId: 'process',
    contentType: 'instruction',
    tags: ['process', 'operations', 'change', 'domain:process-workflow'],
    content:
      'Change management process: request → assess risk/impact → approve → schedule ' +
      '→ implement → verify → document. Standard changes are pre-approved; normal ' +
      'changes need review; emergency changes follow expedited path with post-hoc ' +
      'review.',
  },
  {
    corpusId: 'process-sla',
    contextId: 'process',
    contentType: 'fact',
    tags: ['process', 'sla', 'operations', 'domain:process-workflow'],
    content:
      'Service level agreement (SLA): an explicit commitment to performance ' +
      'standards such as availability percentage, response time, or resolution ' +
      'time. SLAs differ from SLOs (internal targets) and SLIs (measured indicators). ' +
      'Breaching an SLA typically triggers escalation or contractual consequences.',
  },
  {
    corpusId: 'process-swimlane',
    contextId: 'process',
    contentType: 'instruction',
    tags: ['process', 'bpm', 'modeling', 'domain:process-workflow'],
    content:
      'Swimlane diagram: visualize a process with a lane per actor (role or system). ' +
      'Steps within a lane are performed by that actor; arrows crossing lanes show ' +
      'handoffs. Swimlanes make role ambiguity and handoff overhead visible.',
  },
  {
    corpusId: 'process-root-cause',
    contextId: 'process',
    contentType: 'instruction',
    tags: ['process', 'operations', 'analysis', 'domain:process-workflow'],
    content:
      'Root cause analysis: investigate beyond proximate cause to find the underlying ' +
      'condition enabling the failure. Techniques: 5 Whys, fishbone (Ishikawa) ' +
      'diagram, fault tree analysis. A good RCA identifies changes that would ' +
      'prevent recurrence, not just explanations.',
  },
  {
    corpusId: 'process-continuous-improvement',
    contextId: 'process',
    contentType: 'rule',
    tags: ['process', 'improvement', 'kaizen', 'domain:process-workflow'],
    content:
      'Continuous improvement: small, ongoing changes driven by observation of how ' +
      'the process actually runs. Measure before and after. Prefer many small ' +
      'experiments to one large redesign — easier to evaluate causality and ' +
      'cheaper to revert.',
  },
  {
    corpusId: 'process-bottleneck',
    contextId: 'process',
    contentType: 'instruction',
    tags: ['process', 'operations', 'optimization', 'domain:process-workflow'],
    content:
      'Theory of constraints: system throughput is limited by its single bottleneck. ' +
      'Optimizing non-bottleneck steps does not increase throughput. Find the ' +
      'bottleneck, exploit it fully, subordinate other resources to it, then elevate ' +
      'its capacity.',
  },
  {
    corpusId: 'process-metrics',
    contextId: 'process',
    contentType: 'instruction',
    tags: ['process', 'measurement', 'domain:process-workflow'],
    content:
      'Process metrics: lead time (request to delivery), cycle time (work start to ' +
      'finish), throughput (items completed per period), first-time-right rate. ' +
      'Measure both the process and the queue (waiting time) — queue is often the ' +
      'biggest contributor to lead time.',
  },
];

// ---------------------------------------------------------------------------
// Physical engineering
// ---------------------------------------------------------------------------

const peUnits: BenchmarkUnit[] = [
  // General
  {
    corpusId: 'pe-tolerancing',
    contextId: 'pe',
    contentType: 'instruction',
    tags: ['engineering', 'design', 'tolerancing', 'gdnt', 'domain:physical-engineering'],
    content:
      'Tolerancing: specify acceptable variation in dimensions. Tight tolerances ' +
      'cost more. Use geometric dimensioning and tolerancing (GD&T) to describe ' +
      'relationships (flatness, perpendicularity, true position) rather than just ' +
      'dimensions. Over-tolerancing wastes money; under-tolerancing causes failures.',
  },
  {
    corpusId: 'pe-dfm',
    contextId: 'pe',
    contentType: 'rule',
    tags: ['engineering', 'design-for-manufacturability', 'domain:physical-engineering'],
    content:
      'Design for manufacturability (DFM): consider the manufacturing process early ' +
      'in design. Features that are easy to design may be expensive or impossible ' +
      'to make. Consult with manufacturers before freezing geometry. Minimum radii, ' +
      'draft angles, and tool access are common constraints.',
  },
  {
    corpusId: 'pe-materials',
    contextId: 'pe',
    contentType: 'instruction',
    tags: ['engineering', 'materials', 'selection', 'domain:physical-engineering'],
    content:
      'Material selection depends on the loading case, environment, manufacturing ' +
      'process, and cost. Key properties: strength (yield and ultimate), stiffness ' +
      '(modulus), toughness, fatigue resistance, corrosion resistance, temperature ' +
      'range, density, machinability. Use Ashby charts to compare materials by ' +
      'property ratios.',
  },
  {
    corpusId: 'pe-fos',
    contextId: 'pe',
    contentType: 'rule',
    tags: ['engineering', 'safety', 'design', 'domain:physical-engineering'],
    content:
      'Factor of safety (FoS): ratio of material strength to expected maximum stress. ' +
      'Typical values: 1.5–2 for well-characterized static loads, 3+ for dynamic or ' +
      'uncertain loads, 5+ for life-safety systems. Excessive FoS wastes material ' +
      'and mass; inadequate FoS causes failures.',
  },

  // CAD
  {
    corpusId: 'pe-cad-parametric',
    contextId: 'pe-cad',
    contentType: 'instruction',
    tags: ['cad', 'parametric', 'design', 'domain:physical-engineering'],
    content:
      'Parametric CAD: model geometry with named dimensions and relationships. ' +
      'Change a parameter and dependent features update. Design intent is encoded ' +
      'in the parametric relationships, making revisions cheap. Prefer parametric ' +
      'features over explicit geometry where practical.',
  },
  {
    corpusId: 'pe-cad-assembly',
    contextId: 'pe-cad',
    contentType: 'instruction',
    tags: ['cad', 'assembly', 'domain:physical-engineering'],
    content:
      'Assembly modeling: combine parts with mates (concentric, coincident, distance). ' +
      'A good assembly is fully constrained — no underdefined or overdefined mates. ' +
      'Use subassemblies to group related parts and manage complexity. Bill of ' +
      'materials (BOM) is derived from the assembly tree.',
  },
  {
    corpusId: 'pe-cad-drawings',
    contextId: 'pe-cad',
    contentType: 'fact',
    tags: ['cad', 'drawings', 'documentation', 'domain:physical-engineering'],
    content:
      'Engineering drawings formalize a design for manufacturing: orthographic views, ' +
      'dimensions with tolerances, section views, notes on surface finish and ' +
      'material. Drawings are the contract with manufacturers — ambiguity in drawings ' +
      'causes rework and disputes.',
  },
  {
    corpusId: 'pe-cad-revisions',
    contextId: 'pe-cad',
    contentType: 'rule',
    tags: ['cad', 'revisions', 'change-management', 'domain:physical-engineering'],
    content:
      'Treat CAD files like code: version control, meaningful commit messages, ' +
      'review before merging. Released drawings follow formal revision control ' +
      '(rev A, B, C with change notes). Never modify a released drawing without ' +
      'bumping the revision.',
  },

  // Simulation
  {
    corpusId: 'pe-sim-fea',
    contextId: 'pe-simulation',
    contentType: 'instruction',
    tags: ['simulation', 'fea', 'analysis', 'domain:physical-engineering'],
    content:
      'Finite element analysis (FEA): discretize geometry into elements, apply loads ' +
      'and boundary conditions, solve for stresses and deformations. Results depend ' +
      'heavily on mesh quality and boundary conditions. Always validate against a ' +
      'hand calculation or known case before trusting simulation numbers.',
  },
  {
    corpusId: 'pe-sim-mesh-convergence',
    contextId: 'pe-simulation',
    contentType: 'rule',
    tags: ['simulation', 'fea', 'validation', 'domain:physical-engineering'],
    content:
      'Mesh convergence study: refine the mesh progressively and confirm that ' +
      'results stabilize. If doubling mesh density changes peak stress by more than ' +
      '5%, the mesh is too coarse for that feature. Stress concentrations need ' +
      'denser mesh; bulk regions can be coarser.',
  },
  {
    corpusId: 'pe-sim-cfd',
    contextId: 'pe-simulation',
    contentType: 'fact',
    tags: ['simulation', 'cfd', 'analysis', 'domain:physical-engineering'],
    content:
      'Computational fluid dynamics (CFD) solves fluid flow, heat transfer, and ' +
      'sometimes reactive flows. Turbulence modeling is the major source of error; ' +
      'choose the right model (RANS, LES, DNS) for the regime. Y+ wall treatment ' +
      'and boundary layer mesh are critical for accurate wall stress and heat transfer.',
  },

  // Manufacturing
  {
    corpusId: 'pe-mfg-cnc',
    contextId: 'pe-manufacturing',
    contentType: 'instruction',
    tags: ['manufacturing', 'cnc', 'subtractive', 'domain:physical-engineering'],
    content:
      'CNC machining: subtractive manufacturing that removes material from stock. ' +
      'Typical processes: milling (cutting with rotating tool), turning (spinning ' +
      'workpiece against a tool). Constraints: tool access, minimum internal radii ' +
      'equal to tool radius, fixturing requirements, and tool life.',
  },
  {
    corpusId: 'pe-mfg-additive',
    contextId: 'pe-manufacturing',
    contentType: 'instruction',
    tags: ['manufacturing', 'additive', '3d-printing', 'domain:physical-engineering'],
    content:
      'Additive manufacturing (3D printing): build parts layer by layer. Processes ' +
      'include FDM (extruded plastic), SLA (photopolymer resin), SLS (laser-sintered ' +
      'powder), DMLS (metal powder). Good for complex geometry and low volume; less ' +
      'competitive at high volume. Anisotropic strength between layers is a design ' +
      'consideration.',
  },
  {
    corpusId: 'pe-mfg-tolerances',
    contextId: 'pe-manufacturing',
    contentType: 'fact',
    tags: ['manufacturing', 'tolerances', 'domain:physical-engineering'],
    content:
      'Typical tolerances by process: milling ±0.1 mm; turning ±0.05 mm; grinding ' +
      '±0.01 mm; FDM ±0.3 mm; SLA ±0.1 mm; injection molding ±0.1 mm (feature ' +
      'dependent). Tight tolerances typically require secondary finishing operations ' +
      'like grinding or reaming.',
  },
  {
    corpusId: 'pe-mfg-inspection',
    contextId: 'pe-manufacturing',
    contentType: 'instruction',
    tags: ['manufacturing', 'inspection', 'quality', 'domain:physical-engineering'],
    content:
      'First article inspection (FAI) verifies the first part of a production run ' +
      'against drawings before running the rest. Coordinate measuring machines ' +
      '(CMM) or optical scanners provide detailed dimensional verification. ' +
      'Statistical process control monitors ongoing production.',
  },
  {
    corpusId: 'pe-mfg-make-vs-buy',
    contextId: 'pe-manufacturing',
    contentType: 'decision',
    tags: ['manufacturing', 'sourcing', 'domain:physical-engineering'],
    content:
      'Make-vs-buy decision: produce in-house (control, investment, IP) vs outsource ' +
      '(flexibility, supplier expertise, capital avoidance). Factors include volume, ' +
      'strategic importance, existing capability, and lead time. Revisit the ' +
      'decision as conditions change — the right answer evolves.',
  },
];

// ---------------------------------------------------------------------------
// Mathematics (lower density — concepts and selected applications)
// ---------------------------------------------------------------------------

const mathUnits: BenchmarkUnit[] = [
  {
    corpusId: 'math-mean-median',
    contextId: 'math',
    contentType: 'fact',
    tags: ['math', 'statistics', 'descriptive', 'domain:mathematics'],
    content:
      'Mean is the arithmetic average; median is the middle value of a sorted list. ' +
      'Median is robust to outliers — a single large value can shift the mean ' +
      'dramatically but leaves the median unchanged. Report both when distributions ' +
      'are skewed.',
  },
  {
    corpusId: 'math-std-dev',
    contextId: 'math',
    contentType: 'fact',
    tags: ['math', 'statistics', 'descriptive', 'domain:mathematics'],
    content:
      'Standard deviation measures the spread of a distribution — the typical ' +
      'distance of a data point from the mean. Variance is its square. For normal ' +
      'distributions, ~68% of data falls within one standard deviation of the mean, ' +
      '~95% within two.',
  },
  {
    corpusId: 'math-hypothesis-test',
    contextId: 'math',
    contentType: 'instruction',
    tags: ['math', 'statistics', 'inference', 'domain:mathematics'],
    content:
      'Hypothesis testing: state a null hypothesis (e.g., "no difference between A ' +
      'and B"), collect data, compute a p-value (probability of the observed data ' +
      'if the null is true). Reject the null if p < chosen threshold (commonly 0.05). ' +
      'p-value is NOT the probability that the null is true.',
  },
  {
    corpusId: 'math-ab-testing',
    contextId: 'math',
    contentType: 'instruction',
    tags: ['math', 'statistics', 'experimentation', 'applies-to:software', 'domain:mathematics'],
    content:
      'A/B testing: randomly assign users to variants A and B, measure outcomes, ' +
      'apply a hypothesis test. Required sample size depends on expected effect ' +
      'size, baseline variance, desired statistical power, and significance level. ' +
      'Pre-register the analysis plan before looking at data — peeking inflates ' +
      'false-positive rates.',
  },
  {
    corpusId: 'math-bayesian',
    contextId: 'math',
    contentType: 'fact',
    tags: ['math', 'statistics', 'bayesian', 'domain:mathematics'],
    content:
      'Bayesian inference updates a prior belief with new data to produce a ' +
      'posterior belief. Posterior ∝ prior × likelihood. Useful when prior ' +
      'information exists, sample sizes are small, or probabilities need direct ' +
      'interpretation ("there is a 72% chance of X").',
  },
  {
    corpusId: 'math-correlation-causation',
    contextId: 'math',
    contentType: 'rule',
    tags: ['math', 'statistics', 'reasoning', 'domain:mathematics'],
    content:
      'Correlation does not imply causation. Observed association can arise from ' +
      'direct causation, reverse causation, common cause, selection bias, or ' +
      'coincidence. Establish causation via randomized experiments, natural ' +
      'experiments, or causal identification strategies.',
  },
  {
    corpusId: 'math-matrix-basics',
    contextId: 'math',
    contentType: 'fact',
    tags: ['math', 'linear-algebra', 'domain:mathematics'],
    content:
      'A matrix is a rectangular array of numbers. Matrix multiplication is not ' +
      'commutative in general. A square matrix is invertible iff its determinant ' +
      'is nonzero. The rank is the number of linearly independent rows (or columns). ' +
      'Matrices represent linear transformations — useful for graphics, ML, control ' +
      'systems, and structural analysis.',
  },
  {
    corpusId: 'math-eigenvalues',
    contextId: 'math',
    contentType: 'fact',
    tags: ['math', 'linear-algebra', 'eigendecomposition', 'domain:mathematics'],
    content:
      'Eigenvalues and eigenvectors: for a square matrix A, an eigenvector v ' +
      'satisfies Av = λv for scalar eigenvalue λ. They identify the invariant ' +
      'directions of a linear transformation. Used in PCA, vibration analysis, ' +
      'PageRank, and quantum mechanics.',
  },
  {
    corpusId: 'math-optimization',
    contextId: 'math',
    contentType: 'instruction',
    tags: ['math', 'optimization', 'domain:mathematics'],
    content:
      'Mathematical optimization finds the best choice from a feasible set. Key ' +
      'questions: Is the objective convex (global optima easy) or non-convex (local ' +
      'optima possible)? Are constraints linear or nonlinear? Is the problem ' +
      'continuous or discrete (integer programming)? Algorithm choice follows from ' +
      'these answers.',
  },
  {
    corpusId: 'math-derivative',
    contextId: 'math',
    contentType: 'fact',
    tags: ['math', 'calculus', 'domain:mathematics'],
    content:
      'Derivative measures rate of change: how much f(x) changes per unit change ' +
      'in x. Zero derivative indicates local extremum (maximum, minimum, or saddle). ' +
      'Gradient generalizes derivative to multivariate functions — it points in the ' +
      'direction of steepest increase. Gradient descent follows negative gradient.',
  },
  {
    corpusId: 'math-integration',
    contextId: 'math',
    contentType: 'fact',
    tags: ['math', 'calculus', 'domain:mathematics'],
    content:
      'Integration accumulates quantities over a range — area under a curve, total ' +
      'from a rate, mass from density. Fundamental theorem of calculus links ' +
      'integration and differentiation as inverse operations. Numerical integration ' +
      '(trapezoidal, Simpson\'s) approximates when closed form is impractical.',
  },
  {
    corpusId: 'math-probability-basics',
    contextId: 'math',
    contentType: 'fact',
    tags: ['math', 'probability', 'domain:mathematics'],
    content:
      'Probability axioms: P(A) ∈ [0,1], P(sample space) = 1, P(A or B) = P(A) + ' +
      'P(B) when A and B are mutually exclusive. Conditional probability: ' +
      'P(A|B) = P(A and B) / P(B). Independence: P(A|B) = P(A). Bayes\' theorem ' +
      'relates conditional probabilities in both directions.',
  },
];

// ---------------------------------------------------------------------------
// Assemble the corpus
// ---------------------------------------------------------------------------

const allUnits: BenchmarkUnit[] = [
  ...methodologyUnits,
  ...sdlcUnits,
  ...pmUnits,
  ...processUnits,
  ...peUnits,
  ...mathUnits,
];

export const EXPANDED_WORKSPACE_CORPUS: BenchmarkCorpus = {
  name: 'expanded-workspace',
  description:
    'Multi-domain workspace corpus covering software development, project management, ' +
    'process/workflow, physical engineering, and mathematics. Shared methodology ' +
    'context holds practices that apply across domains. Designed for walkthroughs ' +
    'that test cross-domain retrieval and reasoning.',
  contexts,
  units: allUnits,
};

/**
 * Count summary — useful for displaying corpus stats.
 */
export function getCorpusCounts() {
  const byContext = new Map<string, number>();
  for (const u of allUnits) {
    byContext.set(u.contextId, (byContext.get(u.contextId) ?? 0) + 1);
  }
  return {
    totalUnits: allUnits.length,
    totalContexts: contexts.length,
    unitsByContext: Object.fromEntries(byContext),
  };
}
