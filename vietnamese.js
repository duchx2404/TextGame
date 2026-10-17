// Vietnamese syllable lexicon. Vietnamese is written one syllable per word, and the set of
// syllables the spelling allows is closed (~6,000 before tones), so a lower-case word that is not
// in the set is not Vietnamese: a made-up word ("thiếnh"), a pinyin slip ("xian") or a garbled
// token from the model. The set is generated here from the onsets and rhymes of the language
// instead of being shipped as a word list, and the check deliberately errs on the permissive
// side (every onset is paired with every rhyme) so that no real word is ever flagged.
//
// Loaded by index.html as a plain script (window.VietnameseLexicon) and by tools/eval-language.mjs
// through require(); it has no DOM or Ollama dependency.
(function (root, factory) {
  const lexicon = factory();
  if (typeof module === 'object' && module.exports) module.exports = lexicon;
  else root.VietnameseLexicon = lexicon;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // Initial consonants; '' is a syllable that starts with the vowel. "gi" and "qu" are handled
  // separately because the glide/vowel letter merges with the onset in the spelling (gì, giết, quy).
  const ONSETS = ['', 'b', 'c', 'k', 'ch', 'd', 'đ', 'g', 'gh', 'h', 'kh', 'l', 'm', 'n', 'ng', 'ngh', 'nh', 'p', 'ph', 'r', 's', 't', 'th', 'tr', 'v', 'x'];

  // Rhymes (vần): nucleus plus optional final or off-glide, written without tone marks.
  const RHYMES = [
    // a, ă, â
    'a', 'ac', 'ach', 'ai', 'am', 'an', 'ang', 'anh', 'ao', 'ap', 'at', 'au', 'ay',
    'ăc', 'ăm', 'ăn', 'ăng', 'ăp', 'ăt',
    'âc', 'âm', 'ân', 'âng', 'âp', 'ât', 'âu', 'ây',
    // e, ê
    'e', 'ec', 'em', 'en', 'eng', 'eo', 'ep', 'et',
    'ê', 'êch', 'êm', 'ên', 'ênh', 'êp', 'êt', 'êu',
    // i, y
    'i', 'ich', 'im', 'in', 'inh', 'ip', 'it', 'iu', 'y',
    // o, ô, ơ
    'o', 'oc', 'oi', 'om', 'on', 'ong', 'op', 'ot', 'ooc', 'oong',
    'ô', 'ôc', 'ôi', 'ôm', 'ôn', 'ông', 'ôp', 'ôt',
    'ơ', 'ơi', 'ơm', 'ơn', 'ơp', 'ơt',
    // u, ư
    'u', 'uc', 'ui', 'um', 'un', 'ung', 'up', 'ut',
    'ư', 'ưc', 'ưi', 'ưm', 'ưn', 'ưng', 'ưt', 'ưu',
    // diphthongs iê/ia, uô/ua, ươ/ưa
    'ia', 'iêc', 'iêm', 'iên', 'iêng', 'iêp', 'iêt', 'iêu',
    'ua', 'uôc', 'uôi', 'uôm', 'uôn', 'uông', 'uôt',
    'ưa', 'ươc', 'ươi', 'ươm', 'ươn', 'ương', 'ươp', 'ươt', 'ươu',
    // rhymes with a /w/ glide written o (oa, oă, oe) or u (uâ, uê, uy, uơ)
    'oa', 'oac', 'oach', 'oai', 'oam', 'oan', 'oang', 'oanh', 'oao', 'oap', 'oat', 'oay',
    'oăc', 'oăm', 'oăn', 'oăng', 'oăp', 'oăt',
    'oe', 'oen', 'oeo', 'oet',
    'uân', 'uâng', 'uât', 'uây',
    'uê', 'uêch', 'uênh', 'uêt',
    'uy', 'uya', 'uych', 'uyn', 'uynh', 'uyp', 'uyt', 'uyên', 'uyêt', 'uyu',
    'uơ',
    // y-initial spellings of the iê rhymes (yên, yêu) and ya (khuya is uya above)
    'yêm', 'yên', 'yêng', 'yêt', 'yêu'
  ];

  // After "qu" the glide is part of the onset, so the rhyme starts at the main vowel.
  const QU_RHYMES = [
    'a', 'ac', 'ach', 'ai', 'am', 'an', 'ang', 'anh', 'ao', 'ap', 'at', 'au', 'ay',
    'ăc', 'ăm', 'ăn', 'ăng', 'ăp', 'ăt', 'âm', 'ân', 'âng', 'ât', 'âu', 'ây',
    'e', 'em', 'en', 'eng', 'eo', 'ep', 'et', 'ê', 'êch', 'êm', 'ên', 'ênh', 'êt',
    'i', 'y', 'ych', 'yn', 'ynh', 'yp', 'yt', 'yu', 'yên', 'yêt', 'yêu', 'ơ', 'ơn', 'o', 'oc', 'ong', 'ôc'
  ];

  // "gi" + a rhyme that starts with i or iê drops one i in the spelling: gì, gìn, giết, giêng.
  const GI_EXTRA = ['gi', 'gin', 'gip', 'git', 'gich', 'ginh', 'giêc', 'giêm', 'giên', 'giêng', 'giêp', 'giêt', 'giêu'];

  const SYLLABLES = new Set();
  for (const onset of ONSETS) for (const rhyme of RHYMES) SYLLABLES.add(onset + rhyme);
  for (const rhyme of RHYMES) SYLLABLES.add('gi' + rhyme);
  for (const rhyme of QU_RHYMES) SYLLABLES.add('qu' + rhyme);
  for (const word of GI_EXTRA) SYLLABLES.add(word);
  // Interjections and loan spellings that the generator does not reach.
  for (const word of ['ừ', 'ờ', 'ơ', 'ô', 'ê', 'hử', 'hừ', 'ầy', 'ái', 'úi', 'ôkê', 'ok', 'ki', 'kem', 'kéo', 'kia', 'kính']) SYLLABLES.add(stripTones(word));

  // Tone marks are the five combining marks; đ and the letter marks (â ă ê ô ơ ư) stay.
  function stripTones(word) {
    return word.normalize('NFD').replace(/[̣̀́̃̉]/g, '').normalize('NFC');
  }

  // True when the lower-case word is a Vietnamese syllable (tones ignored).
  function isVietnameseSyllable(word) {
    const plain = stripTones(String(word || '').toLocaleLowerCase('vi'));
    return SYLLABLES.has(plain);
  }

  // Words that need a check: lower-case runs of letters. Capitalised words are names (which may be
  // foreign), and anything with a digit is a number or a code. Markup and the speaker attribute are
  // skipped so tag syntax never trips the check.
  const WORD = /(?<![\p{L}\p{N}])\p{Ll}[\p{L}]*(?![\p{L}\p{N}])/gu;
  function visibleText(text) {
    return String(text || '').replace(/<dialogue\s+speaker\s*=\s*(["'])(.*?)\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\*\*/g, '');
  }

  // Every invalid lower-case word in the text, in order, each once. `extraWords` adds allowed spellings.
  function findInvalidWords(text, extraWords = []) {
    const extra = new Set(extraWords.map(word => stripTones(word.toLocaleLowerCase('vi'))));
    const seen = new Set();
    const invalid = [];
    for (const match of visibleText(text).matchAll(WORD)) {
      const word = match[0];
      if (seen.has(word)) continue;
      seen.add(word);
      if (!isVietnameseSyllable(word) && !extra.has(stripTones(word.toLocaleLowerCase('vi')))) invalid.push(word);
    }
    return invalid;
  }

  // Sentences that contain invalid words, with the words themselves, so a repair pass can send only
  // those sentences to the model. Sentences are cut inside plain text, never across a tag, so the
  // returned `text` can be replaced verbatim.
  function findInvalidSentences(text, extraWords = []) {
    const results = [];
    const segments = String(text || '').split(/(<[^>]*>)/);
    for (const segment of segments) {
      if (!segment || segment.startsWith('<')) continue;
      for (const sentence of segment.split(/(?<=[.!?…])\s+/)) {
        const trimmed = sentence.trim();
        if (!trimmed) continue;
        const words = findInvalidWords(trimmed, extraWords);
        if (words.length) results.push({ text: trimmed, words });
      }
    }
    return results;
  }

  return { SYLLABLES, stripTones, isVietnameseSyllable, findInvalidWords, findInvalidSentences };
});
