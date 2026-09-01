#!/usr/bin/env node
/*
  Собирает черновик недели из транскриптов Claude Code.

  Что делает: берёт сессии за последние N дней, вытаскивает из каждой первую
  настоящую реплику человека — это и есть тема сессии, — схлопывает повторы,
  отсекает регулярные задачи (одна и та же тема много раз подряд — это крон,
  а не работа), раскладывает оставшееся по школьным предметам и раздаёт по
  шести дням.

  Запуск:
    node tools/week-from-sessions.mjs                 черновик на экран
    node tools/week-from-sessions.mjs --write         записать personal/week-draft.json
    node tools/week-from-sessions.mjs --days 14       окно в днях (по умолчанию 7)
    node tools/week-from-sessions.mjs --from 2026-09-07   понедельник недели
    node tools/week-from-sessions.mjs --projects <путь>   папка с *.jsonl

  Черновик грузится в дневник кнопкой «Загрузить из файла». Он именно
  черновик: машина видит, о чём шли разговоры, но не знает, что из этого
  важно. Правь прямо в клетках.
*/

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* ---------- аргументы ---------- */
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const WRITE = argv.includes("--write");
const DAYS = Number(arg("days", 7));
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

// Папка транскриптов: Claude Code кодирует путь проекта в имя папки.
// Запуская скрипт из репозитория дневника, ты почти наверняка хочешь темы
// не отсюда, а из рабочего проекта — поэтому при отсутствии точного
// совпадения берётся самая свежая папка сессий.
const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
function guessProjects() {
  const exact = path.join(PROJECTS_ROOT, process.cwd().replace(/[:\\/]/g, "-"));
  if (fs.existsSync(exact)) return exact;
  if (!fs.existsSync(PROJECTS_ROOT)) return exact;
  const dirs = fs.readdirSync(PROJECTS_ROOT)
    .map((d) => path.join(PROJECTS_ROOT, d))
    .filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } })
    .map((d) => {
      const jsonl = fs.readdirSync(d).filter((f) => f.endsWith(".jsonl"));
      const newest = jsonl.reduce((m, f) => {
        try { return Math.max(m, fs.statSync(path.join(d, f)).mtimeMs); } catch { return m; }
      }, 0);
      return { dir: d, count: jsonl.length, newest };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.newest - a.newest);
  return dirs.length ? dirs[0].dir : exact;
}
const PROJECTS = arg("projects", guessProjects());

/* ---------- предметы ---------- */
// Порядок важен: побеждает первое совпадение, поэтому узкие темы стоят выше широких.
const SUBJECTS = [
  ["Правоведение", /знак|trademark|uspto|sou|brand registry|complian|appeal|патент|юрид|лиценз|polic|заявк|verification|верификац/i],
  ["Информатика",  /скрипт|api|крон|сервер|bios|установ|ошибк|баг|репозитор|git|mcp|агент|скилл|skill|автоматиз|python|node|драйвер|железо|bluetooth|плагин|аватар|стример|хук|hook|токен/i],
  ["Арифметика",   /ppc|реклам|ставк|acos|бюджет|выручк|цен[аыу]|прибыл|расход|маржин|unit_count|кампан|отчёт|отчет|метрик|продаж|себестоим|поставк|отправ|инвентар|склад|fba/i],
  ["Русский язык", /листинг|карточ|описан|bullet|a\+|заголов|копирайт|письм|отзыв|перевод|формулир|ответ покупател/i],
  ["Черчение",     /фото|рендер|карусел|изображ|картинк|3d|glb|blender|дизайн|обложк|макет|логотип|палитр|слайд/i],
  ["Труд",         /видео|рил[ыс]?\b|reel|shorts|монтаж|ffmpeg|tiktok|инстаграм|instagram|youtube|публик|постинг|отгруз|блотато|blotato/i],
  ["История",      /разбор|итог|аудит|анализ|ретроспект|дневник|план недел|стратег|расписан/i],
];

