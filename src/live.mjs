import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { appendContinuityEvent } from './events.mjs';
import { AhpError, invariant } from './errors.mjs';
import { runGit } from './git.mjs';
import { doctor, status } from './context.mjs';
import { repository } from './state.mjs';
import { verifyRepository } from './validation.mjs';

const PROVIDERS = new Set(['codex', 'claude']);

function bounded(value, limit = 16000) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}\n[truncated by AHP+]` : text;
}

function providerCommand(target) {
  if (target === 'codex') return process.env.AHP_CODEX_COMMAND || 'codex';
  if (target === 'claude') {
    if (process.env.AHP_CLAUDE_COMMAND) return process.env.AHP_CLAUDE_COMMAND;
    const candidates = [
      path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ];
    if (process.platform === 'darwin') {
      const vmRoot = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-vm');
      if (fs.existsSync(vmRoot)) {
        candidates.push(...fs.readdirSync(vmRoot).sort().reverse().map((version) => path.join(vmRoot, version, 'claude')));
      }
    }
    return candidates.find((candidate) => {
      try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; }
    }) || 'claude';
  }
  return target;
}

function commandAvailable(command) {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 3000,
  });
  return {
    available: result.status === 0,
    command,
    version: result.status === 0 ? bounded(result.stdout || result.stderr, 500) : null,
    error: result.status === 0 ? null : bounded(result.error?.message || result.stderr || 'command unavailable', 500),
  };
}

export function liveStatus(input = '.') {
  const repo = repository(input);
  return {
    ok: true,
    status: 'LIVE_BRIDGE_AVAILABLE',
    project_id: repo.manifest.project_id,
    mode: 'bounded-consultation',
    default_authority: 'read-only',
    max_hops: 1,
    providers: {
      codex: commandAvailable(providerCommand('codex')),
      claude: commandAvailable(providerCommand('claude')),
    },
  };
}

function consultationPrompt(repo, question, origin, target) {
  const changed = repo.git.project_changed_files.map((item) => `${item.code} ${item.path}`).join('\n') || '(clean)';
  const diffStat = runGit(repo.repoRoot, ['diff', '--stat', 'HEAD'], '') || '(no tracked diff)';
  return [
    'You are answering one bounded AHP+ consultation from another AI platform.',
    'Operate read-only. Do not edit files, run network mutations, commit, push, publish, deploy, or start another consultation.',
    'Inspect the repository when useful and answer only the question. Clearly separate verified observations from inference.',
    `Origin: ${origin}`,
    `Target: ${target}`,
    `Project: ${repo.manifest.project_id}`,
    `Git branch: ${repo.git.branch || 'unknown'}`,
    `Git commit: ${repo.git.commit || 'unknown'}`,
    `Working tree: ${repo.git.project_working_tree}`,
    `Changed files:\n${bounded(changed, 4000)}`,
    `Diff stat:\n${bounded(diffStat, 4000)}`,
    `Question:\n${question}`,
  ].join('\n\n');
}

function invokeClaude(repo, prompt, options = {}) {
  const command = providerCommand('claude');
  const timeout = Number(options.timeout || 120) * 1000;
  return new Promise((resolve, reject) => {
    const budget = Number(options['max-budget-usd'] || 1);
    invariant(Number.isFinite(budget) && budget > 0 && budget <= 20, '--max-budget-usd must be greater than 0 and no more than 20', { code: 'INVALID_ARGUMENT' });
    const args = [
      '--print',
      '--output-format', 'json',
      '--permission-mode', 'plan',
      '--tools', 'Read,Glob,Grep',
      '--no-session-persistence',
      '--max-budget-usd', String(budget),
      ...(options.model ? ['--model', String(options.model)] : []),
      prompt,
    ];
    const child = execFile(command, args, {
      cwd: repo.repoRoot,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout,
    }, (error, stdout, stderr) => {
      if (error) {
        let diagnostic = stderr;
        try {
          const parsed = JSON.parse(stdout);
          diagnostic = parsed.result || parsed.error || parsed.subtype || stdout;
        } catch {
          diagnostic ||= stdout;
        }
        reject(new Error(`Claude CLI exited ${error.code || error.signal || 'non-zero'}: ${bounded(diagnostic || error.message, 2000)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve({ text: bounded(parsed.result || parsed.response || stdout), session_id: parsed.session_id || null });
      } catch {
        resolve({ text: bounded(stdout), session_id: null });
      }
    });
    child.stdin?.end();
  });
}

