require('dotenv').config();

const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');

// ===== Імпорт стандартних модулів =====
const fs = require('fs');
const path = require('path');
const http = require('http');

// ===== Зовнішні модулі =====
const express = require('express');
const multer = require('multer');
const { Command } = require('commander');
const swaggerUi = require('swagger-ui-express');
const superagent = require('superagent'); // потрібен по умовах роботи

// Просте використання superagent, щоб не було "unused"
console.log('Superagent version:', superagent.VERSION || 'installed');

// ===== Налаштування аргументів командного рядка (Commander.js) =====
const program = new Command();

program
    .requiredOption('-h, --host <host>', 'Server host (обов\'язковий параметр)')
    .requiredOption('-p, --port <port>', 'Server port (обов\'язковий параметр)', (value) => parseInt(value, 10))
    .requiredOption('-c, --cache <dir>', 'Cache directory (обов\'язковий параметр)');

program.parse(process.argv);
const options = program.opts();

const HOST = options.host;
const PORT = options.port;
const CACHE_DIR = path.resolve(options.cache);

// Створюємо директорію кешу, якщо її немає
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log('Створено теку кешу:', CACHE_DIR);
}

// ===== "База даних" у памʼяті =====
let nextId = 1;
/**
 * Один елемент інвентаря має вигляд:
 * {
 *   id,
 *   inventory_name,
 *   description,
 *   photoFilename,
 *   photo   // URL типу /inventory/ID/photo
 * }
 */
const inventory = [];

function findItemById(id) {
    return inventory.find((item) => item.id === id);
}

// ===== Налаштовуємо Express =====
const app = express();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});
// Підтримка JSON та x-www-form-urlencoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Видаємо статичні файли (HTML форми) з кореня проєкту
app.use(express.static(__dirname));

// ===== Налаштування Multer для завантаження фото =====
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, CACHE_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});
const upload = multer({ storage });

// ===== Swagger-документація на /docs =====
const swaggerDocument = {
    openapi: '3.0.0',
    info: {
        title: 'Inventory Service API',
        version: '1.0.0',
        description: 'Сервіс інвентаризації для лабораторної №7'
    },
    servers: [
        {
            url: `http://${HOST}:${PORT}`,
            description: 'Локальний сервер'
        }
    ],
    paths: {
        '/register': {
            post: {
                summary: 'Реєстрація нового пристрою',
                description: 'Приймає multipart/form-data з полями inventory_name, description, photo',
                responses: {
                    '201': { description: 'Пристрій зареєстровано' },
                    '400': { description: 'Не задано імʼя речі' }
                }
            }
        },
        '/inventory': {
            get: {
                summary: 'Список усіх інвентаризованих речей',
                responses: {
                    '200': { description: 'JSON список речей' }
                }
            }
        },
        '/inventory/{id}': {
            get: {
                summary: 'Отримати інформацію про конкретну річ',
                responses: {
                    '200': { description: 'Інформація про річ' },
                    '404': { description: 'Річ не знайдена' }
                }
            },
            put: {
                summary: 'Оновити імʼя або опис речі',
                responses: {
                    '200': { description: 'Оновлено' },
                    '404': { description: 'Річ не знайдена' }
                }
            },
            delete: {
                summary: 'Видалити річ',
                responses: {
                    '200': { description: 'Річ видалено' },
                    '404': { description: 'Річ не знайдена' }
                }
            }
        },
        '/inventory/{id}/photo': {
            get: {
                summary: 'Отримати фото речі',
                responses: {
                    '200': { description: 'Фото' },
                    '404': { description: 'Річ або фото не знайдено' }
                }
            },
            put: {
                summary: 'Оновити фото речі',
                responses: {
                    '200': { description: 'Фото оновлено' },
                    '404': { description: 'Річ не знайдена' }
                }
            }
        },
        '/search': {
            post: {
                summary: 'Пошук речі за ID (x-www-form-urlencoded)',
                responses: {
                    '201': { description: 'Річ знайдена' },
                    '404': { description: 'Річ не знайдена' }
                }
            }
        }
    }
};

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

/**
 * POST /register
 * Реєстрація нової речі.
 * Тіло: multipart/form-data (inventory_name, description, photo).
 * Успіх: 201 Created.
 * Якщо немає inventory_name: 400 Bad Request.
 */
app.post('/register', upload.single('photo'), (req, res) => {
    const { inventory_name, description } = req.body;

    if (!inventory_name) {
        return res.status(400).json({ error: 'Поле inventory_name є обов\'язковим' });
    }

    const id = nextId++;
    const photoFilename = req.file ? req.file.filename : null;

    const item = {
        id,
        inventory_name,
        description: description || '',
        photoFilename,
        photo: photoFilename ? `/inventory/${id}/photo` : null
    };

    inventory.push(item);
    return res.status(201).json(item);
});

/**
 * GET /inventory
 * Повертає список усіх речей (JSON).
 */
app.get('/inventory', (req, res) => {
    return res.status(200).json(inventory);
});