// Строки, которые темой сессии не являются: вставленные пути, вывод хуков,
// служебные врезки. Без этого в дневник попадают куски интерфейса.
const NOT_A_TOPIC = [
  /^@?"?[A-Za-z]:[\\/]/,          // путь к файлу, в том числе вставка через @"..."
  /^https?:\/\/\S+$/,             // голая ссылка
  /^(stop )?hook (feedback|output)/i,
  /^caveat:/i,
  /^persistence check/i,
  /^system-reminder/i,
  /^\/[a-z-]+\s*$/i,              // одинокая слэш-команда
  /^continue from where you left off/i,
  /^(продолж|дальше|давай дальше|ок|окей|да|нет|ага)\b.{0,20}$/i,
];

/* Сессия могла начаться с реплики-продолжения («убери этот пункт»,
   «проверь ещё раз завтра») — тема разговора там осталась в предыдущей
   сессии. Такие обрывки узнаются по тому, что они короткие и ни на один
   предмет не ложатся: класть их в дневник значит засорять неделю. */
function isFragment(text) {
  return text.length < 55 && subjectFor(text) === FALLBACK;
}
const FALLBACK = "Внеклассное чтение";

function subjectFor(text) {
  for (const [name, re] of SUBJECTS) if (re.test(text)) return name;
  return FALLBACK;
}

/* ---------- чтение транскриптов ---------- */
function firstHumanLine(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return null; }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== "user" || !j.message) continue;
    const c = j.message.content;
    const text = typeof c === "string"
      ? c
      : Array.isArray(c) ? (c.find((x) => x.type === "text") || {}).text || "" : "";
    const t = String(text).trim();
    // системные врезки, хуки и вывод инструментов темой не являются
    if (!t || t.startsWith("<") || t.startsWith("[")) continue;
    if (t.length < 12) continue;
    if (NOT_A_TOPIC.some((re) => re.test(t))) continue;
    return t;
  }
  return null;
}

function collect() {
  if (!fs.existsSync(PROJECTS)) {
    console.error("Папка с транскриптами не найдена: " + PROJECTS);
    console.error("Укажи её флагом --projects <путь>.");
    process.exit(1);
  }
  const cutoff = Date.now() - DAYS * 86400000;
  const files = fs.readdirSync(PROJECTS)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(PROJECTS, f))
    .filter((f) => { try { return fs.statSync(f).mtimeMs >= cutoff; } catch { return false; } })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  const seen = new Map(); // ключ темы -> {text, count, last}
  for (const f of files) {
    const line = firstHumanLine(f);
    if (!line || isFragment(line)) continue;
    const key = line.slice(0, 70).toLowerCase().replace(/\s+/g, " ");
    const prev = seen.get(key);
    const mt = fs.statSync(f).mtimeMs;
    if (prev) { prev.count++; prev.last = Math.max(prev.last, mt); }
    else seen.set(key, { text: line, count: 1, last: mt });
  }
  return { topics: [...seen.values()].sort((a, b) => b.last - a.last), scanned: files.length };
}

/* ---------- сборка недели ---------- */
const DAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const MONTHS = ["января","февраля","марта","апреля","мая","июня",
                "июля","августа","сентября","октября","ноября","декабря"];

function mondayOf(d) {
  const x = new Date(d);
  const shift = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - shift);
  x.setHours(0, 0, 0, 0);
  return x;
}

function oneLine(text) {
  // Первое предложение или первые ~110 знаков — в клетку дневника длинное не влезает.
  const flat = text.replace(/\s+/g, " ").trim();
  const cut = flat.split(/(?<=[.!?])\s/)[0];
  const s = (cut.length > 20 && cut.length <= 130) ? cut : flat.slice(0, 110);
  return s.length < flat.length ? s.replace(/[,;:\s]+$/, "") + "…" : s;
}

