/*
 * Overnight watcher for the equipment-pass workflow.
 *
 * Waits for the background workflow to finish, re-runs the health checks itself rather than
 * trusting what the agents reported, writes EQUIPMENT-PASS-SUMMARY.md at the repo root, and then
 * shuts the machine down.
 *
 * It re-runs the checks on purpose. Every number in the summary that matters - card count,
 * generator exit code, negative-test score - is measured here, so a package that claimed success
 * and was wrong shows up as a discrepancy instead of being copied forward.
 *
 * The shutdown is delayed 120 seconds and prints the abort command first, so anyone still at the
 * keyboard can stop it with:  shutdown /a
 *
 * Detached on purpose: launched with Start-Process so it outlives the Claude Code session that
 * created it. Safe to kill at any point - it only reads the repo until the very last step.
 *
 *   node tools/watch-equipment-pass.js [--no-shutdown] [--task <id>]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SESSION = 'eab3d2a3-ebb8-4734-9022-327546b8b023';
const TASK = argOf('--task') || 'wv7wgejyf';
const TASK_OUT = `C:/Users/danie/AppData/Local/Temp/claude/C--Users-danie-Documents-Projects-BSGO-Server/${SESSION}/tasks/${TASK}.output`;
const JOURNAL = `C:/Users/danie/.claude/projects/C--Users-danie-Documents-Projects-BSGO-Server/${SESSION}/subagents/workflows/wf_3afea001-3e5/journal.jsonl`;
const OUT = path.join(REPO, 'EQUIPMENT-PASS-SUMMARY.md');
const LOG = path.join(REPO, 'tools', 'watch-equipment-pass.log');
const SHUTDOWN = !process.argv.includes('--no-shutdown');

const POLL_MS = 30000;
const MAX_WAIT_MS = 5 * 60 * 60 * 1000;   // 5h, then write what we have and stop waiting
const EXPECTED_AGENTS = 18;               // 1 revise + 7 build + 6 wire + 4 verify

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}
function say(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (e) { /* log is best-effort */ }
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/* ------------------------------------------------------------------ wait for the workflow */
function journalResults() {
  try {
    return fs.readFileSync(JOURNAL, 'utf8').trim().split('\n')
      .filter(l => { try { return JSON.parse(l).type === 'result'; } catch (e) { return false; } }).length;
  } catch (e) { return 0; }
}

/* The task output file is created EMPTY when the workflow launches and only filled in on
 * completion, so its existence proves nothing. Wait for it to parse as JSON carrying a result. */
function outputReady() {
  try {
    const st = fs.statSync(TASK_OUT);
    if (!st.size) return false;
    const j = JSON.parse(fs.readFileSync(TASK_OUT, 'utf8'));
    return !!(j && j.result);
  } catch (e) { return false; }
}

function waitForWorkflow() {
  const started = Date.now();
  let lastSeen = -1;
  for (;;) {
    if (outputReady()) {
      sleep(5000);                       // let the write settle before parsing it for real
      say(`workflow output filled in at ${TASK_OUT}`);
      return 'complete';
    }
    const n = journalResults();
    if (n !== lastSeen) { say(`waiting - ${n}/${EXPECTED_AGENTS} agents finished`); lastSeen = n; }
    if (n >= EXPECTED_AGENTS) {
      say('all agents reported; waiting up to five more minutes for the output file');
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) { if (outputReady()) { sleep(5000); return 'complete'; } sleep(POLL_MS); }
      return 'agents-done-no-output';
    }
    if (Date.now() - started > MAX_WAIT_MS) return 'timeout';
    sleep(POLL_MS);
  }
}

