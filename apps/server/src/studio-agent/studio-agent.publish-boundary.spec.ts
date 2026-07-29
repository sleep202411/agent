import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * THE INVARIANT, IN ONE SENTENCE:
 *
 *   The Nest server never publishes to a Studio Agent channel — the Temporal
 *   activity worker is the only publisher, from inside the run it owns — and
 *   Nest never publishes to a Studio Agent channel. Conversations owns its
 *   separate Ably REST publisher; the two channel families must not cross.
 *
 * This file replaces the boundary test the Postgres relay used to need. The
 * relay's invariant ("exactly one module may call `.publish(`, exactly one may
 * write `published_at`") is gone with the relay, but the failure mode it
 * existed to prevent did not go away — it got sharper. The worker now streams
 * an assistant answer onto the channel while the control plane's own record of
 * that turn is still being written, so "the agent said it happened and it did
 * not" is now a race between two processes rather than two forgotten lines. A
 * second publisher in Nest would make that race unresolvable: nothing would
 * order Nest's message against the worker's, and `AgentSession` has no notion
 * of a participant who publishes without holding a run.
 *
 * WHY IT SCANS THE WHOLE SERVER NOW. It used to scan `__dirname` — this one
 * directory. That is precisely the wrong scope for the mistake it guards
 * against, because the tempting place to add a second publisher is NOT here.
 * It is in the module that already has the fact and no way to tell the browser:
 * a quota service, a notifications gateway, a webhook handler. Any of those
 * could have imported the Ably SDK and this test would have stayed green. Two
 * of the three rules below now walk `apps/server/src` in full.
 *
 * The relay rule stays directory-scoped, deliberately: `publishedAt` is an
 * ordinary and correct column name elsewhere in this server (creator services,
 * story releases, IP commerce all have one), so a repo-wide ban on the word
 * would be a false positive factory. Inside studio-agent it means exactly one
 * thing — the watermark of the deleted relay — and there it stays banned.
 *
 * It is a source-text test on purpose. There is no runtime moment at which
 * "this module imported Ably" is observable, and the mistake it guards against
 * is one line added by someone solving a real problem the honest way — pushing
 * a fact the browser needs onto the pipe that is already open.
 *
 * WHAT TO DO INSTEAD, when you find yourself wanting to publish. Facts that
 * originate in Nest outside a run — quota, entitlement, permission policy, an
 * approval decision — are CONTROL PLANE. Postgres is authoritative for them and
 * the browser learns them over HTTP: refetch the thread snapshot, or invalidate
 * the query that holds them. The channel carries the conversation; Postgres
 * carries the control plane; neither becomes a second source of truth for the
 * same fact.
 */

const MODULE_DIR = __dirname;
/** Every server source file, not just this feature's. */
const SERVER_SRC_DIR = join(__dirname, '..');

/** Modules intentionally allowed to own an Ably root credential. */
const ABLY_OWNER = join('studio-agent', 'studio-agent.realtime.ts');
const CONVERSATION_ABLY_OWNER = join(
  'conversations',
  'conversation-realtime.service.ts',
);

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
        continue;
      }
      found.push(relative(root, path));
    }
  };
  walk(root);
  return found.sort();
}

/**
 * The module's CODE, with comments removed.
 *
 * Comments are where this boundary gets explained, so they are full of the very
 * strings being searched for — `ABLY_API_KEY`, the channel prefix, the name of
 * the relay that was deleted. Scanning them would make the test impossible to
 * satisfy without also making the code impossible to understand, so the
 * explanation is stripped and the instructions are what is measured.
 */
function read(root: string, name: string): string {
  return readFileSync(join(root, name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

describe('Studio Agent publish boundary', () => {
  it('scans the whole server, not one directory', () => {
    const all = sourceFiles(SERVER_SRC_DIR);

    // A guard on the guard. If this ever collapses back to one feature's worth
    // of files, every assertion below silently stops covering the places a
    // second publisher would actually be written.
    expect(all.length).toBeGreaterThan(200);
    expect(new Set(all.map((name) => name.split(sep)[0])).size).toBeGreaterThan(
      10,
    );
    expect(all).toContain(ABLY_OWNER);
  });

  it('keeps Ably imports in the two named transport owners', () => {
    const importers = sourceFiles(SERVER_SRC_DIR).filter((name) =>
      /from\s+'ably'|require\('ably'\)|from\s+'@ably\//.test(
        read(SERVER_SRC_DIR, name),
      ),
    );

    expect(importers).toEqual([CONVERSATION_ABLY_OWNER, ABLY_OWNER].sort());
  });

  it('never publishes Studio Agent runs from the server', () => {
    // `createAgentSession` / `AgentRun.pipe` / `RunStep.send` are the library's
    // publish verbs. None of them belongs in a process that holds no run.
    const offenders = sourceFiles(SERVER_SRC_DIR).filter((name) =>
      /createAgentSession|createClientSession|\.adoptRun\(|new Ably\.Realtime\b/.test(
        read(SERVER_SRC_DIR, name),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('keeps the Ably owner to token signing: Rest, never Realtime', () => {
    // `Ably.Rest` cannot hold a connection, so this is a structural guarantee
    // rather than a habit — and on the free plan the account's 200 concurrent
    // connections belong to the worker's publishing sessions, not to a socket
    // per Nest replica held open for nothing.
    const owner = read(SERVER_SRC_DIR, ABLY_OWNER);

    expect(owner).toContain('new Ably.Rest(');
    expect(owner).not.toContain('new Ably.Realtime(');
    expect(owner).not.toMatch(/\.publish\(/);
  });

  it('holds no relay: no watermark, no wake, no publisher port', () => {
    // The hand-rolled delivery layer was DELETED, not disabled. If any of these
    // names comes back, someone is rebuilding the pipe the library replaced.
    // Directory-scoped: `publishedAt` is a legitimate column elsewhere.
    const offenders = sourceFiles(MODULE_DIR).filter((name) =>
      /publishedAt|published_at|EventRelay|STUDIO_AGENT_EVENT_PUBLISHER|relay\.wake\(/.test(
        read(MODULE_DIR, name),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('derives every channel name from the one shared helper', () => {
    // Three spellings of `studio-agent:thread:<id>` is how a token gets signed
    // for a channel nobody publishes to. The literal prefix may appear only in
    // the shared transport contract, which is not in this server at all — so
    // this one is server-wide too.
    const offenders = sourceFiles(SERVER_SRC_DIR).filter((name) =>
      read(SERVER_SRC_DIR, name).includes('studio-agent:thread:'),
    );

    expect(offenders).toEqual([]);
  });

  it('keeps the root credential inside the named transport owners and config', () => {
    const offenders = sourceFiles(SERVER_SRC_DIR).filter(
      (name) =>
        name !== ABLY_OWNER &&
        name !== CONVERSATION_ABLY_OWNER &&
        name !== join('studio-agent', 'studio-agent.config.ts') &&
        /ABLY_API_KEY|ably\.apiKey/.test(read(SERVER_SRC_DIR, name)),
    );

    // Config parses it; the two transport owners use it. Nobody else sees it.
    expect(offenders).toEqual([]);
  });
});
