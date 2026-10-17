#!/usr/bin/env node
// Language evaluation for the Vạn Giới Ký narrator. Runs the scenarios in tools/scenarios.json through the
// local Ollama model with the game's own system prompt (narration-rules.js) and sampling, then scores every
// answer on the things the rules ask for: real Vietnamese words (vietnamese.js), Hán Việt names rather than
// pinyin, no Han characters, every utterance in a <dialogue> tag with a real speaker, second-person
// narration, consistent address pairs, no example names from the rules, loot line only after a kill, and
// coverage of what the player wrote. Results (scores and the raw answers) are written to tools/eval-results/.
//
//   node tools/eval-language.mjs                       # every scenario once, game defaults
//   node tools/eval-language.mjs --runs 3 --label min_p # repeat each scenario 3× and name the result file
//   node tools/eval-language.mjs --baseline tools/eval-results/<file>.json   # print deltas against a past run
//
// Options: --model <name> --num-ctx <n> --num-predict <n> --scenarios <file> --only <id> --runs <n>
//          --label <text> --baseline <file> --no-exemplar (drop the style exemplar to measure its effect)
//          --rescore <file> (re-score a saved run with the current metrics, no model calls)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const lexicon = require(join(root, 'vietnamese.js'));
const rules = require(join(root, 'narration-rules.js'));

const args = parseArgs(process.argv.slice(2));
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const model = args.model || 'huihui_ai/qwen3-abliterated:14b';
const numCtx = Number(args['num-ctx'] || 12288);
const numPredict = Number(args['num-predict'] || 2600);
const runs = Number(args.runs || 1);
const scenarioFile = resolve(args.scenarios || join(here, 'scenarios.json'));
const scenarios = JSON.parse(readFileSync(scenarioFile, 'utf8')).filter(scenario => !args.only || scenario.id === args.only);
if (!scenarios.length) { console.error('Không có kịch bản nào khớp.'); process.exit(1); }

const EXAMPLE_NAMES = rules.EXAMPLE_NAMES;
const INVALID_SPEAKERS = /^(?:Lời|Lời nói|Tiếng|Giọng|Người đối diện|Không rõ|Chưa rõ người nói|NPC|Người lạ|Cô gái|Chàng trai|Người đàn ông|Người phụ nữ|Nàng|Hắn|Ngươi)$/iu;
// The same request paragraph the game sends (ai.js, buildUserMessage).
const TURN_REQUEST = 'YÊU CẦU LƯỢT NÀY: Tiếp tục liền mạch từ câu cuối cùng trong diễn biến gần đây. Mở đầu bằng việc kể lại toàn bộ hành động và lời thoại người chơi vừa nhập: tường thuật được viết lại cho giàu hình ảnh và hợp ngữ cảnh, lời thoại được trau chuốt câu chữ nhưng giữ nguyên ý, không bỏ sót câu nào, đặt trong thẻ <dialogue speaker="..."> đúng người nói. Chỉ sau đó mới viết phản ứng, lời đáp và hệ quả. Nếu đó là câu hỏi, hãy để đúng người được hỏi trả lời chính xác câu hỏi trước khi mở rộng cảnh. Không đưa thêm sự kiện ngoài mạch. Chỉ kết thúc bằng dòng [CHIẾN LỢI PHẨM] nếu trong lượt này đã hạ gục xong kẻ địch; nếu không thì không có dòng đó.';

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const key = list[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const next = list[i + 1];
    if (next === undefined || next.startsWith('--')) out[name] = true;
    else { out[name] = next; i++; }
  }
  return out;
}

function systemPromptFor(profile) {
  const prompt = rules.buildNarrationSystemPrompt(profile, { lootRule: '', corrections: [] });
  if (!args['no-exemplar']) return prompt;
  return prompt.split('\n\n').filter(part => !part.startsWith('MẪU VĂN THAM CHIẾU')).join('\n\n');
}

