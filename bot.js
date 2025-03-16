require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require("express");
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');

// Проверка наличия токена
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
    console.error("❌ Не найден токен бота в .env файле!");
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const MEMES_FILE = path.join(__dirname, 'memes.json');
const MEMES_DIR = path.join(__dirname, 'memes');
const RAILWAY_URL = process.env.RAILWAY_URL || "https://tg-audio-bot-production.up.railway.app";

// Запуск сервера для раздачи файлов
const app = express();
const PORT = process.env.PORT || 8080;

app.use("/memes", express.static(MEMES_DIR, {
    setHeaders: (res) => {
        res.setHeader("Content-Type", "audio/ogg");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=86400"); // Кеширование на 24 часа
    }
}));

app.listen(PORT, () => console.log(`🌐 HTTP-сервер запущен на порту ${PORT}`));

// Проверяем наличие папок и файлов
if (!fs.existsSync(MEMES_DIR)) fs.mkdirSync(MEMES_DIR);
if (!fs.existsSync(MEMES_FILE)) fs.writeFileSync(MEMES_FILE, JSON.stringify({}));

// Загружаем список мемов и категорий
let memes = JSON.parse(fs.readFileSync(MEMES_FILE, 'utf-8'));

// Логирование загруженных файлов
console.log("📂 Загруженные категории:", Object.keys(memes));

// Функция конвертации аудиофайла в OGG
const convertToOgg = (inputPath, outputPath, callback) => {
    exec(`ffmpeg -i "${inputPath}" -c:a libopus -b:a 32k -ar 48000 -ac 1 "${outputPath}"`, (err) => {
        if (err) {
            console.error("❌ Ошибка конвертации:", err);
            callback(false);
        } else {
            console.log("✅ Конвертация успешна:", outputPath);
            callback(true);
        }
    });
};

// Обработка inline-запросов
bot.on('inline_query', async (query) => {
    const search = query.query.trim().toLowerCase();

    // 🔹 Выбор категорий
    if (search === "menu" || search === "") {
        const categories = Object.keys(memes);
        const results = categories.map((category, index) => ({
            type: "article",
            id: `cat_${index}`,
            title: `📂 ${category}`,
            description: "Выберите категорию аудиомемов",
            input_message_content: {
                message_text: `📂 *Категория*: *${category}*\nВыберите мем из этой категории`,
                parse_mode: "Markdown"
            },
            reply_markup: {
                inline_keyboard: [
                    ...Object.keys(memes[category]).map(meme => [
                        { text: meme, switch_inline_query_current_chat: category + " " + meme }
                    ])
                ]
            }
        }));

        return bot.answerInlineQuery(query.id, results, { cache_time: 10 });
    }

    // 🔎 Поиск мемов в выбранной категории
    const [category, ...memeParts] = search.split(" ");
    const memeName = memeParts.join(" ").trim();

    if (memes[category] && memeName) {
        const results = Object.keys(memes[category])
            .filter(meme => meme.toLowerCase().includes(memeName))
            .map((meme, index) => {
                const fileName = memes[category][meme];
                const fileUrl = `${RAILWAY_URL}/memes/${fileName}`;

                return {
                    type: "voice",
                    id: `${category}_${meme}_${index}`,
                    title: `🎤 ${meme}`,
                    voice_url: fileUrl,
                    mime_type: "audio/ogg"
                };
            });

        return bot.answerInlineQuery(query.id, results, { cache_time: 10 });
    }

    // Если ничего не найдено
    bot.answerInlineQuery(query.id, []);
});

// Команда /start
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Привет! Используй @AudioVoiceMemsBot menu для выбора категорий аудиомемов.");
});

// Команда /list
bot.onText(/\/list/, (msg) => {
    const chatId = msg.chat.id;
    if (Object.keys(memes).length === 0) {
        return bot.sendMessage(chatId, "Мемов пока нет.");
    }

    const memeList = Object.keys(memes).map(m => `/play ${m}`).join("\n");
    bot.sendMessage(chatId, `🎤 Доступные аудиомемы:\n${memeList}`);
});

// Воспроизведение мемов
bot.onText(/^\/play (.+)$/, (msg, match) => {
    const chatId = msg.chat.id;
    const memeKey = match[1].trim();

    let found = false;
    Object.keys(memes).forEach(category => {
        if (memes[category][memeKey]) {
            found = true;
            const filePath = path.join(MEMES_DIR, memes[category][memeKey]);

            console.log(`🎮 Воспроизведение мема: ${memeKey} -> ${filePath}`);

            if (!fs.existsSync(filePath)) {
                console.error(`❌ Файл не найден: ${filePath}`);
                return bot.sendMessage(chatId, "❌ Файл не найден на сервере.");
            }

            bot.sendVoice(chatId, fs.createReadStream(filePath))
                .then(() => console.log(`✅ Мем успешно отправлен: ${memeKey}`))
                .catch(err => {
                    console.error(`❌ Ошибка при отправке: ${err.message}`);
                    bot.sendMessage(chatId, "❌ Ошибка при отправке мема.");
                });
        }
    });

    if (!found) {
        bot.sendMessage(chatId, "❌ Мем не найден.");
    }
});

// Логирование ошибок
bot.on('polling_error', error => {
    console.error("🔴 Polling error:", error.message);
});

console.log("✅ Бот запущен и готов к работе");
