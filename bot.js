require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require("express");
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');

const bot = new TelegramBot(process.env.TOKEN, { 
    polling: {
        interval: 500,
        autoStart: true
    }
});

const MEMES_FILE = path.join(__dirname, 'memes.json');
const MEMES_DIR = path.join(__dirname, 'memes');
const RAILWAY_URL = "https://tg-audio-bot-production.up.railway.app"; // URL сервера Railway

// 🚀 Запускаем HTTP-сервер для раздачи файлов
const app = express();
const PORT = process.env.PORT || 8080;

app.use("/memes", express.static(MEMES_DIR, {
    setHeaders: (res) => {
        res.setHeader("Content-Type", "audio/ogg"); // MIME-тип для аудио
    }
}));

app.listen(PORT, () => console.log(`🌐 HTTP-сервер запущен на ${PORT}`));

// 🗂 Проверяем наличие папки и файла с мемами
if (!fs.existsSync(MEMES_DIR)) fs.mkdirSync(MEMES_DIR);
if (!fs.existsSync(MEMES_FILE)) fs.writeFileSync(MEMES_FILE, JSON.stringify({}));

// 📂 Загружаем список мемов
let memes = JSON.parse(fs.readFileSync(MEMES_FILE, 'utf-8'));

// 🔍 Выводим файлы в логах
console.log("📂 Папка с мемами:", MEMES_DIR);
console.log("📄 Файлы в папке /memes:", fs.readdirSync(MEMES_DIR));

// 🎤 Функция для конвертации аудиофайла в OGG (Opus) для голосовых сообщений
const convertToOgg = (inputPath, outputPath, callback) => {
    exec(`ffmpeg -i "${inputPath}" -c:a libopus -b:a 32k -ar 48000 -ac 1 "${outputPath}"`, (err) => {
        if (err) {
            console.error("Ошибка конвертации:", err);
            callback(false);
        } else {
            callback(true);
        }
    });
};

// 📩 Команда /start
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Привет! Используй /list, чтобы увидеть доступные аудиомемы. В группах можешь вызывать меня через @bot_name.");
});

// 📜 Вывести список доступных мемов
bot.onText(/\/list/, (msg) => {
    const chatId = msg.chat.id;
    if (Object.keys(memes).length === 0) {
        return bot.sendMessage(chatId, "Мемов пока нет.");
    }

    const memeList = Object.keys(memes).map(m => `/play ${m}`).join("\n");
    bot.sendMessage(chatId, `🎤 Доступные аудиомемы:\n${memeList}`);
});

// 🔊 Воспроизведение мемов
bot.onText(/^\/play (.+)$/, (msg, match) => {
    const chatId = msg.chat.id;
    const memeKey = match[1].trim();

    if (!memes[memeKey]) {
        return bot.sendMessage(chatId, "❌ Мем не найден.");
    }

    const filePath = path.join(MEMES_DIR, memes[memeKey]);

    // Проверяем формат файла (если MP3/WAV → конвертируем)
    const fileExt = path.extname(filePath).toLowerCase();
    if (fileExt !== ".ogg") {
        const convertedPath = filePath.replace(fileExt, ".ogg");
        convertToOgg(filePath, convertedPath, (success) => {
            if (success) {
                memes[memeKey] = convertedPath;
                fs.writeFileSync(MEMES_FILE, JSON.stringify(memes, null, 2));
                bot.sendVoice(chatId, fs.createReadStream(convertedPath));
            } else {
                bot.sendMessage(chatId, "Ошибка при воспроизведении мема.");
            }
        });
    } else {
        bot.sendVoice(chatId, fs.createReadStream(filePath));
    }
});

// 🛠 Поддержка inline-режима (бот работает в группах через @bot_name)
bot.on('inline_query', async (query) => {
    console.log("🔹 Inline-запрос:", query.query);

    const results = Object.keys(memes).map((memeKey, index) => {
        const fileUrl = `${RAILWAY_URL}/memes/${memes[memeKey]}`;
        console.log(`🎵 Формируем inline-ответ: ${memeKey} → ${fileUrl}`);

        return {
            type: "voice",
            id: String(index),
            title: memeKey,
            voice_url: fileUrl,
            mime_type: "audio/ogg"
        };
    });

    console.log("📤 Отправляем в inline:", results);

    bot.answerInlineQuery(query.id, results, { cache_time: 0 });
});

// 🔴 Логирование ошибок
bot.on('polling_error', console.error);

console.log("✅ Бот запущен...");