function userMessageFor(scenario) {
  const { profile } = scenario;
  return [
    `HỒ SƠ: ${profile.name}; ${profile.age} tuổi; thân phận ${profile.identity}; cảnh giới ${profile.realm}.\nTHẾ GIỚI MUỐN CHƠI: ${profile.worldName}.\nMÔ TẢ THẾ GIỚI VÀ MỐC THỜI GIAN: ${profile.setting}\nMỤC TIÊU: ${profile.goal}\nCHỈ SỐ HIỆN TẠI: Công kích: 24; Phòng ngự: 18; Tốc độ: 20; Máu (hiện tại / tối đa): 180 / 180.\nTRANG BỊ ĐANG MẶC: Thanh Phong Kiếm (Phàm phẩm; đang dùng; Công kích +6).\nKỸ NĂNG ĐANG DÙNG: Thanh Phong Kiếm Pháp (Phàm phẩm; đang dùng; Công kích +4).\nTÚI ĐỒ (chưa sử dụng): trống.\nTIỀN HIỆN CÓ: 12 đồng.\nCHƯƠNG ĐANG KỂ: CHƯƠNG 01.\nMỤC TIÊU HIỆN TẠI (thầm kín, chỉ để định hướng tình tiết, không được nói ra trong truyện): ${profile.goal} (tiến độ ước lượng 5%).\nKÝ ỨC GẦN ĐÂY (mới nhất ở cuối): chưa có.\n\nDIỄN BIẾN GẦN ĐÂY (ưu tiên mạch mới nhất):\n${scenario.recentStory}`,
    'BỘ NHỚ TỐI ĐA 5 CHƯƠNG HOÀN TẤT GẦN NHẤT:\nChưa có chương hoàn tất nào trong bộ nhớ.',
    'CÁC LƯỢT ĐÃ KỂ TRONG CHƯƠNG 1 (không kể lại):\nChưa có lượt nào khác trong chương hiện tại.',
    `HÀNH ĐỘNG / LỜI THOẠI NGƯỜI CHƠI (bắt buộc kể lại đầy đủ, đúng thứ tự, ngay đầu lượt):\n${scenario.action}`,
    TURN_REQUEST
  ].join('\n\n');
}

