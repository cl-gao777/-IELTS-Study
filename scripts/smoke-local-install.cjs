/* eslint-disable @typescript-eslint/no-require-imports -- Node release verification, no TypeScript runtime needed. */
// Run after npm run build. Only disposable temporary data is created.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'ielts-install-smoke-'));
const uploads = path.join(scratch, 'uploads');
mkdirSync(uploads);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let processHandle;
let output = '';
let succeeded = false;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function launch(port) {
  output = '';
  processHandle = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root, windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', DATABASE_URL: `file:${path.join(scratch, 'ists.db')}`,
      UPLOAD_DIR: uploads, VOCABULARY_PRIVATE_CATALOG_PATH: path.join(scratch, 'absent-private-catalog.json'),
      ISTS_BASIC_AUTH_USER: '', ISTS_BASIC_AUTH_PASSWORD: '', AI_PROVIDERS_JSON: '', AI_API_KEY: '', NOTION_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processHandle.on('error', (error) => { output += error.message; });
  for (const stream of [processHandle.stdout, processHandle.stderr]) stream.on('data', (chunk) => { output = (output + chunk.toString()).slice(-16000); });
  for (let i = 0; i < 180; i++) {
    if (processHandle.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok && (await response.json()).instanceRoot === root) return;
    } catch { /* wait until this process is ready */ }
    await delay(500);
  }
  throw new Error(`Server did not become ready: ${output}`);
}
async function stop() {
  const child = processHandle;
  if (!child || child.exitCode !== null) return;
  const closed = new Promise((resolve) => child.once('close', resolve));
  child.kill();
  await Promise.race([closed, delay(5000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await closed; }
}

async function main() {
  assert(existsSync(path.join(root, '.next/BUILD_ID')), 'Run npm run build first.');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  async function json(route, options) {
    const response = await fetch(base + route, { ...options, signal: AbortSignal.timeout(60000) });
    const body = await response.json();
    assert(response.ok, `${route}: ${response.status} ${JSON.stringify(body)}`);
    return body;
  }
  const put = (body) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const post = (body) => ({ ...put(body), method: 'POST' });
  async function rejects(route, body, status, method = 'PUT') {
    const response = await fetch(base + route, { ...put(body), method });
    assert.equal(response.status, status, `${route}: expected ${status}, got ${response.status} ${await response.text()}`);
  }
  await launch(port);
  for (const route of ['/', '/vocabulary', '/morphology', '/practice/reading', '/practice/listening', '/writing', '/analytics', '/settings']) {
    const response = await fetch(base + route, { signal: AbortSignal.timeout(60000) });
    assert(response.ok, `${route}: ${response.status}`);
    assert((await response.text()).includes('<html'), `${route}: expected rendered HTML`);
  }
  const courses = await json('/api/vocabulary/courses');
  assert.equal(courses.courses.length, 2);
  assert.equal(courses.courses.find((course) => course.id === 'general').ready, 2809);
  assert.equal(courses.courses.find((course) => course.id === 'academic').ready, 957);
  const study = await json('/api/vocabulary/study');
  assert.equal(study.activeCourseId, 'academic');
  assert.equal(study.focus, 'general');
  assert.equal(study.privateCatalogKey, undefined);
  let round = await json('/api/vocabulary/session', put({ action: 'start', id: randomUUID(), mode: 'context', restoreVersion: study.restoreVersion }));
  round = await json('/api/vocabulary/session', put({ action: 'next', id: round.session.id, expectedRevision: round.session.revision }));
  assert(round.session.state.current, 'Fresh public installation must offer a learning card without private files.');
  // The original eight personal starter cards legitimately precede new course
  // cards. Defer them without learning or grading to verify the public course.
  round = await json('/api/vocabulary/session', put({ action: 'checkpoint', id: round.session.id, expectedRevision: round.session.revision,
    state: { mode: 'context', current: null, skippedIds: round.words.map((word) => word.id) } }));
  round = await json('/api/vocabulary/session', put({ action: 'next', id: round.session.id, expectedRevision: round.session.revision }));
  const cue = round.session.state.current;
  assert(cue?.exercise?.sentence && cue.exercise.acceptedAnswers.length, 'Public course must supply a fixed usable context.');
  assert.equal(cue.exercise.courseId, 'academic');
  const form = new FormData();
  form.append('kind', 'reading');
  form.append('title', 'Original release verification');
  form.append('file', new Blob([readFileSync(path.join(root, 'src/server/fixtures/original-import.pdf'))], { type: 'application/pdf' }), 'original-import.pdf');
  const imported = await json('/api/materials/file', { method: 'POST', body: form });
  assert(imported.material.id, 'Original PDF import must produce a material.');
  const epoch = (await json('/api/data-state')).dataEpoch;
  const practiceRoute = '/api/practice/workspace/reading-urban-cooling';
  let workspace = await json(practiceRoute);
  workspace = await json(practiceRoute, put({ dataEpoch: epoch, expectedRevision: workspace.revision, runId: workspace.runId,
    draft: { ...workspace.draft, notes: 'Durability fixture', answers: {} }, annotations: [] }));
  const practiceRequest = { dataEpoch: epoch, runId: workspace.runId, submissionId: workspace.submissionId, setId: 'reading-urban-cooling', answers: {}, durationSeconds: 5 };
  const firstAttempt = await json('/api/practice/attempts', post(practiceRequest));
  assert.deepEqual(await json('/api/practice/attempts', post(practiceRequest)), firstAttempt);
  await rejects('/api/practice/attempts', { ...practiceRequest, durationSeconds: 6 }, 409, 'POST');
  const completedWorkspace = await json(practiceRoute);
  const nextWorkspace = await json(practiceRoute, put({ dataEpoch: epoch, expectedRevision: completedWorkspace.revision, runId: completedWorkspace.runId,
    restart: true, draft: { ...completedWorkspace.draft, answers: {}, elapsed: 0, isRetry: true }, annotations: completedWorkspace.annotations }));
  assert.notEqual(nextWorkspace.runId, workspace.runId);
  assert.deepEqual(await json('/api/practice/attempts', post(practiceRequest)), firstAttempt, 'An old completed round must still return its original receipt after explicit retry.');
  await rejects('/api/practice/attempts', { ...practiceRequest, durationSeconds: 6 }, 409, 'POST');
  assert.equal((await json(`/api/submissions/${workspace.submissionId}?dataEpoch=${epoch}`)).status, 'completed');
  const writingId = randomUUID();
  const writingRequest = { id: writingId, groupId: writingId, version: 1, taskType: 'task-2', category: 'Opinion', prompt: 'Discuss local public transport.',
    image: '', essay: 'This is a saved original essay used only for isolated release verification.', elapsedSeconds: 5, timeLimitMinutes: 40, status: 'draft', updatedAt: new Date().toISOString(), dataEpoch: epoch, expectedRevision: 0 };
  const writing = (await json('/api/writing/drafts', put(writingRequest))).draft;
  await rejects('/api/writing/drafts', writingRequest, 409);
  const segment = { id: randomUUID(), seconds: 5, cumulative: true };
  const timeBefore = await json('/api/vocabulary/study');
  await json('/api/vocabulary/study', put({ restoreVersion: timeBefore.restoreVersion, heartbeat: segment }));
  const timeAfter = await json('/api/vocabulary/study', put({ restoreVersion: timeBefore.restoreVersion, heartbeat: segment }));
  assert.equal(timeAfter.todaySeconds - timeBefore.todaySeconds, 5, 'Replayed 5 seconds must remain 5 seconds.');
  let exam = (await json('/api/mock-exam/session', put({ action: 'start', dataEpoch: epoch, listeningSetId: 'listening-campus-project', readingSetId: 'reading-urban-cooling' }))).session;
  const writer = randomUUID();
  exam = (await json('/api/mock-exam/session', put({ action: 'claim', id: exam.id, dataEpoch: epoch, writerId: writer }))).session;
  await rejects('/api/mock-exam/session', { action: 'claim', id: exam.id, dataEpoch: epoch, writerId: randomUUID() }, 409);
  async function checkpoint(state, release = false) {
    exam = (await json('/api/mock-exam/session', put({ action: 'checkpoint', id: exam.id, dataEpoch: exam.dataEpoch, writerId: writer, expectedRevision: exam.revision, state, release }))).session;
  }
  assert(exam.listeningSet.questions.every((q) => q.answers.length === 0 && !q.explanation), 'Mock must not reveal keys.');
  await checkpoint({ ...exam.state, paused: false, listeningAnswers: { [exam.listeningSet.questions[0].id]: 'Original wrong answer' }, durations: { listening: 5, reading: 0, writing: 0 } });
  await checkpoint({ ...exam.state, stage: 'reading' });
  await checkpoint({ ...exam.state, readingAnswers: { [exam.readingSet.questions[0].id]: 'Original wrong answer' }, positions: { 'reading:source': 120 }, zooms: { reading: 125 } });
  await checkpoint({ ...exam.state, stage: 'writing', essay: writingRequest.essay }, true);
  const morphology = await json('/api/morphology/courses');
  assert.equal(morphology.courses.length, 160);
  for (const [kind, count] of [['root', 80], ['prefix', 40], ['suffix', 40]]) assert.equal(morphology.courses.filter(course => course.kind === kind).length, count);
  const lesson = (await json('/api/morphology/courses?lessonId=' + encodeURIComponent(morphology.courses[0].id))).lesson;
  let morphologyRound = (await json('/api/morphology/session', put({ action: 'start', dataEpoch: epoch, operationId: randomUUID(), lessonId: lesson.id, lessonVersion: lesson.version }))).session;
  morphologyRound = (await json('/api/morphology/session', put({ action: 'practice', dataEpoch: epoch, sessionId: morphologyRound.id, expectedRevision: morphologyRound.revision }))).session;
  const rootQuestion = morphologyRound.state.questions[0];
  assert.equal(rootQuestion.options.length, 4);
  const rootAnswer = { dataEpoch: epoch, sessionId: morphologyRound.id, expectedRevision: morphologyRound.revision, operationId: randomUUID(), questionId: rootQuestion.id, lessonVersion: lesson.version, answer: rootQuestion.acceptedAnswers[0], gaveUp: false };
  morphologyRound = (await json('/api/morphology/attempts', post(rootAnswer))).session;
  assert.deepEqual((await json('/api/morphology/attempts', post(rootAnswer))).session, morphologyRound);
  await rejects('/api/morphology/attempts', { ...rootAnswer, answer: 'Changed original answer' }, 409, 'POST');
  morphologyRound = (await json('/api/morphology/session', put({ action: 'next', dataEpoch: epoch, sessionId: morphologyRound.id, expectedRevision: morphologyRound.revision }))).session;
  morphologyRound = (await json('/api/morphology/session', put({ action: 'save', dataEpoch: epoch, sessionId: morphologyRound.id, expectedRevision: morphologyRound.revision, input: 'Frozen unsubmitted input' }))).session;
  morphologyRound = (await json('/api/morphology/session', put({ action: 'pause', dataEpoch: epoch, sessionId: morphologyRound.id, expectedRevision: morphologyRound.revision }))).session;
  const rootClock = { dataEpoch: epoch, sessionId: morphologyRound.id, segmentId: randomUUID(), seconds: 5, studyDate: new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIME_ZONE || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) };
  await json('/api/morphology/study', post(rootClock));
  assert.equal((await json('/api/morphology/study', post(rootClock))).totalSeconds, 5);
  assert.equal((await json('/api/vocabulary/study')).todaySeconds, timeAfter.todaySeconds, 'Morphology must not advance the vocabulary time goal.');
  const backup = await json('/api/backup');
  assert.equal(backup.version, 6);
  assert.equal(backup.files.length, 1);
  assert.equal(backup.data.morphology_attempts.length, 1);
  assert.equal(backup.data.vocabulary_reviews.length, 0, 'Morphology answers must not produce a vocabulary grade.');
  await stop();
  await launch(port);
  const recovered = await json('/api/vocabulary/session');
  assert.equal(recovered.session.id, round.session.id);
  assert.deepEqual(recovered.session.state.current, cue, 'Restart must preserve the exact issued card.');
  assert.deepEqual((await json('/api/morphology/session')).session, morphologyRound, 'Restart must preserve root questions, order, answers and paused input.');
  const recoveredBackup = await json('/api/backup');
  assert.equal(recoveredBackup.files[0].sha256, backup.files[0].sha256);
  const resumed = (await json('/api/mock-exam/session')).session;
  assert.deepEqual(resumed.state, exam.state, 'Restart must preserve paused exam, phase, essay, clocks and material position.');
  exam = (await json('/api/mock-exam/session', put({ action: 'claim', id: exam.id, dataEpoch: epoch, writerId: writer }))).session;
  const mockRequest = { sessionId: exam.id, submissionId: exam.submissionId, dataEpoch: epoch, writerId: writer };
  const completed = await json('/api/mock-exam', post(mockRequest));
  assert.equal(completed.provider, 'local-fallback'); assert.equal(completed.writing.id, 0);
  assert.deepEqual(await json('/api/mock-exam', post(mockRequest)), completed);
  await rejects('/api/mock-exam', { ...mockRequest, sessionId: randomUUID() }, 409, 'POST');
  const graded = await json('/api/backup');
  assert.equal(graded.data.mock_exams.length, 1);
  assert.equal(graded.data.practice_attempts.length, backup.data.practice_attempts.length + 2);
  assert.equal(graded.data.writing_submissions.length, 0, 'Unavailable AI must not create a fake band score.');
  const completedSession = (await json('/api/mock-exam/session')).session;
  await json('/api/mock-exam/session', put({ action: 'end', id: exam.id, dataEpoch: epoch, expectedRevision: completedSession.revision }));
  await json('/api/backup'); // Ended completed sessions retain valid immutable receipts.
  await json('/api/backup', post({ confirm: 'RESTORE', backup }));
  const newEpoch = (await json('/api/data-state')).dataEpoch;
  assert.notEqual(newEpoch, epoch);
  await rejects(practiceRoute, { dataEpoch: epoch, expectedRevision: workspace.revision, runId: workspace.runId, draft: workspace.draft, annotations: [] }, 409);
  await rejects('/api/practice/attempts', practiceRequest, 409, 'POST');
  await rejects('/api/writing/drafts', { ...writingRequest, expectedRevision: writing.revision }, 409);
  await rejects('/api/writing/evaluate', { ...writingRequest, expectedRevision: writing.revision }, 409, 'POST');
  await rejects('/api/mock-exam/session', { action: 'claim', id: exam.id, dataEpoch: epoch, writerId: writer }, 409);
  await rejects('/api/mock-exam', mockRequest, 409, 'POST');
  await rejects('/api/morphology/attempts', rootAnswer, 409, 'POST');
  await rejects('/api/morphology/session', { action: 'save', dataEpoch: epoch, sessionId: morphologyRound.id, expectedRevision: morphologyRound.revision, input: 'Stale overwrite' }, 409);
  const restored = await json('/api/backup');
  assert.deepEqual(restored.data.practice_attempts, backup.data.practice_attempts);
  assert.equal(restored.data.mock_exam_sessions[0].writer_id, null);
  assert.equal(JSON.parse(restored.data.mock_exam_sessions[0].state_json).paused, true);
  const restoredRoot = (await json('/api/morphology/session')).session;
  assert.equal(restoredRoot.state.input, 'Frozen unsubmitted input');
  assert.equal(restoredRoot.state.paused, true);
  assert(restoredRoot.revision > morphologyRound.revision);
  assert.deepEqual(restored.data.morphology_attempts, backup.data.morphology_attempts);
  const invalidBackup = structuredClone(restored); invalidBackup.files[0].sha256 = '0'.repeat(64);
  await rejects('/api/backup', { confirm: 'RESTORE', backup: invalidBackup }, 400, 'POST');
  assert.equal((await json('/api/data-state')).dataEpoch, newEpoch);
  console.log(JSON.stringify({ passed: true, pages: 8, publicWords: 3766, contexts: 7532, morphologyLessons: 160, morphologyRestored: true, backupVersion: 6, pdfImport: true, cardRestoredAfterRestart: true,
    examRestoredAfterRestart: true, idempotentSubmissions: true, oldRoundRetry: true, oldPagesBlocked: true, duplicateTimeSeconds: 5, unavailableAIUnassessed: true }));
  succeeded = true;
}

main().catch((error) => { console.error(error.message); console.error(`Temporary diagnostic data: ${scratch}`); process.exitCode = 1; }).finally(async () => {
  await stop();
  // Only remove the fresh, exact mkdtemp directory owned by this invocation.
  if (succeeded) rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});
