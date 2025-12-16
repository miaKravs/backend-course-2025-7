// ===== Імпорт стандартних модулів =====
const fs = require('fs');
const path = require('path');

// ===== Зовнішні модулі =====
const express = require('express');
const multer = require('multer');
const { Command } = require('commander');
const swaggerUi = require('swagger-ui-express');
const superagent = require('superagent'); // за умовами роботи
const mariadb = require('mariadb');
const dotenv = require('dotenv');

// Завантажуємо змінні середовища з .env
dotenv.config();

// Просто використання superagent, щоб не було "unused"
console.log('Superagent version:', superagent.VERSION || 'installed');

// ===== Налаштування аргументів командного рядка (Commander.js) =====
const program = new Command();

program
    .requiredOption('-h, --host <host>', 'Server host (обов\'язковий параметр)')
    .requiredOption(
        '-p, --port <port>',
        'Server port (обов\'язковий параметр)',
        (value) => parseInt(value, 10)
    )
    .requiredOption('-c, --cache <dir>', 'Cache directory (обов\'язковий параметр)');

program.parse(process.argv);
const options = program.opts();

const HOST = process.env.APP_HOST || options.host;
const PORT = process.env.APP_PORT ? parseInt(process.env.APP_PORT, 10) : options.port;
const CACHE_DIR = path.resolve(process.env.CACHE_DIR || options.cache);

// Створюємо директорію кешу, якщо її немає
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log('Створено теку кешу:', CACHE_DIR);
}

// ===== Налаштування підключення до MariaDB =====
const pool = mariadb.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 5
});

async function dbQuery(sql, params = []) {
    let conn;
    try {
        conn = await pool.getConnection();
        const res = await conn.query(sql, params);
        return res;
    } catch (err) {
        console.error('DB error:', err);
        throw err;
    } finally {
        if (conn) conn.release();
    }
}

// Допоміжна функція для пошуку речі по id (з БД)
async function findItemById(id) {
    const rows = await dbQuery(
        'SELECT id, inventory_name, description, photo_filename FROM inventory WHERE id = ?',
        [id]
    );
    if (!rows || rows.length === 0) {
        return null;
    }
    const row = rows[0];
    return {
        id: Number(row.id),
        inventory_name: row.inventory_name,
        description: row.description,
        photoFilename: row.photo_filename,
        photo: row.photo_filename ? `/inventory/${row.id}/photo` : null
    };
}

// ===== Налаштовуємо Express =====
const app = express();

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
 */
app.post('/register', upload.single('photo'), async (req, res) => {
    try {
        const { inventory_name, description } = req.body;

        if (!inventory_name) {
            return res.status(400).json({ error: "Поле inventory_name є обов'язковим" });
        }

        const photoFilename = req.file ? req.file.filename : null;

        const result = await dbQuery(
            'INSERT INTO inventory (inventory_name, description, photo_filename) VALUES (?, ?, ?)',
            [inventory_name, description || '', photoFilename]
        );

        const id = Number(result.insertId);

        const item = {
            id,
            inventory_name,
            description: description || '',
            photoFilename,
            photo: photoFilename ? `/inventory/${id}/photo` : null
        };

        return res.status(201).json(item);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

/**
 * GET /inventory
 * Повертає список усіх речей (JSON).
 */
app.get('/inventory', async (req, res) => {
    try {
        const rows = await dbQuery(
            'SELECT id, inventory_name, description, photo_filename FROM inventory ORDER BY id'
        );
        const list = rows.map((row) => ({
            id: Number(row.id),
            inventory_name: row.inventory_name,
            description: row.description,
            photoFilename: row.photo_filename,
            photo: row.photo_filename ? `/inventory/${row.id}/photo` : null
        }));

        return res.status(200).json(list);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

/**
 * GET /inventory/:id
 * Повертає конкретну річ за ID або 404.
 */
app.get('/inventory/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const item = await findItemById(id);

        if (!item) {
            return res.status(404).json({ error: 'Річ не знайдена' });
        }

        return res.status(200).json(item);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

/**
 * PUT /inventory/:id
 * Оновлення імені та/або опису (JSON або x-www-form-urlencoded).
 */
app.put('/inventory/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const item = await findItemById(id);

        if (!item) {
            return res.status(404).json({ error: 'Річ не знайдена' });
        }

        const { inventory_name, description } = req.body;

        const newName = inventory_name !== undefined ? inventory_name : item.inventory_name;
        const newDesc = description !== undefined ? description : item.description;

        await dbQuery(
            'UPDATE inventory SET inventory_name = ?, description = ? WHERE id = ?',
            [newName, newDesc, id]
        );

        const updated = await findItemById(id);
        return res.status(200).json(updated);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

/**
 * GET /inventory/:id/photo
 * Повертає фото зображення (Content-Type: image/jpeg).
 */
app.get('/inventory/:id/photo', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const item = await findItemById(id);

        if (!item || !item.photoFilename) {
            return res.status(404).json({ error: 'Фото не знайдено' });
        }

        const filePath = path.join(CACHE_DIR, item.photoFilename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Фото не знайдено' });
        }

        res.setHeader('Content-Type', 'image/jpeg');
        return res.sendFile(filePath);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

/**
 * PUT /inventory/:id/photo
 * Оновлює фото речі.
 */
app.put('/inventory/:id/photo', upload.single('photo'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const item = await findItemById(id);

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

        const newFilename = req.file.filename;

        await dbQuery(
            'UPDATE inventory SET photo_filename = ? WHERE id = ?',
            [newFilename, id]
        );

        const updated = await findItemById(id);
        return res.status(200).json(updated);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

/**
 * DELETE /inventory/:id
 * Видаляє річ зі списку та її фото.
 */
app.delete('/inventory/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const item = await findItemById(id);

        if (!item) {
            return res.status(404).json({ error: 'Річ не знайдена' });
        }

        // видаляємо фото, якщо є
        if (item.photoFilename) {
            const filePath = path.join(CACHE_DIR, item.photoFilename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        await dbQuery('DELETE FROM inventory WHERE id = ?', [id]);

        return res.status(200).json({ message: 'Річ видалено' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

/**
 * POST /search
 * Пошук речі за ID (x-www-form-urlencoded з HTML-форми SearchForm.html)
 */
app.post('/search', async (req, res) => {
    try {
        const id = parseInt(req.body.id, 10);
        const includePhoto = !!req.body.has_photo;

        const item = await findItemById(id);
        if (!item) {
            return res.status(404).json({ error: 'Річ не знайдена' });
        }

        // Якщо includePhoto — просто повертаємо JSON з полем photo (URL)
        if (!includePhoto) {
            // без поля photo
            return res.status(201).json({
                id: Number(item.id),
                inventory_name: item.inventory_name,
                description: item.description
            });
        }

        return res.status(201).json(item);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ===== Запуск сервера =====
app.listen(PORT, HOST, () => {
    console.log(`Server listening at http://${HOST}:${PORT}`);
});