function build({ topics }) {
  const start = arg("from") ? mondayOf(new Date(arg("from"))) : mondayOf(new Date());

  const regular = topics.filter((t) => t.count >= 3);
  const work = topics.filter((t) => t.count < 3);

  const days = DAY_NAMES.map((name, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return {
      name,
      date: d.getDate() + " " + MONTHS[d.getMonth()],
      note: "",
      lessons: [],
    };
  });

  // Темы раскладываются по дням по кругу, свежие — в начало недели.
  work.forEach((t, i) => {
    const day = days[i % 6];
    if (day.lessons.length >= 4) return;
    day.lessons.push({ subj: subjectFor(t.text), task: oneLine(t.text), tag: "из сессий" });
  });

  // Регулярное — одной строкой в субботу, как «повторение пройденного».
  if (regular.length) {
    days[5].lessons.push({
      subj: "История",
      task: "Регулярное за неделю: " + regular.map((r) => oneLine(r.text).slice(0, 40)).join("; "),
      tag: "повторение",
    });
  }

  // Физкультура в каждый день — её из сессий не вычитать.
  const pe = [
    "Прогулка сорок минут. Отбой до 23:00.",
    "Улица вместо перекуров. Считать выходы, а не сигареты.",
    "На каждый приступ тяги — холодный душ и двадцать отжиманий.",
    "Прогулка. Вода — три литра, мера, а не ощущение.",
    "Улица. Отбой до 23:00.",
    "Награда за шесть чистых дней. Выбрать её заранее.",
  ];
  days.forEach((d, i) => {
    if (!d.lessons.length) d.lessons.push({ subj: "История", task: "", tag: "" });
    d.lessons.push({ subj: "Физкультура", task: pe[i], tag: "день " + (i + 1) });
  });

  const end = new Date(start); end.setDate(end.getDate() + 5);
  return {
    weekNo: "I",
    dates: start.getDate() + " " + MONTHS[start.getMonth()] + " — " +
           end.getDate() + " " + MONTHS[end.getMonth()] + " " + end.getFullYear(),
    bells: [
      ["1 урок","09:00 — 09:45"], ["перемена","09:45 — 09:55"],
      ["2 урок","09:55 — 10:40"], ["большая перемена","10:40 — 11:10 · улица, 30 минут"],
      ["3 урок","11:10 — 11:55"], ["перемена","11:55 — 12:05"],
      ["4 урок","12:05 — 12:50"], ["перемена","12:50 — 13:00"],
      ["5 урок","13:00 — 13:45"],
    ],
    habits: [
      { name: "Без сигарет", note: "главная графа недели" },
      { name: "Без пива", note: "вместе с первой, поодиночке не держится" },
      { name: "Улица, 30 минут", note: "на большой перемене" },
      { name: "Отбой до 23:00", note: "недосып возвращает тягу" },
      { name: "Три литра воды", note: "мера, а не ощущение" },
    ],
    days,
  };
}

/* ---------- запуск ---------- */
const found = collect();
const week = build(found);
const lessons = week.days.reduce((n, d) => n + d.lessons.length, 0);

const regularCount = found.topics.filter((t) => t.count >= 3).length;
console.log("Просмотрено сессий: " + found.scanned + " за " + DAYS + " дн.");
console.log("Тем найдено: " + found.topics.length +
            " (из них регулярных, отложено в повторение: " + regularCount + ")");
console.log("Уроков в черновике: " + lessons + ", неделя " + week.dates);

if (WRITE) {
  const dir = path.join(REPO, "personal");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "week-draft.json");
  fs.writeFileSync(out, JSON.stringify({ meta: {}, week, archive: [] }, null, 2), "utf8");
  console.log("Записано: " + out);
  console.log("Открой дневник и нажми «Загрузить из файла».");
} else {
  console.log("");
  week.days.forEach((d) => {
    console.log(d.name + ", " + d.date);
    d.lessons.forEach((l, i) => console.log("  " + (i + 1) + ". " + l.subj + " — " + l.task));
  });
  console.log("\nЧтобы записать черновик, добавь --write");
}
