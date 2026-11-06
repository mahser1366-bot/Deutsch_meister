export const today = (now = new Date()) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const addDays = (days, from = today()) => {
  const [year, month, day] = String(from).split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  date.setDate(date.getDate() + Number(days));
  return today(date);
};

export function ensureSchedules(word, legacyAlgorithm = 'sm2') {
  const w = { ...word, scheduling: { ...(word.scheduling || {}) } };
  const active = w.active !== false;
  if (!w.scheduling.leitner) {
    w.scheduling.leitner = {
      box: Math.max(1, Math.min(5, Number(legacyAlgorithm === 'leitner' ? w.box || 1 : 1))),
      interval: legacyAlgorithm === 'leitner' ? Number(w.interval || 0) : 0,
      dueDate: legacyAlgorithm === 'leitner' ? (w.dueDate || today()) : (active ? today() : '9999-12-31'),
      reviewCount: legacyAlgorithm === 'leitner' ? Number(w.reviewCount || 0) : 0
    };
  }
  if (!w.scheduling.sm2) {
    w.scheduling.sm2 = {
      repetitions: legacyAlgorithm === 'sm2' ? Number(w.repetitions || 0) : 0,
      easeFactor: Math.max(1.3, Number(legacyAlgorithm === 'sm2' ? w.easeFactor || 2.5 : 2.5)),
      interval: legacyAlgorithm === 'sm2' ? Number(w.interval || 0) : 0,
      dueDate: legacyAlgorithm === 'sm2' ? (w.dueDate || today()) : (active ? today() : '9999-12-31'),
      reviewCount: legacyAlgorithm === 'sm2' ? Number(w.reviewCount || 0) : 0
    };
  }
  return w;
}

export function schedule(word, rating, algorithm = 'sm2', reviewedOn = today()) {
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw new TypeError(`Unsupported review rating: ${rating}`);
  if (!['leitner', 'sm2'].includes(algorithm)) throw new TypeError(`Unsupported scheduling algorithm: ${algorithm}`);
  const w = ensureSchedules(word, algorithm);
  const s = { ...w.scheduling[algorithm] };
  if (algorithm === 'leitner') {
    const movement = rating === 'again' ? -1 : rating === 'hard' ? 0 : rating === 'good' ? 1 : 2;
    s.box = Math.max(1, Math.min(5, Number(s.box || 1) + movement));
    s.interval = ({ 1: 1, 2: 2, 3: 4, 4: 7, 5: 14 })[s.box];
  } else {
    let ease = Math.max(1.3, Number(s.easeFactor || 2.5));
    let reps = Math.max(0, Number(s.repetitions || 0));
    const interval = Math.max(0, Number(s.interval || 0));
    if (rating === 'again') {
      reps = 0;
      s.interval = 1;
      ease = Math.max(1.3, ease - 0.2);
    } else if (rating === 'hard') {
      s.interval = reps === 0 ? 1 : reps === 1 ? 2 : Math.max(1, Math.round(interval * 1.2));
      ease = Math.max(1.3, ease - 0.15);
      reps++;
    } else if (rating === 'good') {
      s.interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(1, Math.round(interval * ease));
      reps++;
    } else {
      s.interval = reps === 0 ? 3 : Math.max(1, Math.round(interval * ease * 1.3));
      ease += 0.15;
      reps++;
    }
    s.easeFactor = ease;
    s.repetitions = reps;
  }
  s.dueDate = addDays(s.interval, reviewedOn);
  s.lastReviewed = reviewedOn;
  s.reviewCount = (Number(s.reviewCount) || 0) + 1;
  w.scheduling[algorithm] = s;
  Object.assign(w, algorithm === 'leitner'
    ? { box: s.box, interval: s.interval, dueDate: s.dueDate, lastReviewed: s.lastReviewed, reviewCount: s.reviewCount }
    : { repetitions: s.repetitions, easeFactor: s.easeFactor, interval: s.interval, dueDate: s.dueDate, lastReviewed: s.lastReviewed, reviewCount: s.reviewCount });
  return w;
}

export const isDue = (word, algorithm = 'sm2', onDate = today()) => {
  if (word.active === false) return false;
  const dueDate = word.scheduling?.[algorithm]?.dueDate || word.dueDate || onDate;
  return String(dueDate) <= onDate;
};
