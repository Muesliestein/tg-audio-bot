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
const RAILWAY_URL = process.env.RAILWAY_URL || "https://tg-audio-bot-production.up.railway.app"; // Берем URL из окружения или используем фиксированный

// 🚀 Запускаем HTTP-сервер для раздачи файлов
const app = express();
const PORT = process.env.PORT || 8080;

// Добавляем логирование запросов
app.use((req, res, next) => {
    console.log(`📢 HTTP запрос: ${req.method} ${req.url}`);
    next();
});

app.use("/memes", express.static(MEMES_DIR, {
    setHeaders: (res) => {
        res.setHeader("Content-Type", "audio/ogg"); // MIME-тип для аудио
        res.setHeader("Access-Control-Allow-Origin", "*"); // Разрешаем доступ с любого источника
    }
}));

// Тестовый маршрут для проверки работы сервера
app.get("/", (req, res) => {
    res.send("Бот работает!");
});

app.listen(PORT, () => console.log(`🌐 HTTP-сервер запущен на порту ${PORT}`));

// 🗂 Проверяем наличие папки и файла с мемами
if (!fs.existsSync(MEMES_DIR)) fs.mkdirSync(MEMES_DIR);
if (!fs.existsSync(MEMES_FILE)) fs.writeFileSync(MEMES_FILE, JSON.stringify({}));

// 📂 Загружаем список мемов
let memes = JSON.parse(fs.readFileSync(MEMES_FILE, 'utf-8'));

// 🔍 Выводим файлы в логах
console.log("📂 Папка с мемами:", MEMES_DIR);
console.log("📄 Файлы в папке /memes:", fs.readdirSync(MEMES_DIR));
console.log("🌐 URL сервера:", RAILWAY_URL);

// 🎤 Функция для конвертации аудиофайла в OGG (Opus) для голосовых сообщений
const convertToOgg = (inputPath, outputPath, callback) => {
    // Телеграм требует специфический формат для голосовых сообщений
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
    
    // Проверяем существование файла
    if (!fs.existsSync(filePath)) {
        console.error(`❌ Файл не найден: ${filePath}`);
        return bot.sendMessage(chatId, "❌ Файл не найден на сервере.");
    }

    // Проверяем формат файла (если MP3/WAV → конвертируем)
    const fileExt = path.extname(filePath).toLowerCase();
    if (fileExt !== ".ogg") {
        const convertedPath = filePath.replace(fileExt, ".ogg");
        convertToOgg(filePath, convertedPath, (success) => {
            if (success) {
                // Сохраняем только имя файла без пути
                const fileName = path.basename(convertedPath);
                memes[memeKey] = fileName;
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

// Добавляем команду для добавления нового мема
bot.onText(/\/add (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const memeKey = match[1].trim();
    
    if (memes[memeKey]) {
        return bot.sendMessage(chatId, `⚠️ Мем "${memeKey}" уже существует.`);
    }
    
    bot.sendMessage(chatId, `🎙️ Отправьте голосовое сообщение или аудиофайл для мема "${memeKey}"`);
    
    // Сохраняем информацию о текущем добавлении в состояние
    bot.onReplyToMessage(chatId, msg.message_id, (replyMsg) => {
        if (replyMsg.voice || replyMsg.audio) {
            const fileId = replyMsg.voice ? replyMsg.voice.file_id : replyMsg.audio.file_id;
            
            bot.getFile(fileId).then(file => {
                const fileUrl = `https://api.telegram.org/file/bot${process.env.TOKEN}/${file.file_path}`;
                const fileName = `${memeKey}_${Date.now()}.ogg`;
                const filePath = path.join(MEMES_DIR, fileName);
                
                // Скачиваем и конвертируем в OGG
                const https = require('https');
                const tempFile = path.join(MEMES_DIR, `temp_${fileName}`);
                
                const fileStream = fs.createWriteStream(tempFile);
                https.get(fileUrl, (response) => {
                    response.pipe(fileStream);
                    
                    fileStream.on('finish', () => {
                        fileStream.close();
                        
                        convertToOgg(tempFile, filePath, (success) => {
                            fs.unlinkSync(tempFile); // Удаляем временный файл
                            
                            if (success) {
                                // Сохраняем только имя файла без пути
                                memes[memeKey] = path.basename(fileName);
                                fs.writeFileSync(MEMES_FILE, JSON.stringify(memes, null, 2));
                                bot.sendMessage(chatId, `✅ Мем "${memeKey}" успешно добавлен!`);
                            } else {
                                bot.sendMessage(chatId, "❌ Ошибка при конвертации файла.");
                            }
                        });
                    });
                }).on('error', (err) => {
                    console.error("Ошибка скачивания:", err);
                    bot.sendMessage(chatId, "❌ Ошибка при скачивании файла.");
                });
            });
        } else {
            bot.sendMessage(chatId, "❌ Пожалуйста, отправьте голосовое сообщение или аудиофайл.");
        }
    });
});

// 🛠 Поддержка inline-режима (бот работает в группах через @bot_name)
bot.on('inline_query', async (query) => {
    console.log("🔹 Inline-запрос:", query.query);
    
    try {
        const results = Object.keys(memes)
            .filter(memeKey => memeKey.toLowerCase().includes(query.query.toLowerCase()))
            .map((memeKey, index) => {
                // Формируем URL к файлу (только имя файла)
                const fileName = memes[memeKey];
                const fileUrl = `${RAILWAY_URL}/memes/${fileName}`;
                
                console.log(`🎵 Формируем inline-ответ: ${memeKey} → ${fileUrl}`);
                
                return {
                    type: "voice",
                    id: String(index),
                    title: memeKey,
                    voice_url: fileUrl,
                    mime_type: "audio/ogg"
                };
            });
        
        console.log("📤 Отправляем в inline:", results.length, "результатов");
        
        await bot.answerInlineQuery(query.id, results, { 
            cache_time: 10,  // уменьшаем время кеширования для отладки
            is_personal: true
        });
        
        console.log("✅ Inline-ответ отправлен успешно");
    } catch (error) {
        console.error("❌ Ошибка в inline-запросе:", error);
    }
});

// 🔴 Логирование ошибок
bot.on('polling_error', error => {
    console.error("🔴 Polling error:", error.message);
});

console.log("✅ Бот запущен и готов к работе");