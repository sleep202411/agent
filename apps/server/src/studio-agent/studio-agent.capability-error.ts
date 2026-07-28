import {
  StudioAgentErrorSchema,
  type StudioAgentError,
} from '@repo/shared/studio-agent';
import type { ErrorObject } from 'ajv';
import { z, ZodError } from 'zod';

/**
 * The one error code a rejected capability input is ever reported under.
 *
 * Two gates can reject the same tool call — the manifest schema, before the
 * action is persisted, and the capability's own zod schema, inside the
 * execution attempt — and both report it with this code, this message shape and
 * these issue paths. Anything that has to tell a correctable input apart from a
 * lost write (the terminal-write-failure contract, the correction budget) keys
 * off this constant rather than guessing from an error class.
 */
export const STUDIO_AGENT_INVALID_ACTION_INPUT_CODE =
  'studio_agent.invalid_action_input';

/**
 * Rendering bounds for the issue list.
 *
 * `StudioAgentErrorSchema.message` caps at 8 000 characters and is parsed while
 * recording the failure — after the attempt savepoint is gone — so an oversized
 * message would abort the enclosing transaction and turn a recordable failure
 * into an unexplained 500 with no `failed` row. The same string is replayed into
 * the model's context on every later step, where an unbounded issue dump would
 * inflate every subsequent prompt.
 */
const CAPABILITY_ERROR_ISSUE_MAX = 12;
export const CAPABILITY_ERROR_TEXT_MAX = 2_000;

export interface StudioAgentCapabilityInputIssue {
  path: string;
  message: string;
}

/**
 * The single way anything says "the model's tool input is wrong".
 *
 * Attribution used to be inferred from the error class: any `ZodError` reaching
 * the executor was reported as `studio_agent.invalid_action_input` with the
 * fixed sentence "The prepared capability input is invalid." But zod is how
 * this whole subsystem validates *everything* — the action input, the derived
 * scope, the capability output, the change-set summary, the execution envelope,
 * the event draft. Only the first of those is the model's doing.
 *
 * The cost of guessing was measured: a `story.canvas.apply_patch` whose input
 * was perfectly valid wrote the draft, then threw a `ZodError` from the
 * server's own change-set summary, and both the creator and the model were told
 * the input was malformed. Hours went into re-authoring an input that had
 * nothing wrong with it.
 *
 * So input rejection is now explicit and cannot be confused with anything else:
 * adapters parse the action input through {@link parseCapabilityInput}, the
 * registry raises the same error for a manifest rejection, and a bare `ZodError`
 * from anywhere else is reported as what it is — a server-side contract
 * violation, never blamed on the input.
 */
export class StudioAgentCapabilityInputError extends Error {
  readonly issues: StudioAgentCapabilityInputIssue[];

  constructor(
    issues: readonly StudioAgentCapabilityInputIssue[],
    options?: ErrorOptions,
  ) {
    super(describeCapabilityIssues(issues), options);
    this.name = 'StudioAgentCapabilityInputError';
    this.issues = [...issues];
  }

  static fromZod(cause: ZodError): StudioAgentCapabilityInputError {
    return new StudioAgentCapabilityInputError(zodCapabilityIssues(cause), {
      cause,
    });
  }
}

/**
 * Parse a persisted action input, attributing any rejection to the input.
 *
 * Adapters must use this instead of `schema.parse(action.input)` so the
 * executor can tell an input rejection apart from a zod failure in the
 * capability's own result path.
 */
export function parseCapabilityInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw StudioAgentCapabilityInputError.fromZod(parsed.error);
  }
  return parsed.data;
}

/** The canonical model- and creator-visible record of a rejected input. */
export function capabilityInputRejectionError(
  issues: readonly StudioAgentCapabilityInputIssue[],
): StudioAgentError {
  const bounded = issues.slice(0, CAPABILITY_ERROR_ISSUE_MAX);
  return StudioAgentErrorSchema.parse({
    code: STUDIO_AGENT_INVALID_ACTION_INPUT_CODE,
    message: `The capability input is invalid and was not executed. Correct it and call the tool again. ${describeCapabilityIssues(issues)}`,
    // Deterministic: the identical bytes fail identically. The model has to
    // change the input, which is what the correction budget exists to bound.
    retryable: false,
    details: { issues: bounded },
  });
}

