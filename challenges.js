export function stripArticle(value) {
  return String(value || '').replace(/^(der|die|das)\s+/i, '').trim();
}

export function getArticle(word) {
  const explicit = String(word?.article || '').trim().toLowerCase();
  if (['der', 'die', 'das'].includes(explicit)) return explicit;
  const match = String(word?.german || '').trim().match(/^(der|die|das)\s+/i);
  return match ? match[1].toLowerCase() : '';
}

export function formatPlural(value) {
  const text = String(value || '').trim();
  return /^(der|die|das)\s+/i.test(text) ? text : `die ${text}`;
}

export function pluralOptions(word) {
  const singular = stripArticle(word.german);
  const answer = formatPlural(word.plural);
  const article = getArticle(word);
  if (!singular || !answer) return [];

  const umlaut = singular.replace(/[aou]/i, char => ({ a: 'ä', A: 'Ä', o: 'ö', O: 'Ö', u: 'ü', U: 'Ü' }[char] || char));
  const stems = [singular, ...(article !== 'die' && umlaut !== singular ? [umlaut] : [])];
  let endings;
  if (article === 'die') {
    if (/e$/i.test(singular)) endings = ['n', 's', ''];
    else if (/(ung|heit|keit|schaft|ion|tät|ik|ur)$/i.test(singular)) endings = ['en', 'e', 's', ''];
    else endings = ['en', 's', ''];
  } else if (article === 'der' || article === 'das') {
    if (/(er|el|en|chen|lein)$/i.test(singular)) endings = ['', 'e', 's'];
    else endings = ['e', 'er', 's', ''];
  } else {
    endings = ['e', 'en', 'er', 's', ''];
  }

  const candidates = new Set();
  for (const stem of stems) {
    for (const ending of endings) {
      const candidate = `die ${stem}${ending}`;
      if (candidate.toLocaleLowerCase() !== answer.toLocaleLowerCase()) candidates.add(candidate);
    }
  }
  const distractors = shuffle([...candidates]).slice(0, 3);
  // If three distinct same-stem distractors cannot be formed, omit this question.
  return distractors.length === 3 ? shuffle([answer, ...distractors]) : [];
}

export function inferPartOfSpeech(word) {
  const explicit = String(word.partOfSpeech || '').toLowerCase();
  if (explicit) return explicit;
  if (getArticle(word) || String(word.plural || '').trim()) return 'noun';
  if (['presentIch', 'presentDu', 'presentEr', 'presentWir', 'presentIhr', 'presentSie', 'prateritum', 'perfekt'].some(key => String(word[key] || '').trim())) return 'verb';
  return 'unknown';
}

export function buildVerbBank(active) {
  return active
    .filter(word => inferPartOfSpeech(word) === 'verb' && ['presentIch', 'presentDu', 'presentEr', 'presentWir', 'presentIhr', 'presentSie', 'prateritum', 'perfekt'].some(key => String(word[key] || '').trim()))
    .map(word => ({
      inf: word.german,
      ich: word.presentIch || '', du: word.presentDu || '', er: word.presentEr || '',
      wir: word.presentWir || '', ihr: word.presentIhr || '', sie: word.presentSie || '',
      prateritum: word.prateritum || '', perfekt: word.perfekt || '', translation: word.translation || ''
    }));
}

export function buildVerbQuestions(source) {
  const forms = [['ich', 'ich'], ['du', 'du'], ['er', 'er/sie/es'], ['wir', 'wir'], ['ihr', 'ihr'], ['sie', 'sie/Sie'], ['prateritum', 'Präteritum'], ['perfekt', 'Perfekt']];
  const eligible = shuffle(source.flatMap(verb => forms.filter(([key]) => verb[key]).map(([key, label]) => ({ verb, key, label }))));
  return eligible.slice(0, 10).map(({ verb, key, label }) => {
    const answer = verb[key];
    const prompt = key === 'perfekt'
      ? `Perfekt · ${verb.inf}\nComplete the past-tense form.`
      : key === 'prateritum'
        ? `Präteritum · ${verb.inf}\nComplete the past-tense form.`
        : `Present tense · ${label} · ${verb.inf}\nChoose the correct conjugated form.`;
    const wrong = source.filter(other => other.inf !== verb.inf).map(other => other[key]).filter(Boolean);
    const options = uniqueOptions(answer, wrong);
    return { answer, options, prompt, speak: verb.inf, explanation: `${verb.inf} — ${label}: ${answer}` };
  }).filter(question => question.options.length >= 2 && question.options.filter(option => option === question.answer).length === 1);
}

export function uniqueOptions(answer, others) {
  const correct = String(answer ?? '').trim();
  if (!correct) return [];
  const candidates = [...new Set((others || []).filter(value => value !== null && value !== undefined).map(value => String(value).trim()).filter(value => value && value !== correct))];
  return shuffle([correct, ...shuffle(candidates).slice(0, 3)]);
}

export function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}
