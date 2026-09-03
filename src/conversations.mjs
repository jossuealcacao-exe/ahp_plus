import { csv } from './args.mjs';
import { continuityEvents, appendContinuityEvent } from './events.mjs';
import { invariant } from './errors.mjs';
import { makeId, safeSegment } from './fs-utils.mjs';
import { repository } from './state.mjs';

const ROOM_PREFIX = 'conv-';

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function participant(value) {
  const normalized = safeSegment(value);
  invariant(normalized && normalized !== 'default', 'Conversation participants must be non-empty platform identifiers', {
    code: 'INVALID_PARTICIPANT', details: { value },
  });
  return normalized;
}

function participants(value) {
  const values = csv(value).map(participant);
  return [...new Set(values)];
}

function eventParticipants(event) {
  return participants(event.to || '');
}

function roomId(value) {
  const normalized = safeSegment(value);
  invariant(normalized.startsWith(ROOM_PREFIX), `Conversation ID must start with ${ROOM_PREFIX}`, {
    code: 'INVALID_CONVERSATION_ID', details: { value },
  });
  return normalized;
}

function openingEvents(repo) {
  return continuityEvents(repo, { type: 'CONVERSATION_OPENED' })
    .map(({ event }) => event)
    .filter((event) => event.session_id === event.correlation_id && event.session_id.startsWith(ROOM_PREFIX));
}

function roomSummary(event) {
  const roomParticipants = eventParticipants(event);
  return {
    room_id: event.session_id,
    title: event.summary,
    participants: roomParticipants,
    opened_by: event.from,
    opened_at: event.created_at,
    open_event_id: event.id,
    fingerprint: event.integrity?.digest || null,
  };
}

function findRoom(repo, value) {
  const id = roomId(value);
  const opening = openingEvents(repo).find((event) => event.session_id === id);
  invariant(opening, `Conversation not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  return { event: opening, room: roomSummary(opening) };
}

function recipientsFor(room, from, requested) {
  const values = requested === undefined || requested === null || requested === ''
    ? room.participants.filter((item) => item !== from)
    : participants(requested);
  invariant(values.length > 0, 'A conversation message needs at least one recipient other than the sender', {
    code: 'INVALID_RECIPIENT', details: { from, participants: room.participants },
  });
  invariant(values.every((item) => item !== from && room.participants.includes(item)),
    'Conversation recipients must be other participants in the room', {
      code: 'INVALID_RECIPIENT', details: { recipients: values, participants: room.participants, from },
    });
  return values;
}

function messageView(event) {
  return {
    event_id: event.id,
    fingerprint: event.integrity?.digest || null,
    sequence: event.sequence,
    from: event.from,
    to: event.to,
    text: event.summary,
    created_at: event.created_at,
    parent_event_id: event.causal?.parent_event_id || null,
    transport_status: event.transport?.status || null,
  };
}

function roomMessages(repo, id) {
  return continuityEvents(repo, { session: id, type: 'MESSAGE' }).map(({ event }) => event);
}

function messagesAfter(messages, after) {
  if (!after) return messages;
  const index = messages.findIndex((event) => event.id === after);
  invariant(index >= 0, `Conversation event not found in this room: ${after}`, { code: 'NOT_FOUND', exitCode: 2 });
  return messages.slice(index + 1);
}

export function openConversation(input = '.', options = {}) {
  const repo = repository(input);
  invariant(repo.manifest.protocol_version === '1.4.0',
    `Conversations require protocol 1.4.0; current project is ${repo.manifest.protocol_version}. Run \`ahp project upgrade --plan\`.`, {
      code: 'PROTOCOL_UPGRADE_REQUIRED', exitCode: 2,
    });
  const title = String(options.title || options.summary || '').trim();
  invariant(title, 'A conversation title is required', { code: 'INVALID_ARGUMENT' });
  const from = participant(options.from || options.platform || 'current-agent');
  const roomParticipants = participants(options.participants || '');
  invariant(roomParticipants.length >= 2, 'A conversation needs at least two participants', {
    code: 'INVALID_PARTICIPANTS', details: { participants: roomParticipants },
  });
  invariant(roomParticipants.includes(from), 'The opening platform must be listed as a conversation participant', {
    code: 'INVALID_PARTICIPANTS', details: { from, participants: roomParticipants },
  });
  const id = `${ROOM_PREFIX}${safeSegment(makeId('room'))}`;
  const event = appendContinuityEvent(repo.repoRoot, {
    ...options,
    type: 'CONVERSATION_OPENED',
    summary: title,
    session: id,
    correlation: id,
    parent: false,
    from,
    to: roomParticipants.join(','),
    actor: options.actor || from,
    platform: options.platform || from,
    model: options.model || 'unknown',
    capabilities: 'conversation-room,shared-project-context,manual-chat-surface',
    requested: 'Open a shared project conversation room',
    authority: 'NOT_GRANTED',
    status: 'REQUESTED',
    limitations: 'Messages are durable project events|MCP clients must read or wait for new messages|No native IDE chat injection',
    'next-action': 'Post the first project message or wait for a participant response',
  });
  return { ok: true, status: 'OPEN', project_id: repo.manifest.project_id, room: roomSummary(event) };
}