export function zodCapabilityIssues(
  error: ZodError,
): StudioAgentCapabilityInputIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/**
 * Turns AJV output into the issue list a model can act on.
 *
 * A closed discriminated union produces one failure per branch, so an operation
 * with a bad payload reports ten "must be equal to constant" lines about the
 * nine kinds it never claimed to be. Branches that lost on their discriminator
 * are dropped whenever a branch matched it, which leaves the errors from the
 * branch the model actually addressed. When no branch matched, the mismatch is
 * reported once — the value is not a legal kind, and saying so ten times helps
 * nobody.
 */
export function jsonSchemaCapabilityIssues(
  errors: readonly ErrorObject[] | null | undefined,
): StudioAgentCapabilityInputIssue[] {
  const candidates = (errors ?? []).filter(
    (error) =>
      error.keyword !== 'anyOf' &&
      error.keyword !== 'oneOf' &&
      error.keyword !== 'if',
  );
  const ancestorsOf = new Map<ErrorObject, BranchAncestor[]>();
  const rejectedBranches = new Set<string>();
  for (const error of candidates) {
    const ancestors = branchAncestors(error);
    ancestorsOf.set(error, ancestors);
    const innermost = ancestors.at(-1);
    if (innermost && isDiscriminatorRejection(error)) {
      rejectedBranches.add(innermost.branch);
    }
  }
  const kept = candidates.filter(
    (error) =>
      !(ancestorsOf.get(error) ?? []).some((ancestor) =>
        rejectedBranches.has(ancestor.branch),
      ),
  );
  const survivingUnions = new Set<string>();
  for (const error of kept) {
    for (const ancestor of ancestorsOf.get(error) ?? []) {
      survivingUnions.add(ancestor.union);
    }
  }
  // A union whose every branch lost on its discriminator says one thing: the
  // value is not one of these. Report that once, naming all of them.
  const collapsed = new Map<string, { path: string; allowed: Set<string> }>();
  for (const error of candidates) {
    if (!isDiscriminatorRejection(error)) continue;
    const innermost = (ancestorsOf.get(error) ?? []).at(-1);
    if (!innermost || survivingUnions.has(innermost.union)) continue;
    const entry = collapsed.get(innermost.union) ?? {
      path: jsonSchemaIssuePath(error),
      allowed: new Set<string>(),
    };
    for (const value of allowedValues(error)) {
      entry.allowed.add(JSON.stringify(value));
    }
    collapsed.set(innermost.union, entry);
  }
  const issues: StudioAgentCapabilityInputIssue[] = [];
  const seen = new Set<string>();
  const push = (issue: StudioAgentCapabilityInputIssue): void => {
    const key = `${issue.path}|${issue.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };
  for (const error of kept) {
    push({
      path: jsonSchemaIssuePath(error),
      message: describeJsonSchemaIssue(error),
    });
  }
  for (const entry of collapsed.values()) {
    push({
      path: entry.path,
      message: `must be one of ${[...entry.allowed].join(', ')}`,
    });
  }
  return issues;
}

/**
 * Renders validation issues into the one field anyone actually reads.
 *
 * `details.issues` has always carried the actionable content — the failing
 * path and why it failed — and it reached the browser intact. Nothing rendered
 * it: the studio shows `error.message`, which was the fixed sentence "The
 * prepared capability input is invalid." So a creator watching a rewrite fail
 * five times was never shown `operations.0.payload.intent` even once.
 */
export function describeCapabilityIssues(
  issues: readonly StudioAgentCapabilityInputIssue[],
): string {
  if (issues.length === 0) {
    // Never expected: both gates report at least one issue. An empty render
    // would fail `StudioAgentErrorSchema` (message min 1) while recording the
    // failure, destroying the record instead of the message.
    return 'The input does not satisfy this capability schema.';
  }
  const rendered: string[] = [];
  let budget = CAPABILITY_ERROR_TEXT_MAX;
  for (const issue of issues.slice(0, CAPABILITY_ERROR_ISSUE_MAX)) {
    const text = boundCapabilityErrorText(
      issue.path.length === 0
        ? issue.message
        : `${issue.path}: ${issue.message}`,
    );
    if (text.length > budget && rendered.length > 0) break;
    rendered.push(text);
    budget -= text.length;
  }
  const omitted = issues.length - rendered.length;
  const summary = rendered.join('; ');
  return omitted > 0 ? `${summary} (+${omitted} more)` : summary;
}

/**
 * Caps any single piece of borrowed error text.
 *
 * Every branch that builds a `StudioAgentError` has to respect the 8 000-char
 * schema cap, including the ones that pass an upstream message through: that
 * string is written to the action's `error` column and replayed into the
 * model's context, and a schema rejection while recording a failure destroys
 * the failure record itself.
 */
export function boundCapabilityErrorText(text: string): string {
  return text.length <= CAPABILITY_ERROR_TEXT_MAX
    ? text
    : `${text.slice(0, CAPABILITY_ERROR_TEXT_MAX - 1)}…`;
}

interface BranchAncestor {
  union: string;
  branch: string;
}

/**
 * Every `anyOf` branch a single AJV error sits inside, outermost first.
 *
 * Keys carry the instance the union was applied to as well as its schema path:
 * `operations[0]` and `operations[1]` are the same schema and must not share a
 * verdict, or one operation's valid kind would rescue another's typo.
 */
function branchAncestors(error: ErrorObject): BranchAncestor[] {
  const ancestors: BranchAncestor[] = [];
  const pattern = /\/(?:any|one)Of\/\d+/g;
  for (const match of error.schemaPath.matchAll(pattern)) {
    const unionPath = error.schemaPath.slice(0, match.index);
    const branchPath = error.schemaPath.slice(0, match.index + match[0].length);
    const instance = instancePrefix(
      error.instancePath,
      instanceDepth(unionPath),
    );
    ancestors.push({
      union: `${instance}|${unionPath}`,
      branch: `${instance}|${branchPath}`,
    });
  }
  return ancestors;
}

/**
 * How many instance segments a schema path has consumed: one per named property
 * and one per array item. That is the depth at which the union applies, so the
 * same prefix of `instancePath` identifies which value is being judged.
 */
function instanceDepth(schemaPath: string): number {
  return (
    (schemaPath.match(/\/properties\//g)?.length ?? 0) +
    (schemaPath.match(/\/items(?=\/|$)/g)?.length ?? 0)
  );
}

function instancePrefix(instancePath: string, depth: number): string {
  return `/${instancePath.split('/').filter(Boolean).slice(0, depth).join('/')}`;
}

function isDiscriminatorRejection(error: ErrorObject): boolean {
  return error.keyword === 'const' || error.keyword === 'enum';
}

function allowedValues(error: ErrorObject): unknown[] {
  const params = error.params as {
    allowedValue?: unknown;
    allowedValues?: unknown[];
  };
  if (Array.isArray(params.allowedValues)) return params.allowedValues;
  return [params.allowedValue];
}

function jsonSchemaIssuePath(error: ErrorObject): string {
  const base = error.instancePath.replace(/^\//, '').split('/').filter(Boolean);
  const missing =
    error.keyword === 'required'
      ? [String((error.params as { missingProperty?: string }).missingProperty)]
      : error.keyword === 'additionalProperties'
        ? [
            String(
              (error.params as { additionalProperty?: string })
                .additionalProperty,
            ),
          ]
        : [];
  return [...base, ...missing.filter((part) => part !== 'undefined')].join('.');
}

function describeJsonSchemaIssue(error: ErrorObject): string {
  if (error.keyword === 'additionalProperties') {
    return 'is not a field of this capability input';
  }
  if (error.keyword === 'required') {
    return 'is required';
  }
  if (error.keyword === 'const') {
    return `must be ${JSON.stringify((error.params as { allowedValue?: unknown }).allowedValue)}`;
  }
  return error.message ?? 'is invalid';
}