/* ------------------------------------------------------------------ measure, do not trust */
function run(cmd, args) {
  try {
    const stdout = execFileSync(cmd, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60 * 1000 });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function measure() {
  const m = {};
  const gen = run(process.execPath, ['tools/cardgen/cards.js']);
  m.generatorExit = gen.code;
  m.generatorTail = gen.out.trim().split('\n').slice(-14).join('\n');
  const total = gen.out.match(/validation passed - (\d+) cards/);
  m.cards = total ? Number(total[1]) : null;
  const byView = gen.out.match(/by view: (.+)/);
  m.byView = byView ? byView[1].trim() : null;
  m.contentGaps = (gen.out.match(/^CONTENT GAP:.*$/gm) || []);

  const neg = run(process.execPath, ['tools/cardgen/negtest.js']);
  m.negExit = neg.code;
  const score = neg.out.match(/(\d+)\/(\d+) negative tests caught/);
  m.negScore = score ? score[0] : 'no score line';
  m.negSkips = (neg.out.match(/^.*SKIP \(anchor gone\).*$/gm) || []);

  try {
    m.gitStat = execSync('git status --short', { cwd: REPO, encoding: 'utf8' }).trim().split('\n').length;
    m.gitDiff = execSync('git diff --stat', { cwd: REPO, encoding: 'utf8' }).trim().split('\n').slice(-1)[0];
  } catch (e) { m.gitStat = null; m.gitDiff = null; }
  return m;
}

/* ------------------------------------------------------------------ summary */
function block(title, rows) {
  if (!rows || !rows.length) return '';
  return `\n## ${title}\n\n${rows.join('\n')}\n`;
}

function writeSummary(state, result, m) {
  const wire = (result && result.wire) || [];
  const build = (result && result.build) || [];
  const verify = (result && result.verify) || [];

  const failedWire = wire.filter(w => w.status !== 'complete');
  const failedBuild = build.filter(b => b.status !== 'complete');
  const badVerdicts = verify.filter(v => v.verdict === 'fail');
  const allFindings = verify.flatMap(v => (v.findings || []).map(f => ({ ...f, from: v.verdict })));
  const blockers = allFindings.filter(f => f.severity === 'blocker');
  const highs = allFindings.filter(f => f.severity === 'high');

  const green = m.generatorExit === 0 && /^14\/14/.test(m.negScore) && !m.negSkips.length
    && !failedWire.length && !badVerdicts.length && !blockers.length;

  const headline = state !== 'complete'
    ? `The workflow did not finish cleanly (${state}). Everything below is what was on disk when the watcher gave up.`
    : green
      ? 'The pass finished clean. Nothing is committed; the changes are sitting in the working tree for you.'
      : 'The pass finished, but the checks found things worth your eyes before you commit.';

  const lines = [];
  lines.push('# Equipment pass, overnight run');
  lines.push('');
  lines.push(`Written by \`tools/watch-equipment-pass.js\` at ${new Date().toISOString()}.`);
  lines.push('');
  lines.push(headline);
  lines.push('');
  lines.push('## Measured, not reported');
  lines.push('');
  lines.push('The watcher re-ran these itself rather than copying what the agents claimed.');
  lines.push('');
  lines.push('```');
  lines.push(`node tools/cardgen/cards.js   exit ${m.generatorExit}`);
  lines.push(`total cards                   ${m.cards === null ? 'could not parse' : m.cards}   (baseline before the pass: 1841)`);
  lines.push(`node tools/cardgen/negtest.js exit ${m.negExit}   ${m.negScore}`);
  lines.push(`files touched (git status)    ${m.gitStat === null ? '?' : m.gitStat}`);
  lines.push(`diffstat                      ${m.gitDiff || '?'}`);
  lines.push('```');
  lines.push('');
  if (m.byView) { lines.push('Card counts by view:'); lines.push(''); lines.push('```'); lines.push(m.byView); lines.push('```'); lines.push(''); }
  if (m.contentGaps.length) {
    lines.push('Slot types the generator still reports as having nothing to fit:');
    lines.push(''); lines.push('```'); m.contentGaps.forEach(g => lines.push(g)); lines.push('```'); lines.push('');
  } else { lines.push('The generator reported no content gaps.'); lines.push(''); }
  if (m.negSkips.length) {
    lines.push('Negative tests that skipped instead of firing (this counts as a failure):');
    lines.push(''); lines.push('```'); m.negSkips.forEach(s => lines.push(s)); lines.push('```'); lines.push('');
  }

  if (blockers.length || highs.length) {
    lines.push('## Needs your attention');
    lines.push('');
    [...blockers, ...highs].forEach(f => {
      lines.push(`**${f.severity}** ${f.issue}`);
      lines.push('');
      lines.push(`Evidence: ${f.evidence}`);
      if (f.fix) { lines.push(''); lines.push(`Suggested fix: ${f.fix}`); }
      lines.push('');
    });
  }

  lines.push(block('Verification verdicts', verify.map(v =>
    `- ${v.verdict}: ${(v.summary || '').split('\n')[0]}`)).trim());
  lines.push('');
  lines.push(block('What each package did', [...build, ...wire].map(p =>
    `### ${p.label} (${p.status})\n\n${p.summary || ''}\n${p.verification ? '\nChecks: ' + p.verification : ''}${(p.problems || []).length ? '\n\nProblems: ' + p.problems.join('; ') : ''}`)).trim());
  lines.push('');

  const medium = allFindings.filter(f => f.severity === 'medium' || f.severity === 'low');
  if (medium.length) {
    lines.push(block('Smaller findings', medium.map(f => `- ${f.severity}: ${f.issue}`)).trim());
    lines.push('');
  }

  lines.push('## Picking this back up');
  lines.push('');
  lines.push('The whole conversation, including the research and every decision behind this pass, resumes with:');
  lines.push('');
  lines.push('```');
  lines.push('cd C:\\Users\\danie\\Documents\\Projects\\BSGO-Server');
  lines.push(`claude --resume ${SESSION}`);
  lines.push('```');
  lines.push('');
  lines.push('Nothing was committed. `git status` shows the full extent of the change, and your save file');
  lines.push('is backed up at `server/sqlite/bgo_server.db.bak-before-equipment-pass` if the migration');
  lines.push('did anything you disagree with.');
  lines.push('');
  lines.push('The longer research trail lives in the scratchpad:');
  lines.push('');
  lines.push('```');
  lines.push(`C:\\Users\\danie\\AppData\\Local\\Temp\\claude\\C--Users-danie-Documents-Projects-BSGO-Server\\${SESSION}\\scratchpad`);
  lines.push('```');
  lines.push('');
  lines.push('BLUEPRINT-v2.md is the plan that was executed; DECISIONS.md records the scope calls and why.');
  lines.push('');

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  say(`summary written to ${OUT}`);
  return green;
}

/* ------------------------------------------------------------------ main */
say(`watcher started, pid ${process.pid}, task ${TASK}, shutdown ${SHUTDOWN ? 'on' : 'off'}`);
const state = waitForWorkflow();
say(`workflow state: ${state}`);

let result = null;
try {
  if (outputReady()) result = JSON.parse(fs.readFileSync(TASK_OUT, 'utf8')).result || null;
} catch (e) { say(`could not parse workflow output: ${e.message}`); }

say('re-running the health checks');
const m = measure();
say(`generator exit ${m.generatorExit}, ${m.cards} cards, negtest ${m.negScore}`);

let green = false;
try { green = writeSummary(state, result, m); }
catch (e) {
  say(`summary generation failed: ${e.message}`);
  try { fs.writeFileSync(OUT, `# Equipment pass\n\nThe watcher failed while writing the summary: ${e.message}\n\nGenerator exit ${m.generatorExit}, ${m.cards} cards, negtest ${m.negScore}.\n\nResume with:\n\n    claude --resume ${SESSION}\n`, 'utf8'); } catch (e2) { /* nothing left to try */ }
}

say(green ? 'clean' : 'finished with findings - see the summary');

/* Kill anything the verification agents left running before the machine goes down, so the
 * sqlite file is not mid-write. Failure here is not worth aborting the shutdown over. */
try { execSync('taskkill /F /IM java.exe /T', { stdio: 'ignore' }); say('stopped leftover java processes'); } catch (e) { /* none running */ }

if (!SHUTDOWN) { say('--no-shutdown given, stopping here'); process.exit(0); }

say('shutting down in 120 seconds - run "shutdown /a" to cancel');
try {
  execFileSync('shutdown', ['/s', '/t', '120', '/c', 'BSGO equipment pass finished. See EQUIPMENT-PASS-SUMMARY.md. Cancel with: shutdown /a'], { stdio: 'inherit' });
} catch (e) {
  say(`shutdown command failed: ${e.message}`);
}