function invokeCodex(repo, prompt, options = {}) {
  const command = providerCommand('codex');
  const timeoutMs = Number(options.timeout || 120) * 1000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['app-server'], {
      cwd: repo.repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = readline.createInterface({ input: child.stdout });
    let stderr = '';
    let threadId = null;
    let streamed = '';
    let completed = '';
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      if (!child.killed) child.kill();
      if (error) reject(error);
      else resolve(value);
    };
    const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
    const timer = setTimeout(() => finish(new Error(`Codex consultation timed out after ${timeoutMs} ms`)), timeoutMs);

    child.stderr.on('data', (chunk) => { stderr = bounded(`${stderr}${chunk}`, 4000); });
    child.on('error', (error) => finish(new Error(`Cannot start Codex app-server: ${error.message}`)));
    child.on('exit', (code) => {
      if (!settled) finish(new Error(`Codex app-server exited ${code}: ${stderr || 'no diagnostic output'}`));
    });
    lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id === 0 && message.result) {
        send({ method: 'initialized', params: {} });
        send({
          method: 'thread/start',
          id: 1,
          params: { cwd: repo.repoRoot, approvalPolicy: 'never', serviceName: 'ahp_live_bridge' },
        });
      }
      if (message.id === 1 && message.result?.thread?.id) {
        threadId = message.result.thread.id;
        send({
          method: 'turn/start',
          id: 2,
          params: {
            threadId,
            input: [{ type: 'text', text: prompt }],
            cwd: repo.repoRoot,
            approvalPolicy: 'never',
            sandboxPolicy: { type: 'readOnly', access: { type: 'fullAccess' } },
            summary: 'concise',
          },
        });
      }
      if (message.method === 'item/agentMessage/delta') streamed += message.params?.delta || '';
      if (message.method === 'item/completed' && message.params?.item?.type === 'agentMessage') {
        completed = message.params.item.text || completed;
      }
      if (message.method === 'turn/completed') {
        const state = message.params?.turn?.status;
        if (state !== 'completed') {
          finish(new Error(`Codex consultation ended with ${state || 'unknown'} status`));
          return;
        }
        const text = bounded(completed || streamed);
        if (!text) finish(new Error('Codex consultation completed without an agent message'));
        else finish(null, { text, session_id: threadId });
      }
      if (message.error && [1, 2].includes(message.id)) {
        finish(new Error(`Codex app-server error: ${message.error.message || JSON.stringify(message.error)}`));
      }
    });

    send({
      method: 'initialize',
      id: 0,
      params: { clientInfo: { name: 'ahp_live_bridge', title: 'AHP+ Live Bridge', version: '1.0.0' } },
    });
  });
}

async function invokeProvider(target, repo, prompt, options) {
  if (typeof options.invoke === 'function') return options.invoke({ target, repo, prompt });
  return target === 'codex' ? invokeCodex(repo, prompt, options) : invokeClaude(repo, prompt, options);
}