async function generate(system, user) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      think: false,
      stream: false,
      keep_alive: '10m',
      options: { num_ctx: numCtx, ...rules.NARRATION_SAMPLING, num_predict: numPredict }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Ollama HTTP ${response.status}`);
  return data;
}

// ---- metrics -------------------------------------------------------------------------------------------

const stripTags = text => text.replace(/<[^>]*>/g, ' ');
const narrationOnly = text => text.replace(/<dialogue\b[^>]*>[\s\S]*?<\/dialogue\s*>/gi, ' ').replace(/<[^>]*>/g, ' ');
const dialogues = text => [...text.matchAll(/<dialogue\b([^>]*)>([\s\S]*?)<\/dialogue\s*>/gi)].map(match => ({ speaker: (match[1].match(/speaker\s*=\s*(["'])(.*?)\1/i) || [])[2]?.trim() || '', text: match[2].trim() }));
const countWords = text => (stripTags(text).match(/[\p{L}\p{N}]+/gu) || []).length;

function looksLikePinyin(token) {
  const lower = token.toLocaleLowerCase('vi').normalize('NFD');
  if (/[\u0304\u030c\u0308]/.test(lower)) return true;
  if (/[\u0302\u0306\u031b\u0303\u0309\u0323]|đ/.test(lower)) return false;
  const plain = lower.replace(/[\u0300\u0301]/g, '');
  return /[wzjf]/.test(plain) || /^(sh|zh|q(?!u)|y[aeiou])/.test(plain)
    || /(ing|eng|ei|ou|uo|iao|iong|iang|ian|[iu]e)$/.test(plain) || /(?<!q)uang?$/.test(plain)
    || /[aeiouy][^aeiouy]+[aeiouy]/.test(plain);
}
function pinyinNames(text) {
  const names = new Set();
  for (const match of stripTags(text).replace(/\*\*/g, '').matchAll(/\p{Lu}[\p{L}\p{M}]*(?:[ \t]+\p{Lu}[\p{L}\p{M}]*){0,3}/gu)) {
    const tokens = match[0].split(/[ \t]+/);
    // A token that is itself a Vietnamese syllable (Giang, Cao, Liu) only counts when the whole name is
    // toneless ASCII, the way "Cao Cao" or "Liu Bei" is written; the game's pinyin guard splits the same way.
    const pinyinToken = tokens.some(token => looksLikePinyin(token) && !lexicon.isVietnameseSyllable(token));
    const tonelessName = tokens.length >= 2 && tokens.every(token => /^[A-Za-z]+$/.test(token)) && tokens.some(looksLikePinyin);
    if (pinyinToken || tonelessName) names.add(match[0]);
  }
  return [...names];
}

function contentWords(text) {
  return new Set(text.toLocaleLowerCase('vi').replace(/<[^>]*>|\*\*/g, ' ').match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length > 1) || []);
}
function actionCoverage(answer, action) {
  const wanted = contentWords(action.replace(/^[^:\n]+ nói: /gmu, ''));
  const have = contentWords(answer);
  if (!wanted.size) return 1;
  return [...wanted].filter(word => have.has(word)).length / wanted.size;
}

function addressMismatches(lines) {
  // The address rule's own example: a speaker who calls themself cháu/con/thuộc hạ/đệ/muội and the listener "ngươi".
  // "con" is a classifier far more often than a pronoun, and "đệ tử" / "sư đệ" are nouns, so they are left out.
  const humble = /(?:^|[^\p{L}])(?:cháu|thuộc hạ|tiểu nhân|đệ|muội)(?=$|[^\p{L}])(?!\s+(?:tử|muội|đệ|nhất|nhị|tam)(?=$|[^\p{L}]))/iu;
  const lofty = /(?:^|[^\p{L}])ngươi(?=$|[^\p{L}])/iu;
  return lines.filter(line => humble.test(line.text) && lofty.test(line.text)).map(line => line.text);
}

function duplicateSentences(text) {
  const seen = new Map();
  for (const sentence of stripTags(text).split(/(?<=[.!?…])\s+/)) {
    const key = sentence.toLocaleLowerCase('vi').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (key.split(' ').length < 6) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.values()].filter(count => count > 1).length;
}

function score(answer, scenario) {
  const { profile } = scenario;
  const lines = dialogues(answer);
  const narration = narrationOnly(answer);
  const words = countWords(answer);
  const per1000 = count => words ? count * 1000 / words : 0;
  const invalidWords = lexicon.findInvalidWords(answer, profile.name.split(/\s+/));
  const nameInNarration = (narration.match(new RegExp(`(?<![\\p{L}])${profile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'gu')) || []).length;
  const wrongPronouns = (narration.match(/(?:^|[^\p{L}])(?:tôi|bạn|anh ấy|cậu ấy|cậu ta|anh ta)(?=$|[^\p{L}])/giu) || []).length;
  const bareQuotes = (narration.match(/[“"][^”"\n]{12,}[”"]/g) || []).length;
  const badSpeakers = lines.filter(line => !line.speaker || INVALID_SPEAKERS.test(line.speaker)).length;
  const hanChars = (answer.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g) || []).length;
  const pinyin = pinyinNames(answer);
  const exampleNames = EXAMPLE_NAMES.filter(name => stripTags(answer).includes(name));
  const lootLine = /\[CHIẾN LỢI PHẨM\]/.test(answer);
  const lootMisuse = lootLine && !scenario.expectLoot ? 1 : 0;
  const coverage = actionCoverage(answer, scenario.action);
  const mismatches = addressMismatches(lines);
  const duplicates = duplicateSentences(answer);
  const metaLeak = /(?:^|\n)\s*(?:\*\*)?(?:Lưu ý|Ghi chú|Note|Phân tích|Kế hoạch)[:：]/iu.test(answer) ? 1 : 0;
  // One number to compare runs by: violations weighted by how much they hurt the reader, per 1,000 words.
  const penalty = per1000(invalidWords.length * 3 + pinyin.length * 3 + hanChars * 3 + bareQuotes * 2 + badSpeakers * 2 + nameInNarration + wrongPronouns * 2 + mismatches.length * 2 + duplicates * 2)
    + exampleNames.length * 5 + lootMisuse * 5 + metaLeak * 5 + (coverage < 0.6 ? 10 : 0);
  return {
    words, paragraphs: answer.split(/\n\s*\n/).filter(Boolean).length, dialogueLines: lines.length,
    invalidWords, pinyin, hanChars, bareQuotes, badSpeakers, nameInNarration, wrongPronouns,
    addressMismatches: mismatches, duplicates, exampleNames, lootLine, lootMisuse, metaLeak,
    actionCoverage: Math.round(coverage * 100) / 100,
    penalty: Math.round(penalty * 10) / 10
  };
}

// ---- run -----------------------------------------------------------------------------------------------

// --rescore: recompute the metrics of a saved run with the current scorer, without calling the model.
if (args.rescore) {
  const saved = JSON.parse(readFileSync(resolve(args.rescore), 'utf8'));
  const byId = new Map(scenarios.map(scenario => [scenario.id, scenario]));
  for (const result of saved.results) {
    if (!result.answer || !byId.has(result.scenario)) continue;
    result.metrics = score(result.answer, byId.get(result.scenario));
    const notes = [];
    if (result.metrics.pinyin.length) notes.push(`bính âm: ${result.metrics.pinyin.join(', ')}`);
    if (result.metrics.addressMismatches.length) notes.push(`xưng hô lệch ×${result.metrics.addressMismatches.length}`);
    if (result.metrics.lootMisuse) notes.push('chiến lợi phẩm sai chỗ');
    if (result.metrics.exampleNames.length) notes.push(`tên minh họa: ${result.metrics.exampleNames.join(', ')}`);
    console.log(`${result.scenario} (${result.run}) → điểm phạt ${result.metrics.penalty}${notes.length ? `; ${notes.join(' · ')}` : ''}`);
  }
  const rescored = saved.results.filter(result => result.metrics);
  const avg = key => rescored.reduce((sum, result) => sum + result.metrics[key], 0) / (rescored.length || 1);
  const total = pick => rescored.reduce((sum, result) => sum + pick(result.metrics), 0);
  saved.summary = {
    ...saved.summary,
    meanPenalty: Math.round(avg('penalty') * 10) / 10,
    totalInvalidWords: total(m => m.invalidWords.length), totalPinyin: total(m => m.pinyin.length), totalBareQuotes: total(m => m.bareQuotes),
    totalBadSpeakers: total(m => m.badSpeakers), totalNarrationSlips: total(m => m.nameInNarration + m.wrongPronouns),
    totalAddressMismatches: total(m => m.addressMismatches.length), meanActionCoverage: Math.round(avg('actionCoverage') * 100) / 100,
    rescoredAt: new Date().toISOString()
  };
  writeFileSync(resolve(args.rescore), JSON.stringify(saved, null, 2), 'utf8');
  console.log(`Điểm phạt trung bình ${saved.summary.meanPenalty}; đã ghi lại ${args.rescore}`);
  process.exit(0);
}

const started = new Date();
const results = [];
console.log(`Model ${model}, num_ctx ${numCtx}, num_predict ${numPredict}, ${scenarios.length} kịch bản × ${runs} lần${args['no-exemplar'] ? ', không có mẫu văn' : ''}.`);
for (const scenario of scenarios) {
  const system = systemPromptFor(scenario.profile);
  const user = userMessageFor(scenario);
  for (let run = 1; run <= runs; run++) {
    process.stdout.write(`▸ ${scenario.id} (${run}/${runs}) … `);
    const t0 = Date.now();
    try {
      const data = await generate(system, user);
      const answer = (data.message?.content || '').trim();
      const metrics = score(answer, scenario);
      const seconds = (Date.now() - t0) / 1000;
      const tokPerSec = data.eval_count && data.eval_duration ? data.eval_count / (data.eval_duration / 1e9) : 0;
      results.push({ scenario: scenario.id, run, metrics, promptTokens: data.prompt_eval_count, outputTokens: data.eval_count, seconds, tokPerSec, answer });
      console.log(`${metrics.words} từ, ${seconds.toFixed(0)} s, ${tokPerSec.toFixed(1)} tok/s, prompt ${data.prompt_eval_count} tok → điểm phạt ${metrics.penalty}`);
      const notes = [];
      if (metrics.invalidWords.length) notes.push(`từ lạ: ${metrics.invalidWords.slice(0, 8).join(', ')}`);
      if (metrics.pinyin.length) notes.push(`bính âm: ${metrics.pinyin.join(', ')}`);
      if (metrics.hanChars) notes.push(`${metrics.hanChars} chữ Hán`);
      if (metrics.bareQuotes) notes.push(`${metrics.bareQuotes} thoại ngoài thẻ`);
      if (metrics.badSpeakers) notes.push(`${metrics.badSpeakers} speaker không hợp lệ`);
      if (metrics.nameInNarration) notes.push(`tên người chơi trong lời dẫn ×${metrics.nameInNarration}`);
      if (metrics.wrongPronouns) notes.push(`đại từ sai ngôi ×${metrics.wrongPronouns}`);
      if (metrics.addressMismatches.length) notes.push(`xưng hô lệch vai ×${metrics.addressMismatches.length}`);
      if (metrics.duplicates) notes.push(`${metrics.duplicates} câu lặp`);
      if (metrics.exampleNames.length) notes.push(`tên minh họa: ${metrics.exampleNames.join(', ')}`);
      if (metrics.lootMisuse) notes.push('dòng chiến lợi phẩm sai chỗ');
      if (metrics.metaLeak) notes.push('lộ lời dẫn meta');
      if (metrics.actionCoverage < 0.6) notes.push(`chỉ kể lại ${Math.round(metrics.actionCoverage * 100)}% hành động`);
      if (notes.length) console.log(`   ${notes.join(' · ')}`);
    } catch (error) {
      console.log(`LỖI: ${error.message}`);
      results.push({ scenario: scenario.id, run, error: error.message });
    }
  }
}

const scored = results.filter(result => result.metrics);
const mean = key => scored.length ? scored.reduce((sum, result) => sum + result.metrics[key], 0) / scored.length : 0;
const summary = {
  model, numCtx, numPredict, runs, label: args.label || '', noExemplar: Boolean(args['no-exemplar']), startedAt: started.toISOString(),
  systemPromptChars: scenarios.length ? systemPromptFor(scenarios[0].profile).length : 0,
  meanPenalty: Math.round(mean('penalty') * 10) / 10,
  meanWords: Math.round(mean('words')),
  totalInvalidWords: scored.reduce((sum, result) => sum + result.metrics.invalidWords.length, 0),
  totalPinyin: scored.reduce((sum, result) => sum + result.metrics.pinyin.length, 0),
  totalBareQuotes: scored.reduce((sum, result) => sum + result.metrics.bareQuotes, 0),
  totalBadSpeakers: scored.reduce((sum, result) => sum + result.metrics.badSpeakers, 0),
  totalNarrationSlips: scored.reduce((sum, result) => sum + result.metrics.nameInNarration + result.metrics.wrongPronouns, 0),
  totalAddressMismatches: scored.reduce((sum, result) => sum + result.metrics.addressMismatches.length, 0),
  meanActionCoverage: Math.round(mean('actionCoverage') * 100) / 100,
  meanTokPerSec: scored.length ? Math.round(scored.reduce((sum, result) => sum + result.tokPerSec, 0) / scored.length * 10) / 10 : 0
};

console.log('\nTỔNG KẾT');
for (const [key, value] of Object.entries(summary)) if (!['startedAt', 'label', 'model'].includes(key)) console.log(`  ${key.padEnd(24)} ${value}`);

if (args.baseline) {
  const base = JSON.parse(readFileSync(resolve(args.baseline), 'utf8')).summary;
  console.log(`\nSO VỚI ${args.baseline}${base.label ? ` (${base.label})` : ''}`);
  for (const key of ['meanPenalty', 'totalInvalidWords', 'totalPinyin', 'totalBareQuotes', 'totalBadSpeakers', 'totalNarrationSlips', 'totalAddressMismatches', 'meanActionCoverage', 'meanWords', 'meanTokPerSec']) {
    const delta = summary[key] - (base[key] ?? 0);
    console.log(`  ${key.padEnd(24)} ${String(base[key] ?? '-').padStart(7)} → ${String(summary[key]).padStart(7)}  (${delta > 0 ? '+' : ''}${Math.round(delta * 100) / 100})`);
  }
}

const outDir = join(here, 'eval-results');
mkdirSync(outDir, { recursive: true });
const stamp = started.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = join(outDir, `${stamp}${args.label ? `-${String(args.label).replace(/[^\w-]+/g, '_')}` : ''}.json`);
writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2), 'utf8');
console.log(`\nĐã ghi ${outFile}`);
