/**
 * The Jev question set. Review and edit questions HERE; bump QUESTION_SET_VERSION on any
 * change (it is part of the cache key and the router config hash).
 *
 * Design rules from the TypeSafe docs (Primitives, How to build, Jev 1.13 jaggedness):
 * - Atomic questions: one judgment each. Grouped ideas (e.g. "risky area") are split into
 *   one Noul per area and combined in code with max().
 * - All questions go in ONE systemOne call per task; code combines the answers (policy.ts).
 * - State is only { task_prompt }: extra context costs accuracy.
 * - Jev reads literally: state exact conditions, use what / not_for / examples for options
 *   that are easy to confuse.
 * - Nothing numeric is asked (prompt length etc. is computed in code).
 * - Noul answers carry no `confidence`, only P(yes). Confidence gating applies to the
 *   Choice (task_type) and Score (scope) only.
 */
import { choice, noul, score, type EntryType } from "@typesafe-ai/sdk";

export const QUESTION_SET_VERSION = "v1";

/** Pin the versioned model: thresholds are tuned against a specific version. */
export const JEV_MODEL = process.env.TYPESAFE_MODEL?.trim() || "jev-1.13.0";

export const buildState = (prompt: string) => ({ task_prompt: prompt });

export const TASK_TYPES = [
  "trivial_edit",
  "localized_bug_fix",
  "feature_clear_spec",
  "multi_file_refactor",
  "architecture_design",
  "investigate_unknown_cause",
  "other",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

const yesNo = (yes: EntryType, no: EntryType) => ({ true: yes, false: no });

export const QUESTIONS = {
  task_type: choice("What kind of work does `task_prompt` ask a coding agent to do?", {
    trivial_edit: {
      what: "A small mechanical change whose exact result is obvious: typo, rename, wording, docs or comments, a config value, formatting, bumping a version.",
      not_for: "Anything that changes program behavior or requires deciding how something should work.",
      examples: ["fix the typo in the README", "rename getUsr to getUser", "bump lodash to 4.17.21"],
    },
    localized_bug_fix: {
      what: "Fix a bug whose symptom AND location (file, function, endpoint, or component) are stated or obvious.",
      not_for: "Bugs where the cause or location is unknown and must be found first; new features.",
      examples: ["the date picker in Settings shows UTC instead of local time, fix it", "off-by-one in paginate() in utils/list.ts"],
    },
    feature_clear_spec: {
      what: "Add new behavior where the prompt states what the result should do.",
      not_for: "Vague ideas without requirements; restructuring existing code without new behavior; choosing between designs.",
      examples: ["add a --json flag to the export command that prints the rows as JSON", "add a 'copy link' button next to each share entry"],
    },
    multi_file_refactor: {
      what: "Restructure existing code across several files without changing what it does: extract modules, change interfaces, migrate an API or library.",
      not_for: "New features; single-line renames; deciding a new architecture.",
      examples: ["move all the fetch calls into an api/ client and update callers", "switch from moment to date-fns everywhere"],
    },
    architecture_design: {
      what: "Decide or design structure: choose patterns, systems, data models, or how components should interact.",
      not_for: "Implementing a design that is already decided.",
      examples: ["how should we split the monolith into services?", "design the caching layer for the feed"],
    },
    investigate_unknown_cause: {
      what: "Find out why something happens when the cause is not known: flaky tests, performance regressions, intermittent errors, unexpected behavior.",
      not_for: "Bugs whose location is already stated.",
      examples: ["why is CI flaky on main?", "the app got slow after last week's deploy, figure out why"],
    },
    other: {
      what: "None of the other options fits.",
      not_for: "Any request that matches another option.",
      examples: ["write a haiku", "what's the weather"],
    },
  }),

  scope: score("How much code will need to change to complete `task_prompt`?", [
    "One or a few lines in one place.",
    "Changes stay inside a single file.",
    "Changes span a few related files.",
    "Changes cut across many files, modules, or the whole codebase.",
  ]),

  // Risky areas: one atomic Noul each; policy takes the max.
  risky_auth: noul(
    "Does `task_prompt` involve changing authentication or authorization code (login, sessions, tokens, passwords, permissions, roles)?",
    yesNo("The change touches how users prove identity or what they are allowed to do.", "The change does not touch identity or access control."),
  ),
  risky_payments: noul(
    "Does `task_prompt` involve changing payment, billing, pricing, invoicing, or money-handling code?",
    yesNo("The change touches charging, refunds, prices, invoices, or balances.", "The change does not touch money handling."),
  ),
  risky_security: noul(
    "Does `task_prompt` involve security-sensitive code (encryption, secrets, input sanitization, CORS/CSP, vulnerability fixes)?",
    yesNo("The change affects a security control or fixes a vulnerability.", "The change does not affect security controls."),
  ),
  risky_db_migration: noul(
    "Does `task_prompt` involve writing or changing a database migration?",
    yesNo("The task adds, edits, or runs a database migration.", "No database migration is involved."),
  ),
  risky_infra: noul(
    "Does `task_prompt` involve changing infrastructure or deployment configuration (CI/CD pipelines, Terraform, Kubernetes, Docker, cloud resources, DNS)?",
    yesNo("The change touches how the software is built, deployed, or hosted.", "The change is application code or docs only."),
  ),

  // Destructive: one atomic Noul each; policy takes the max.
  destroys_data: noul(
    "Could carrying out `task_prompt` delete or overwrite stored data (database rows, files, user content, backups)?",
    yesNo("Following the task could remove or overwrite existing data.", "The task does not remove or overwrite existing data."),
  ),
  changes_schema: noul(
    "Does `task_prompt` require changing a database schema or stored data format?",
    yesNo("Tables, columns, indexes, or a persisted data format must change.", "No schema or persisted format changes."),
  ),
  rewrites_git_history: noul(
    "Does `task_prompt` ask to rewrite git history (force-push, rebase shared branches, amend pushed commits, filter-branch)?",
    yesNo("The task rewrites commits that already exist.", "The task only adds new commits or makes no git changes."),
  ),

  underspecified: noul(
    "Is `task_prompt` missing details a senior engineer would need before starting (which file or component, expected behavior, or how to tell it is done)?",
    yesNo(
      { what: "A senior engineer would have to ask a clarifying question first.", examples: ["make it faster", "fix the bug", "clean up the code"] },
      { what: "A senior engineer could start work with what is written.", examples: ["rename getUsr to getUser in api/users.ts"] },
    ),
  ),
  needs_exploration: noul(
    "Would completing `task_prompt` require reading unfamiliar code to find where the change goes?",
    yesNo(
      "The prompt does not say where the change goes, so the agent must search the codebase first.",
      "The prompt names the file, function, or component, or the location is obvious.",
    ),
  ),
} as const;

export type QuestionId = keyof typeof QUESTIONS;
export const RISKY_IDS = ["risky_auth", "risky_payments", "risky_security", "risky_db_migration", "risky_infra"] as const;
export const DESTRUCTIVE_IDS = ["destroys_data", "changes_schema", "rewrites_git_history"] as const;
export const NOUL_IDS = [...RISKY_IDS, ...DESTRUCTIVE_IDS, "underspecified", "needs_exploration"] as const;
export type NoulId = (typeof NOUL_IDS)[number];