export async function consultAgent(input = '.', options = {}) {
  const target = String(options.target || options.to || '').toLowerCase();
  invariant(PROVIDERS.has(target), '--to must be codex or claude for a live consultation', {
    code: 'INVALID_PROVIDER', details: { supported: [...PROVIDERS] },
  });
  const question = bounded(options.question || options.text || '', 12000);
  invariant(question, 'A consultation question is required', { code: 'INVALID_ARGUMENT' });
  const origin = String(options.from || 'current-agent').toLowerCase();
  invariant(origin !== target, 'Consultation origin and target must be different', { code: 'INVALID_ARGUMENT' });
  const repo = repository(input);
  const consultTypes = repo.manifest.protocol_version === '1.4.0'
    ? { request: 'CONSULT_REQUEST', response: 'CONSULT_RESPONSE' }
    : { request: 'MESSAGE', response: 'MESSAGE' };
  const correlation = String(options.correlation || `consult-${crypto.randomUUID()}`);
  const session = String(options.session || correlation);
  const request = appendContinuityEvent(repo.repoRoot, {
    type: consultTypes.request,
    summary: question,
    session,
    correlation,
    from: origin,
    to: target,
    actor: origin,
    platform: origin,
    model: 'unknown',
    capabilities: 'consult-request,read-only,max-hops-1',
    requested: 'Produce one read-only consultation response',
    authority: 'READ_ONLY',
    status: 'REQUESTED',
    limitations: 'One response only|No delegated consultation|No project mutation authority',
    'next-action': `Await one response from ${target}`,
  });
  const prompt = consultationPrompt(repo, question, origin, target);
  const started = Date.now();
  let result;
  try {
    result = await invokeProvider(target, repo, prompt, options);
  } catch (error) {
    const failure = appendContinuityEvent(repo.repoRoot, {
      type: 'ERROR',
      summary: bounded(error.message, 4000),
      session,
      correlation,
      parent: request.id,
      from: target,
      to: origin,
      actor: target,
      platform: target,
      model: 'unknown',
      capabilities: 'consult-failure,read-only,max-hops-1',
      requested: 'Record the failed bounded consultation without claiming delivery',
      authority: 'READ_ONLY',
      status: 'REJECTED',
      provider: `live-${target}`,
      limitations: 'No provider response was received|No project mutation authority',
      'next-action': 'Inspect provider availability and retry only if authorized',
    });
    throw new AhpError(`${target} consultation failed: ${error.message}`, {
      code: 'PROVIDER_CONSULTATION_FAILED', exitCode: 3,
      details: { request_event_id: request.id, failure_event_id: failure.id },
    });
  }
  const answer = bounded(result.text, 16000);
  invariant(answer, `${target} returned an empty consultation`, { code: 'EMPTY_PROVIDER_RESPONSE' });
  const response = appendContinuityEvent(repo.repoRoot, {
    type: consultTypes.response,
    summary: answer,
    session,
    correlation,
    parent: request.id,
    from: target,
    to: origin,
    actor: target,
    platform: target,
    model: 'unknown',
    capabilities: 'consult-response,read-only,max-hops-1',
    requested: 'Return the bounded consultation result to the requesting chat',
    authority: 'READ_ONLY',
    status: 'NOT_APPLICABLE',
    provider: `live-${target}`,
    limitations: 'Provider identity is platform-declared|No project mutation authority',
    'next-action': 'Present this consultation to the human in the originating chat',
  });
  return {
    ok: true,
    status: 'CONSULTED',
    project_id: repo.manifest.project_id,
    from: origin,
    to: target,
    mode: 'read-only',
    hop_limit: 1,
    request: { event_id: request.id, fingerprint: request.fingerprint },
    response: { event_id: response.id, fingerprint: response.fingerprint, text: answer },
    provider_session_id: result.session_id || null,
    requested_target_model: options.model || null,
    elapsed_ms: Date.now() - started,
  };
}

function mcpResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolsList() {
  return [
    {
      name: 'ahp_project_check',
      description: 'Run AHP+ doctor and strict verification for the current project.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'ahp_consult',
      description: 'Ask Codex or Claude for one bounded read-only opinion and return it to this chat.',
      inputSchema: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['codex', 'claude'] },
          question: { type: 'string', minLength: 1 },
          from: { type: 'string' },
          model: { type: 'string', minLength: 1 },
          timeout: { type: 'integer', minimum: 1, maximum: 1800 },
          max_budget_usd: { type: 'number', exclusiveMinimum: 0, maximum: 20 },
        },
        required: ['target', 'question'],
        additionalProperties: false,
      },
    },
  ];
}

export async function handleMcpRequest(input, message, options = {}) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: message.params?.protocolVersion || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'ahp-live-bridge', version: '1.0.0' },
      instructions: 'AHP+ consultations are bounded, read-only, human-visible, and limited to one response. Never claim delivery without returned evidence.',
    };
  }
  if (message.method === 'ping') return {};
  if (message.method === 'tools/list') return { tools: toolsList() };
  if (message.method === 'tools/call') {
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    if (name === 'ahp_project_check') {
      const diagnostic = doctor(input);
      const verification = verifyRepository(input, { strict: true });
      return mcpResult({ ok: diagnostic.ok && verification.ok, doctor: diagnostic.ok, strict_verification: verification.ok, status: status(input) });
    }
    if (name === 'ahp_consult') {
      const consultOptions = {
        ...args,
        ...(args.max_budget_usd === undefined ? {} : { 'max-budget-usd': args.max_budget_usd }),
        invoke: options.invoke,
      };
      return mcpResult(await consultAgent(input, consultOptions));
    }
    throw new Error(`Unknown AHP+ MCP tool ${name}`);
  }
  return null;
}

export async function serveMcp(input = '.', options = {}) {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
      const result = await handleMcpRequest(input, message, options);
      if (message.id === undefined || result === null) continue;
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
    } catch (error) {
      if (message?.id === undefined) continue;
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32000,
          message: error.message,
          ...(error.code || error.details ? { data: { code: error.code || null, details: error.details || null } } : {}),
        },
      })}\n`);
    }
  }
}