export function listConversations(input = '.', options = {}) {
  const repo = repository(input);
  const forParticipant = options.for ? participant(options.for) : null;
  const rooms = openingEvents(repo).map(roomSummary)
    .filter((room) => !forParticipant || room.participants.includes(forParticipant));
  return { ok: true, project_id: repo.manifest.project_id, count: rooms.length, rooms };
}

export function sendConversationMessage(input = '.', id, text, options = {}) {
  const repo = repository(input);
  const { room } = findRoom(repo, id);
  const from = participant(options.from || options.platform || 'current-agent');
  invariant(room.participants.includes(from), 'The sender must be a participant in the conversation', {
    code: 'NOT_A_PARTICIPANT', details: { from, participants: room.participants },
  });
  const summary = String(text || options.text || '').trim();
  invariant(summary, 'A conversation message is required', { code: 'INVALID_ARGUMENT' });
  const recipients = recipientsFor(room, from, options.to);
  const event = appendContinuityEvent(repo.repoRoot, {
    ...options,
    type: 'MESSAGE',
    summary,
    session: room.room_id,
    correlation: room.room_id,
    from,
    to: recipients.join(','),
    actor: options.actor || from,
    platform: options.platform || from,
    model: options.model || 'unknown',
    capabilities: 'conversation-room,project-context',
    requested: 'Deliver a project conversation message to room participants',
    authority: 'NOT_GRANTED',
    status: 'REQUESTED',
    limitations: 'Local event capture is not proof of remote delivery|Use secure relay or secure network for cross-device transport',
    'next-action': `Await a response from ${recipients.join(', ')}`,
  });
  return {
    ok: true,
    status: 'POSTED',
    project_id: repo.manifest.project_id,
    room_id: room.room_id,
    message: messageView(event),
    recipients,
  };
}

export function conversationInbox(input = '.', id, options = {}) {
  const repo = repository(input);
  const { room } = findRoom(repo, id);
  const recipient = participant(options.for || options.to);
  invariant(room.participants.includes(recipient), 'The inbox platform must be a participant in the conversation', {
    code: 'NOT_A_PARTICIPANT', details: { recipient, participants: room.participants },
  });
  let events = messagesAfter(roomMessages(repo, room.room_id), options.after)
    .filter((event) => event.from !== recipient && eventParticipants(event).includes(recipient));
  const limit = Number(options.limit || 0);
  if (limit > 0) events = events.slice(-limit);
  return {
    ok: true,
    status: events.length ? 'MESSAGES_AVAILABLE' : 'EMPTY',
    project_id: repo.manifest.project_id,
    room,
    recipient,
    count: events.length,
    messages: events.map(messageView),
  };
}

export async function waitForConversationMessage(input = '.', id, options = {}) {
  const timeout = Number(options.timeout || 60);
  const interval = Number(options.interval || 1);
  invariant(Number.isFinite(timeout) && timeout > 0 && timeout <= 300, '--timeout must be greater than 0 and no more than 300 seconds', {
    code: 'INVALID_ARGUMENT', details: { timeout },
  });
  invariant(Number.isFinite(interval) && interval >= 0.2 && interval <= 30, '--interval must be between 0.2 and 30 seconds', {
    code: 'INVALID_ARGUMENT', details: { interval },
  });
  const started = Date.now();
  let latest = conversationInbox(input, id, options);
  while (!latest.messages.length && Date.now() - started < timeout * 1000) {
    await pause(Math.min(interval * 1000, (timeout * 1000) - (Date.now() - started)));
    latest = conversationInbox(input, id, options);
  }
  return {
    ...latest,
    status: latest.messages.length ? 'MESSAGE_AVAILABLE' : 'TIMEOUT',
    waited_ms: Date.now() - started,
  };
}
