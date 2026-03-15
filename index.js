import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ──────────────────────────────────────────────
//  Конфигурация
// ──────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL = (parseInt(process.env.CHECK_INTERVAL) || 60) * 1000;
const HTTP_TIMEOUT = parseInt(process.env.HTTP_TIMEOUT) || 10000;

if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
  console.error('❌ Установите TELEGRAM_BOT_TOKEN в .env файле');
  process.exit(1);
}
if (!CHAT_ID || CHAT_ID === 'YOUR_CHAT_ID_HERE') {
  console.error('❌ Установите TELEGRAM_CHAT_ID в .env файле');
  process.exit(1);
}

// ──────────────────────────────────────────────
//  Файл хранения сайтов
// ──────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITES_FILE = path.join(__dirname, 'sites.json');

function loadSites() {
  try {
    if (fs.existsSync(SITES_FILE)) {
      const data = fs.readFileSync(SITES_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('⚠️ Ошибка чтения sites.json:', e.message);
  }
  return {};
}

function saveSites(sites) {
  fs.writeFileSync(SITES_FILE, JSON.stringify(sites, null, 2), 'utf-8');
}

// ──────────────────────────────────────────────
//  Состояние
// ──────────────────────────────────────────────
// sites = { "https://example.com": { name, url, status, lastAlert, addedAt } }
let sites = loadSites();

// ──────────────────────────────────────────────
//  Telegram Bot
// ──────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Бот запущен...');
console.log(`📋 Загружено сайтов: ${Object.keys(sites).length}`);
console.log(`⏱  Интервал проверки: ${CHECK_INTERVAL / 1000}с`);

// /start, /help — инструкция
bot.onText(/\/(start|help)/, (msg) => {
  const text =
    `🤖 Website Monitor Bot\n\n` +
    `📌 Команды:\n\n` +
    `➕ Добавить сайт:\n` +
    `   Просто отправьте URL\n` +
    `   Пример: https://google.com\n\n` +
    `➖ Удалить сайт:\n` +
    `   /remove https://google.com\n\n` +
    `📋 Список сайтов:\n` +
    `   /list\n\n` +
    `❓ Помощь:\n` +
    `   /help\n\n` +
    `⏱ Проверка каждые ${CHECK_INTERVAL / 1000} секунд\n` +
    `🔴 Алерт при падении сайта\n` +
    `🟢 Уведомление при восстановлении`;

  bot.sendMessage(msg.chat.id, text);
});

// /list — список сайтов
bot.onText(/\/list/, (msg) => {
  const siteList = Object.values(sites);

  if (siteList.length === 0) {
    bot.sendMessage(msg.chat.id, '📋 Список мониторинга пуст.\nОтправьте URL чтобы добавить сайт.');
    return;
  }

  let text = `📋 Сайты в мониторинге (${siteList.length}):\n\n`;
  siteList.forEach((site, i) => {
    const icon = site.status === 'up' ? '🟢' : site.status === 'down' ? '🔴' : '⚪';
    text += `${i + 1}. ${icon} ${site.name}\n   ${site.url}\n\n`;
  });

  bot.sendMessage(msg.chat.id, text);
});

// /remove <url> — удалить сайт
bot.onText(/\/remove\s+(.+)/, (msg, match) => {
  let url = match[1].trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  if (sites[url]) {
    const name = sites[url].name;
    delete sites[url];
    saveSites(sites);
    bot.sendMessage(msg.chat.id, `🗑 Сайт удалён из мониторинга:\n🌐 ${name}\n🔗 ${url}`);
    console.log(`➖ Удалён: ${url}`);
  } else {
    bot.sendMessage(msg.chat.id, `⚠️ Сайт не найден в мониторинге:\n🔗 ${url}`);
  }
});

// /chatid — узнать chat id (вспомогательная команда)
bot.onText(/\/chatid/, (msg) => {
  bot.sendMessage(msg.chat.id, `🆔 Chat ID: \`${msg.chat.id}\``, { parse_mode: 'Markdown' });
});

// Обработка обычных сообщений — добавление URL
bot.on('message', (msg) => {
  const text = msg.text || '';

  // Пропускаем команды
  if (text.startsWith('/')) return;

  // Ищем URL в тексте
  const urlRegex = /https?:\/\/[^\s]+/gi;
  const matches = text.match(urlRegex);

  let url = '';
  if (matches && matches.length > 0) {
    url = matches[0];
  } else {
    // Проверяем домен без протокола
    const domainRegex = /([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?/gi;
    const domainMatches = text.match(domainRegex);
    if (domainMatches && domainMatches.length > 0) {
      url = 'https://' + domainMatches[0];
    }
  }

  if (!url) return;

  // Извлекаем имя хоста
  let siteName = url;
  try {
    siteName = new URL(url).hostname;
  } catch (e) { /* оставляем url как имя */ }

  // Добавляем сайт
  sites[url] = {
    url,
    name: siteName,
    status: 'unknown',
    lastAlert: null,
    addedAt: new Date().toISOString(),
  };
  saveSites(sites);

  bot.sendMessage(msg.chat.id, `✅ Сайт добавлен в мониторинг:\n🌐 ${siteName}\n🔗 ${url}`);
  console.log(`➕ Добавлен: ${url}`);
});

// ──────────────────────────────────────────────
//  HTTP проверка сайта
// ──────────────────────────────────────────────
async function checkSite(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'WebsiteMonitorBot/1.0',
      },
    });
    clearTimeout(timeout);

    return {
      isUp: response.ok,
      statusCode: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    clearTimeout(timeout);

    let errorMsg = 'Connection failed';
    if (error.name === 'AbortError') {
      errorMsg = `Timeout (${HTTP_TIMEOUT / 1000}s)`;
    } else if (error.cause?.code) {
      errorMsg = error.cause.code;
    } else if (error.message) {
      errorMsg = error.message;
    }

    return {
      isUp: false,
      statusCode: 0,
      error: errorMsg,
    };
  }
}

// ──────────────────────────────────────────────
//  Мониторинг — цикл проверки
// ──────────────────────────────────────────────
async function runChecks() {
  const siteList = Object.values(sites);
  if (siteList.length === 0) return;

  console.log(`\n⏱  [${new Date().toLocaleTimeString()}] Проверяю ${siteList.length} сайт(ов)...`);

  for (const site of siteList) {
    const result = await checkSite(site.url);
    const previousStatus = site.status;
    const currentStatus = result.isUp ? 'up' : 'down';

    // Обновляем статус
    sites[site.url].status = currentStatus;

    const statusIcon = result.isUp ? '✓' : '✗';
    console.log(`   ${statusIcon} ${site.name} → ${currentStatus} ${result.error ? '(' + result.error + ')' : ''}`);

    // Определяем нужен ли алерт
    let alertMessage = null;

    if (!result.isUp && previousStatus !== 'down') {
      // Сайт упал — отправляем алерт
      const now = new Date().toISOString();
      sites[site.url].lastAlert = now;

      alertMessage =
        `🔴 САЙТ НЕДОСТУПЕН\n\n` +
        `🌐 Сайт: ${site.name}\n` +
        `🔗 URL: ${site.url}\n` +
        `❌ Ошибка: ${result.error}\n` +
        `🕐 Время: ${formatTime(now)}\n\n` +
        `⚠️ Повторный алерт не отправится до восстановления.`;
    } else if (result.isUp && previousStatus === 'down') {
      // Сайт восстановился
      const now = new Date().toISOString();
      sites[site.url].lastAlert = now;

      alertMessage =
        `🟢 САЙТ ВОССТАНОВЛЕН\n\n` +
        `🌐 Сайт: ${site.name}\n` +
        `🔗 URL: ${site.url}\n` +
        `✅ Статус: OK (${result.statusCode})\n` +
        `🕐 Время: ${formatTime(now)}`;
    }

    if (alertMessage) {
      try {
        await bot.sendMessage(CHAT_ID, alertMessage);
        console.log(`   📨 Алерт отправлен!`);
      } catch (e) {
        console.error(`   ❌ Ошибка отправки алерта:`, e.message);
      }
    }
  }

  // Сохраняем обновлённые статусы
  saveSites(sites);
}

// ──────────────────────────────────────────────
//  Утилиты
// ──────────────────────────────────────────────
function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// ──────────────────────────────────────────────
//  Запуск
// ──────────────────────────────────────────────

// Первая проверка через 5 сек после старта
setTimeout(runChecks, 5000);

// Далее каждые CHECK_INTERVAL мс
setInterval(runChecks, CHECK_INTERVAL);

console.log(`\n🚀 Мониторинг запущен!`);
console.log(`   Отправьте /help боту для инструкции.\n`);
