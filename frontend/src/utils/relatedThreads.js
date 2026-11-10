const genericWords = new Set(['about', 'after', 'before', 'follow', 'from', 'meeting', 'project', 'quick', 'regarding', 'their', 'update', 'with', 'your']);

function cleanSubject(subject) {
  return (subject || '').replace(/^(?:\s*(?:re|fwd?)\s*:\s*)+/i, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function subjectWords(subject) {
  return new Set((subject.match(/[\p{L}\p{N}]{4,}/gu) || []).filter(word => !genericWords.has(word)));
}

function mailbox(address) {
  address = address || '';
  return (address.match(/<([^>]+)>/)?.[1] || address).trim().toLowerCase();
}

export function findRelatedThreads(threads, current) {
  const subject = cleanSubject(current.subject);
  if (!subject) return [];
  const words = subjectWords(subject);
  const sender = mailbox(current.from);
  const seen = new Set([current.thread_id]);
  const matches = [];

  for (const thread of threads) {
    if (!thread.thread_id || seen.has(thread.thread_id)) continue;
    seen.add(thread.thread_id);
    const candidateSubject = cleanSubject(thread.subject);
    const sameSender = Boolean(sender && mailbox(thread.from) === sender);
    const sameSubject = subject === candidateSubject && (words.size > 0 || sameSender);
    const common = [...subjectWords(candidateSubject)].filter(word => words.has(word)).length;
    if (sameSubject || (sameSender && common >= 2)) {
      matches.push({ thread, reason: sameSubject ? 'Matching subject' : 'Sender and topic match', rank: sameSubject ? 2 : 1 });
    }
  }

  return matches.sort((a, b) => b.rank - a.rank || (Date.parse(b.thread.date) || 0) - (Date.parse(a.thread.date) || 0)).slice(0, 4);
}
