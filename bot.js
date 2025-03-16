require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require("express");
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');

// 🔐 Переменные окружения
const TOKEN = process.env.TOKEN;
const RAILWAY_URL = process.env.RAILWAY_URL || "https://tg-audio-bot-production.up.railway.app";
const PORT = process.env.PORT || 8080;

if (!TOKEN) {
    console.error("❌ Токен бота не найден! Проверь .env");
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const MEMES_FILE = path.join(__dirname, 'memes.json');
const MEMES_DIR = path.join(__dirname, 'memes');

// 🚀 HTTP-сервер для раздачи файлов
const app = express();
app.use("/memes", express.static(MEMES_DIR, {
    setHeaders: (res) => {
        res.setHeader("Content-Type", "audio/ogg");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=86400");
    }
}));

app.listen(PORT, () => {
    console.log(`🌐 Сервер запущен на ${PORT}`);
    console.log(`📂 Файлы доступны по ссылке: ${RAILWAY_URL}/memes/имя_файла.ogg`);
});

// 🛠 Проверка директорий
if (!fs.existsSync(MEMES_DIR)) fs.mkdirSync(MEMES_DIR);
if (!fs.existsSync(MEMES_FILE)) fs.writeFileSync(MEMES_FILE, JSON.stringify({}));

// 🔄 Загрузка мемов
let memes = JSON.parse(fs.readFileSync(MEMES_FILE, 'utf-8'));

// 🎛 **Генерация меню с категориями**
const getCategoriesKeyboard = () => {
    return {
        reply_markup: {
            inline_keyboard: Object.keys(memes).map(category => [
                { text: category, callback_data: `category_${category}` }
            ])
        }
    };
};

// 🏠 **Команда /start**
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Привет! Используй /menu, чтобы выбрать мем.");
});

// 📌 **Команда /menu (показывает категории)**
bot.onText(/\/menu/, (msg) => {
    bot.sendMessage(msg.chat.id, "Выбери категорию мемов:", getCategoriesKeyboard());
});

// 🎭 **Обработка выбора категории**
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;

    if (query.data.startsWith("category_")) {
        const category = query.data.replace("category_", "");

        if (memes[category]) {
            const keyboard = {
                reply_markup: {
                    inline_keyboard: Object.keys(memes[category]).map(meme => [
                        { text: meme, callback_data: `meme_${category}_${meme}` }
                    ])
                }
            };
            bot.sendMessage(chatId, `Выбери мем из категории *${category}*:`, keyboard);
        }
    }
});

// 🎙 **Обработка выбора мема**
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;

    if (query.data.startsWith("meme_")) {
        const parts = query.data.split("_");
        const category = parts[1];
        const memeKey = parts.slice(2).join("_");

        if (memes[category] && memes[category][memeKey]) {
            const fileName = memes[category][memeKey];  // Извлекаем только имя файла
            const filePath = path.join(MEMES_DIR, fileName);

            console.log(`🎮 Запрос на воспроизведение: ${memeKey} → ${filePath}`);

            if (fs.existsSync(filePath)) {
                bot.sendVoice(chatId, fs.createReadStream(filePath));
            } else {
                console.error(`❌ Файл не найден: ${filePath}`);
                bot.sendMessage(chatId, "❌ Файл не найден на сервере.");
            }
        }
    }
});

// 🔎 **Обработка inline-запросов**
bot.on('inline_query', async (query) => {
    const search = query.query.toLowerCase();
    const results = [];

    Object.keys(memes).forEach(category => {
        Object.keys(memes[category]).forEach(meme => {
            if (meme.toLowerCase().includes(search)) {
                const fileName = memes[category][meme];
                const fileUrl = `${RAILWAY_URL}/memes/${fileName}`;

                results.push({
                    type: "voice",
                    id: `${category}_${meme}`,
                    title: `${category} → ${meme}`,
                    voice_url: fileUrl,
                    mime_type: "audio/ogg"
                });
            }
        });
    });

    bot.answerInlineQuery(query.id, results, { cache_time: 10 });
});

// 🛠 **Обработка ошибок**
bot.on('polling_error', error => {
    console.error("🔴 Ошибка бота:", error.message);
});

console.log("✅ Бот запущен и готов к работе!");