/**
 * GET /inventory/:id
 * Повертає конкретну річ за ID або 404.
 */
app.get('/inventory/:id', (req, res) => {
    console.log('GET /inventory/:id/photo, id =', req.params.id);
    const id = parseInt(req.params.id, 10);
    const item = findItemById(id);

    if (!item) {
        return res.status(404).json({ error: 'Річ не знайдена' });
    }

    return res.status(200).json(item);
});

/**
 * PUT /inventory/:id
 * Оновлення імені та/або опису (JSON).
 */
app.put('/inventory/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const item = findItemById(id);

    if (!item) {
        return res.status(404).json({ error: 'Річ не знайдена' });
    }

    const { inventory_name, description } = req.body;

    if (inventory_name !== undefined) item.inventory_name = inventory_name;
    if (description !== undefined) item.description = description;

    return res.status(200).json(item);
});

/**
 * GET /inventory/:id/photo
 * Повертає фото зображення (Content-Type: image/jpeg).
 */
app.get('/inventory/:id/photo', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const item = findItemById(id);

    if (!item || !item.photoFilename) {
        return res.status(404).json({ error: 'Фото не знайдено' });
    }

    const filePath = path.join(CACHE_DIR, item.photoFilename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Фото не знайдено' });
    }

    res.setHeader('Content-Type', 'image/jpeg');
    return res.sendFile(filePath);
});

/**
 * PUT /inventory/:id/photo
 * Оновлює фото речі.
 */
app.put('/inventory/:id/photo', upload.single('photo'), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const item = findItemById(id);

    if (!item) {
        return res.status(404).json({ error: 'Річ не знайдена' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'Не передано файл photo' });
    }

    // видаляємо старе фото, якщо було
    if (item.photoFilename) {
        const oldPath = path.join(CACHE_DIR, item.photoFilename);
        if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
        }
    }

    item.photoFilename = req.file.filename;
    item.photo = `/inventory/${id}/photo`;

    return res.status(200).json(item);
});

/**
 * DELETE /inventory/:id
 * Видаляє річ зі списку.
 */
app.delete('/inventory/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const index = inventory.findIndex((item) => item.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Річ не знайдена' });
    }

    const [deleted] = inventory.splice(index, 1);

    if (deleted.photoFilename) {
        const photoPath = path.join(CACHE_DIR, deleted.photoFilename);
        if (fs.existsSync(photoPath)) {
            fs.unlinkSync(photoPath);
        }
    }

    return res.status(200).json({ message: 'Річ видалено' });
});

/**
 * POST /search
 * Дані: x-www-form-urlencoded (id, has_photo).
 * Якщо has_photo=true і є фото — додає посилання на фото в опис.
 */
app.post('/search', (req, res) => {
    const id = parseInt(req.body.id, 10);
    const hasPhoto = !!req.body.has_photo;

    const item = findItemById(id);
    if (!item) {
        return res.status(404).json({ error: 'Річ не знайдена' });
    }

    const result = { ...item };

    if (hasPhoto && item.photo) {
        const photoUrl = `${req.protocol}://${req.get('host')}${item.photo}`;
        result.description = (result.description || '') + ` Фото: ${photoUrl}`;
    }

    return res.status(201).json(result);
});

/**
 * Обробка 404 та 405 (Method not allowed)
 * Якщо існує ендпоінт, але метод інший → 405.
 * Якщо ендпоінта нема → 404.
 */
app.use((req, res) => {
    const method = req.method;
    const url = req.path;

    if (url === '/register') {
        if (method !== 'POST') return res.status(405).send('Method not allowed');
    } else if (url === '/inventory') {
        if (method !== 'GET') return res.status(405).send('Method not allowed');
    } else if (/^\/inventory\/[^/]+\/photo$/.test(url)) {
        if (!['GET', 'PUT'].includes(method)) return res.status(405).send('Method not allowed');
    } else if (/^\/inventory\/[^/]+$/.test(url)) {
        if (!['GET', 'PUT', 'DELETE'].includes(method)) return res.status(405).send('Method not allowed');
    } else if (url === '/RegisterForm.html' || url === '/SearchForm.html') {
        if (method !== 'GET') return res.status(405).send('Method not allowed');
    } else if (url === '/search') {
        if (method !== 'POST') return res.status(405).send('Method not allowed');
    } else if (url.startsWith('/docs')) {
        if (method !== 'GET') return res.status(405).send('Method not allowed');
    } else {
        return res.status(404).send('Not found');
    }

    return res.status(404).send('Not found');
});

// ===== Створюємо HTTP-сервер через http =====
const server = http.createServer(app);

async function start() {
    try {
        await pool.getConnection();
        console.log('Connected to MariaDB');

        const port = process.env.APP_PORT || 3000;

        app.listen(port, () => {
            console.log(`Server is running on port ${port}`);
        });
    } catch (err) {
        console.error('Failed to connect to MariaDB', err);
        process.exit(1);
    }
}

start();
