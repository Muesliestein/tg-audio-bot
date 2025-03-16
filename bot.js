require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require("express");
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');

// Токен из .env
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
    console.error("❌ Не найден токен бота в .env файле!");
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { 
    polling: {
        interval: 500,
        autoStart: true
    }
});

const MEMES_FILE = path.join(__dirname, 'memes.json');
const MEMES_DIR = path.join(__dirname, 'memes');
const RAILWAY_URL = process.env.RAILWAY_URL || "https://tg-audio-bot-production.up.railway.app";

// 🚀 Запускаем HTTP-сервер для раздачи файлов
const app = express();
const PORT = process.env.PORT || 8080;

// Включаем подробное логирование запросов
app.use((req, res, next) => {
    console.log(`📢 HTTP запрос: ${req.method} ${req.url}`);
    next();
});

// Главная страница
app.get("/", (req, res) => {
    res.send("Бот аудиомемов работает!");
});

// Отладочная страница для проверки файлов
app.get("/debug", (req, res) => {
    try {
        const files = fs.readdirSync(MEMES_DIR);
        const memesObj = JSON.parse(fs.readFileSync(MEMES_FILE, 'utf-8'));
        
        res.json({
            memes_directory: MEMES_DIR,
            railway_url: RAILWAY_URL,
            memes_files: files,
            memes_json: memesObj
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Маршрут для статических файлов с логированием
app.use("/memes", (req, res, next) => {
    const requestedFile = req.path.replace(/^\/+/, ''); // Удаляем начальные слеши
    const filePath = path.join(MEMES_DIR, requestedFile);
    
    console.log(`📂 Запрос к файлу: ${requestedFile}`);
    if (fs.existsSync(filePath)) {
        console.log(`✅ Файл найден: ${filePath}`);
    } else {
        console.log(`❌ Файл не найден: ${filePath}`);
    }
    next();
}, express.static(MEMES_DIR, {
    setHeaders: (res) => {
        res.setHeader("Content-Type", "audio/ogg");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=86400"); // Кеширование на 24 часа
    }
}));

// Запускаем сервер
const server = app.listen(PORT, () => {
    console.log(`🌐 HTTP-сервер запущен на порту ${PORT}`);
    console.log(`🌍 URL сервера: ${RAILWAY_URL}`);
});

// Проверяем наличие папки и файла с мемами
if (!fs.existsSync(MEMES_DIR)) {
    console.log("📁 Создаем папку для мемов:", MEMES_DIR);
    fs.mkdirSync(MEMES_DIR);
}

if (!fs.existsSync(MEMES_FILE)) {
    console.log("📄 Создаем файл memes.json");
    fs.writeFileSync(MEMES_FILE, JSON.stringify({}));
}

// Функция для проверки и исправления путей в memes.json
const checkAndFixMemesJson = () => {
    try {
        // Загружаем текущее состояние memes.json
        const memes = JSON.parse(fs.readFileSync(MEMES_FILE, 'utf-8'));
        const fixedMemes = {};
        let needsUpdate = false;
        
        // Проверяем каждый путь и исправляем
        Object.keys(memes).forEach(key => {
            const currentPath = memes[key];
            
            // Извлекаем только имя файла из пути, независимо от формата пути
            let fileName;
            
            if (currentPath.includes('memes/')) {
                // Если путь содержит 'memes/', берем только имя файла
                fileName = path.basename(currentPath);
                needsUpdate = true;
                console.log(`🔧 Исправлен путь для ${key}: ${currentPath} -> ${fileName}`);
            } else {
                // Иначе используем путь как есть
                fileName = currentPath;
            }
            
            fixedMemes[key] = fileName;
            
            // Проверяем существование файла
            const filePath = path.join(MEMES_DIR, fileName);
            if (!fs.existsSync(filePath)) {
                console.error(`❌ Файл не существует: ${filePath}`);
            } else {
                console.log(`✅ Файл существует: ${filePath}`);
            }
        });
        
        // Сохраняем исправленный файл если были изменения
        if (needsUpdate) {
            fs.writeFileSync(MEMES_FILE, JSON.stringify(fixedMemes, null, 2));
            console.log('✅ memes.json успешно обновлен');
            return fixedMemes;
        }
        
        return memes;
    } catch (error) {
        console.error('❌ Ошибка при проверке memes.json:', error);
        return {};
    }
};

// Загружаем список мемов с проверкой и исправлением путей
let memes = checkAndFixMemesJson();

// Выводим файлы в логах
console.log("📂 Папка с мемами:", MEMES_DIR);
console.log("📄 Файлы в папке /memes:", fs.readdirSync(MEMES_DIR));

// Функция для конвертации аудиофайла в OGG (Opus) для голосовых сообщений
const convertToOgg = (inputPath, outputPath, callback) => {
    console.log(`🔄 Конвертация: ${inputPath} -> ${outputPath}`);
    
    exec(`ffmpeg -i "${inputPath}" -c:a libopus -b:a 32k -ar 48000 -ac 1 "${outputPath}"`, (err) => {
        if (err) {
            console.error("❌ Ошибка конвертации:", err);
            callback(false);
        } else {
            console.log("✅ Конвертация успешна");
            callback(true);
        }
    });
};

// Команда /start
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Привет! Используй /list, чтобы увидеть доступные аудиомемы. В группах можешь вызывать меня через @bot_name.");
});

// Вывести список доступных мемов
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

    if (!memes[memeKey]) {
        return bot.sendMessage(chatId, "❌ Мем не найден.");
    }

    // Получаем имя файла без пути "memes/"
    const fileName = path.basename(memes[memeKey]);
    // Формируем корректный путь к файлу
    const filePath = path.join(MEMES_DIR, fileName);
    
    console.log(`🎮 Воспроизведение мема: ${memeKey} -> ${filePath}`);
    
    // Проверяем существование файла
    if (!fs.existsSync(filePath)) {
        console.error(`❌ Файл не найден: ${filePath}`);
        return bot.sendMessage(chatId, "❌ Файл не найден на сервере.");
    }

    // Отправляем файл
    bot.sendVoice(chatId, fs.createReadStream(filePath))
        .then(() => console.log(`✅ Мем успешно отправлен: ${memeKey}`))
        .catch(err => {
            console.error(`❌ Ошибка при отправке: ${err.message}`);
            bot.sendMessage(chatId, "❌ Ошибка при отправке мема.");
        });
});

const getCategoriesKeyboard = () => {
    return {
        reply_markup: {
            inline_keyboard: Object.keys(memes).map(category => [
                { text: category, callback_data: `category_${category}` }
            ])
        }
    };
};

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const category = query.data.replace("category_", ""); // Убираем префикс

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
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    
    if (query.data.startsWith("meme_")) {
        const parts = query.data.split("_");
        const category = parts[1];
        const memeKey = parts.slice(2).join("_");

        if (memes[category] && memes[category][memeKey]) {
            const filePath = path.join(MEMES_DIR, memes[category][memeKey]);
            bot.sendVoice(chatId, fs.createReadStream(filePath));
        }
    }
});



bot.onText(/\/menu/, (msg) => {
    bot.sendMessage(msg.chat.id, "Выбери категорию мемов:", getCategoriesKeyboard());
});


// Поддержка inline-режима
bot.on('inline_query', async (query) => {
    console.log("🔹 Inline-запрос:", query.query);
    
    try {
        const results = Object.keys(memes)
            .filter(memeKey => !query.query || memeKey.toLowerCase().includes(query.query.toLowerCase()))
            .map((memeKey, index) => {
                // Получаем только имя файла без пути "memes/"
                const fileName = path.basename(memes[memeKey]);
                // Формируем URL
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
            cache_time: 10  // уменьшаем время кеширования для отладки
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